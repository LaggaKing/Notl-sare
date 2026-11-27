pub mod commands;
pub mod db;
pub mod library;
pub mod wakelock;

use commands::AppState;
use db::Db;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let db = Db::open_default()
                .map_err(|err| Box::<dyn std::error::Error>::from(std::io::Error::other(err)))?;
            app.manage(AppState::new(db));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pick_and_add_library_folder,
            commands::pick_and_import_pdf_files,
            commands::remove_library_folder,
            commands::list_library_folders,
            commands::scan_library,
            commands::list_scores,
            commands::get_score,
            commands::update_score_metadata,
            commands::delete_score_record,
            commands::read_pdf_bytes,
            commands::export_pdf_with_dialog,
            commands::export_backup_with_dialog,
            commands::import_backup_with_dialog,
            commands::list_bookmarks,
            commands::upsert_bookmark,
            commands::delete_bookmark,
            commands::list_setlists,
            commands::create_setlist,
            commands::rename_setlist,
            commands::delete_setlist,
            commands::set_setlist_items,
            commands::get_page_annotations,
            commands::get_score_annotations,
            commands::save_page_annotations,
            commands::get_settings,
            commands::save_settings,
            commands::set_wake_lock,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Notl-sare Tauri application");
}
