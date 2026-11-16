//! Desktop conveniences: opening at login and system-wide shortcuts. The webview keeps the user's
//! choices and hands them over at startup; this side registers them with the OS.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// The event the webview listens for to start a new event.
pub const NEW_EVENT: &str = "schedee://new-event";

/// What's registered for each action, so changing one replaces only its own keys.
#[derive(Default)]
pub struct Shortcuts(Mutex<Registered>);

#[derive(Default)]
struct Registered {
  show: Option<Shortcut>,
  new_event: Option<Shortcut>,
}

#[tauri::command]
pub fn autostart_get<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
  app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn autostart_set<R: Runtime>(app: AppHandle<R>, on: bool) -> Result<(), String> {
  let launch = app.autolaunch();
  if on { launch.enable() } else { launch.disable() }.map_err(|e| e.to_string())
}

/// Brings the window forward, or hides the app when it's already in front.
fn toggle<R: Runtime>(app: &AppHandle<R>) {
  let Some(w) = app.get_webview_window("main") else {
    return;
  };
  if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
    #[cfg(target_os = "macos")]
    let _ = app.hide();
    #[cfg(not(target_os = "macos"))]
    let _ = w.hide();
  } else {
    reveal(app);
  }
}

fn reveal<R: Runtime>(app: &AppHandle<R>) {
  #[cfg(target_os = "macos")]
  let _ = app.show();
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.unminimize();
    let _ = w.show();
    let _ = w.set_focus();
  }
}

/// Sets the keys for "show" or "new-event"; empty keys turn it off. Fails with "taken" when
/// another app already has them, or "bad_keys" when they can't be read.
#[tauri::command]
pub fn shortcut_set<R: Runtime>(
  app: AppHandle<R>,
  state: State<'_, Shortcuts>,
  action: String,
  keys: String,
) -> Result<(), String> {
  let next = match keys.trim() {
    "" => None,
    k => Some(k.parse::<Shortcut>().map_err(|_| "bad_keys".to_string())?),
  };
  let mut reg = state.0.lock().map_err(|e| e.to_string())?;
  let slot = match action.as_str() {
    "show" => &mut reg.show,
    "new-event" => &mut reg.new_event,
    _ => return Err("bad_action".into()),
  };
  if *slot == next {
    return Ok(());
  }
  let gs = app.global_shortcut();
  if let Some(old) = slot.take() {
    let _ = gs.unregister(old);
  }
  let Some(sc) = next else {
    return Ok(());
  };
  let new_event = action == "new-event";
  gs.on_shortcut(sc, move |app, _, event| {
    if event.state != ShortcutState::Pressed {
      return;
    }
    if new_event {
      reveal(app);
      let _ = app.emit(NEW_EVENT, ());
    } else {
      toggle(app);
    }
  })
  .map_err(|_| "taken".to_string())?;
  *slot = Some(sc);
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_the_keys_the_webview_sends() {
    for k in ["Control+Alt+Super+S", "Control+Alt+Super+N", "Shift+Super+Space"] {
      assert!(k.parse::<Shortcut>().is_ok(), "{k}");
    }
    assert!("Control+Banana".parse::<Shortcut>().is_err());
  }
}
