use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Sender, SyncSender};
use std::sync::Mutex;
use std::thread::{self, JoinHandle};

enum WakeLockCommand {
    Set(bool, SyncSender<bool>),
    Shutdown(SyncSender<()>),
}

/// Thread-safe screen and system wake-lock controller backed by Win32
/// `SetThreadExecutionState` on a dedicated persistent OS thread so the
/// execution state is always set and cleared on the same Win32 thread.
pub struct WakeLockState {
    enabled: AtomicBool,
    sender: Mutex<Option<Sender<WakeLockCommand>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl WakeLockState {
    /// Create a new wake-lock controller in the disabled (`false`) state.
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel::<WakeLockCommand>();
        let worker = thread::Builder::new()
            .name("notl-sare-wakelock".to_string())
            .spawn(move || {
                let mut currently_active = false;
                while let Ok(cmd) = rx.recv() {
                    match cmd {
                        WakeLockCommand::Set(enable, reply) => {
                            let new_state = apply_platform_wake_lock(enable);
                            currently_active = new_state;
                            let _ = reply.send(new_state);
                        }
                        WakeLockCommand::Shutdown(reply) => {
                            if currently_active {
                                let _ = apply_platform_wake_lock(false);
                            }
                            let _ = reply.send(());
                            break;
                        }
                    }
                }
            })
            .ok();

        Self {
            enabled: AtomicBool::new(false),
            sender: Mutex::new(if worker.is_some() { Some(tx) } else { None }),
            worker: Mutex::new(worker),
        }
    }

    /// Enable or disable the display/system wake lock and return the resulting active state.
    pub fn set_enabled(&self, enabled: bool) -> bool {
        let guard = match self.sender.lock() {
            Ok(g) => g,
            Err(_) => return self.enabled.load(Ordering::SeqCst),
        };
        if let Some(tx) = guard.as_ref() {
            let (reply_tx, reply_rx) = mpsc::sync_channel(1);
            if tx.send(WakeLockCommand::Set(enabled, reply_tx)).is_ok() {
                if let Ok(active) = reply_rx.recv() {
                    self.enabled.store(active, Ordering::SeqCst);
                    return active;
                }
            }
        }
        self.enabled.store(false, Ordering::SeqCst);
        false
    }

    /// Return whether wake lock is currently active.
    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
}

impl Default for WakeLockState {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for WakeLockState {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.sender.lock() {
            if let Some(tx) = guard.take() {
                let (ack_tx, ack_rx) = mpsc::sync_channel(1);
                if tx.send(WakeLockCommand::Shutdown(ack_tx)).is_ok() {
                    let _ = ack_rx.recv();
                }
            }
        }
        if let Ok(mut worker_guard) = self.worker.lock() {
            if let Some(handle) = worker_guard.take() {
                let _ = handle.join();
            }
        }
        self.enabled.store(false, Ordering::SeqCst);
    }
}

#[cfg(target_os = "windows")]
fn apply_platform_wake_lock(enabled: bool) -> bool {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };

    let flags = if enabled {
        ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED
    } else {
        ES_CONTINUOUS
    };

    // SAFETY: `SetThreadExecutionState` is a thread-safe Win32 Power API taking plain integer flags.
    let prev = unsafe { SetThreadExecutionState(flags) };
    if enabled {
        prev != 0
    } else {
        false
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_platform_wake_lock(_enabled: bool) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::WakeLockState;

    #[test]
    fn wake_lock_toggle_and_drop() {
        let wake_lock = WakeLockState::new();
        assert!(!wake_lock.is_enabled());

        let enabled = wake_lock.set_enabled(true);
        #[cfg(target_os = "windows")]
        {
            assert!(enabled);
            assert!(wake_lock.is_enabled());
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert!(!enabled);
            assert!(!wake_lock.is_enabled());
        }

        let disabled = wake_lock.set_enabled(false);
        assert!(!disabled);
        assert!(!wake_lock.is_enabled());

        // Re-enable before Drop to verify Drop clears cleanly without panicking.
        let re_enabled = wake_lock.set_enabled(true);
        #[cfg(target_os = "windows")]
        assert!(re_enabled);
        #[cfg(not(target_os = "windows"))]
        assert!(!re_enabled);
        drop(wake_lock);
    }
}
