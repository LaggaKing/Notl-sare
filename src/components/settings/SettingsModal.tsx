import { useEffect, useState } from 'react';
import { Download, Minus, Plus, Upload, X } from 'lucide-react';
import type {
  AppLanguage,
  AppSettings,
  AppTheme,
  NoteNaming,
  PaperTint,
} from '../../types';
import { formatMessage, useI18n } from '../../i18n';
import {
  exportBackupJson,
  importBackupJson,
  openTextFileWithDialog,
  saveTextFileWithDialog,
} from '../../services/tauriApi';
import './settings.css';

export interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onUpdateSettings: (patch: Partial<AppSettings>) => void | Promise<void>;
  onClose: () => void;
  onBackupRestored?: () => void | Promise<void>;
}

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onToggle: () => void;
}

function ToggleRow({ label, hint, checked, onToggle }: ToggleRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="settings-toggle-row"
      onClick={onToggle}
    >
      <span className="settings-toggle-text">
        <span className="settings-toggle-title">{label}</span>
        {hint && <span className="settings-toggle-hint">{hint}</span>}
      </span>
      <span className={`settings-switch ${checked ? 'is-on' : ''}`} aria-hidden="true">
        <span className="settings-switch-thumb" />
      </span>
    </button>
  );
}

export function SettingsModal({
  open,
  settings,
  onUpdateSettings,
  onClose,
  onBackupRestored,
}: SettingsModalProps) {
  const { t } = useI18n();
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupFeedback, setBackupFeedback] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setBackupFeedback(null);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  function updateField<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    void onUpdateSettings({ [key]: value });
  }

  function stepPitch(delta: number) {
    const next = Math.max(438, Math.min(444, settings.referencePitchHz + delta));
    updateField('referencePitchHz', next);
  }

  async function handleExportBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupFeedback(null);
    try {
      const json = await exportBackupJson();
      const dateStr = new Date().toISOString().slice(0, 10);
      const saved = await saveTextFileWithDialog(
        `notlasare-backup-${dateStr}.json`,
        json,
      );
      if (saved) {
        setBackupFeedback({
          message: t.settings.backupExportSuccess,
          isError: false,
        });
      }
    } catch {
      setBackupFeedback({
        message: t.settings.backupError,
        isError: true,
      });
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreBackup() {
    if (backupBusy) return;
    setBackupBusy(true);
    setBackupFeedback(null);
    try {
      const jsonText = await openTextFileWithDialog();
      if (!jsonText) {
        return;
      }
      const res = await importBackupJson(jsonText);
      await onBackupRestored?.();
      setBackupFeedback({
        message: formatMessage(t.settings.backupRestoreSuccess, {
          scores: res.scoresUpdated,
          annotations: res.annotationsRestored,
        }),
        isError: false,
      });
    } catch {
      setBackupFeedback({
        message: t.settings.backupError,
        isError: true,
      });
    } finally {
      setBackupBusy(false);
    }
  }

  const languageOptions: { value: AppLanguage; label: string }[] = [
    { value: 'sv', label: t.settings.swedish },
    { value: 'en', label: t.settings.english },
  ];

  const noteNamingOptions: { value: NoteNaming; label: string }[] = [
    { value: 'auto', label: t.settings.noteNamingAuto },
    { value: 'sv', label: t.settings.noteNamingSv },
    { value: 'en', label: t.settings.noteNamingEn },
  ];

  const themeOptions: { value: AppTheme; label: string }[] = [
    { value: 'dark', label: t.settings.themeDark },
    { value: 'light', label: t.settings.themeLight },
  ];

  const paperOptions: { value: PaperTint; label: string }[] = [
    { value: 'none', label: t.settings.paperNormal },
    { value: 'warm', label: t.settings.paperWarm },
    { value: 'night', label: t.settings.paperNight },
  ];

  return (
    <div
      className="settings-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={t.settings.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="settings-modal">
        <div className="settings-header">
          <h2>{t.settings.title}</h2>
          <button
            type="button"
            className="settings-close-btn"
            aria-label={t.common.close}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className="settings-body scroll-area">
          <div className="settings-group">
            <span className="settings-group-label">{t.settings.language}</span>
            <div className="settings-segmented">
              {languageOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={settings.language === opt.value}
                  className={`settings-option-btn ${settings.language === opt.value ? 'is-active' : ''}`}
                  onClick={() => updateField('language', opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t.settings.noteNaming}</span>
            <div className="settings-segmented">
              {noteNamingOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={settings.noteNaming === opt.value}
                  className={`settings-option-btn ${settings.noteNaming === opt.value ? 'is-active' : ''}`}
                  onClick={() => updateField('noteNaming', opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t.settings.referencePitch}</span>
            <div className="settings-pitch-row">
              <button
                type="button"
                className="settings-pitch-btn"
                aria-label={t.settings.referencePitchDecrease}
                disabled={settings.referencePitchHz <= 438}
                onClick={() => stepPitch(-1)}
              >
                <Minus size={18} />
              </button>
              <input
                type="range"
                className="settings-pitch-slider"
                min={438}
                max={444}
                step={1}
                value={settings.referencePitchHz}
                aria-label={t.settings.referencePitch}
                onChange={(e) =>
                  updateField('referencePitchHz', Number(e.target.value))
                }
              />
              <button
                type="button"
                className="settings-pitch-btn"
                aria-label={t.settings.referencePitchIncrease}
                disabled={settings.referencePitchHz >= 444}
                onClick={() => stepPitch(1)}
              >
                <Plus size={18} />
              </button>
              <span className="settings-pitch-value">
                {formatMessage(t.settings.hzUnit, {
                  hz: settings.referencePitchHz,
                })}
              </span>
            </div>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t.settings.theme}</span>
            <div className="settings-segmented">
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={settings.theme === opt.value}
                  className={`settings-option-btn ${settings.theme === opt.value ? 'is-active' : ''}`}
                  onClick={() => updateField('theme', opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t.settings.paperTint}</span>
            <div className="settings-segmented">
              {paperOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={settings.paperTint === opt.value}
                  className={`settings-option-btn ${settings.paperTint === opt.value ? 'is-active' : ''}`}
                  onClick={() => updateField('paperTint', opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-group">
            <span className="settings-group-label">
              {t.settings.navigationSection}
            </span>
            <ToggleRow
              label={t.settings.swipeToTurn}
              checked={settings.swipeEnabled}
              onToggle={() =>
                updateField('swipeEnabled', !settings.swipeEnabled)
              }
            />
            <ToggleRow
              label={t.settings.tapZones}
              checked={settings.tapZonesEnabled}
              onToggle={() =>
                updateField('tapZonesEnabled', !settings.tapZonesEnabled)
              }
            />
            <ToggleRow
              label={t.settings.halfPageDefault}
              checked={settings.halfPageModeDefault}
              onToggle={() =>
                updateField('halfPageModeDefault', !settings.halfPageModeDefault)
              }
            />
            <ToggleRow
              label={t.settings.autoCropDefault}
              checked={settings.autoCropDefault}
              onToggle={() =>
                updateField('autoCropDefault', !settings.autoCropDefault)
              }
            />
            <ToggleRow
              label={t.settings.wakeLock}
              hint={t.settings.wakeLockHint}
              checked={settings.wakeLockEnabled}
              onToggle={() =>
                updateField('wakeLockEnabled', !settings.wakeLockEnabled)
              }
            />
          </div>

          <div className="settings-group">
            <span className="settings-group-label">{t.settings.backupSection}</span>
            <div className="settings-backup-actions">
              <button
                type="button"
                className="settings-action-btn"
                disabled={backupBusy}
                onClick={() => void handleExportBackup()}
              >
                <Download size={18} />
                <span>{t.settings.backupExport}</span>
              </button>
              <button
                type="button"
                className="settings-action-btn"
                disabled={backupBusy}
                onClick={() => void handleRestoreBackup()}
              >
                <Upload size={18} />
                <span>{t.settings.backupRestore}</span>
              </button>
            </div>
            {backupFeedback && (
              <div
                className={`settings-status ${backupFeedback.isError ? 'is-error' : ''}`}
                role="status"
              >
                {backupFeedback.message}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
