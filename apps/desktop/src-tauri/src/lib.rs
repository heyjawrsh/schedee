mod caldav;
mod desktop;
mod feed;
mod google;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_autostart::Builder::new().build())
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .manage(desktop::Shortcuts::default())
    .invoke_handler(tauri::generate_handler![
      google::google_sign_in,
      google::google_refresh,
      google::google_forget,
      feed::fetch_feed,
      caldav::caldav_save,
      caldav::caldav_forget,
      caldav::caldav_request,
      desktop::autostart_get,
      desktop::autostart_set,
      desktop::shortcut_set,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
