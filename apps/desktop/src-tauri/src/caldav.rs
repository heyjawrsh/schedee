//! CalDAV for the desktop build (iCloud and other servers). The login, including the password,
//! lives in the OS keychain and never reaches the webview. The webview sends WebDAV requests
//! through `caldav_request`, which adds the login and only talks to the account's own server.

use serde::{Deserialize, Serialize};
use std::time::Duration;
use url::Url;

const KEYCHAIN_SERVICE: &str = "ee.sched.app.caldav";
const TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BYTES: usize = 20 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;
/// Discovery, sync, and writing single resources.
const METHODS: [&str; 5] = ["PROPFIND", "REPORT", "GET", "PUT", "DELETE"];

#[derive(Serialize, Deserialize)]
struct Login {
  server: String,
  username: String,
  password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DavResponse {
  status: u16,
  body: String,
  /// Where the request ended up after redirects, for resolving relative hrefs.
  url: String,
  /// The resource's new version after a write, when the server says.
  #[serde(skip_serializing_if = "Option::is_none")]
  etag: Option<String>,
}

/// Extra request details for writes.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Options {
  depth: Option<String>,
  body: Option<String>,
  /// Defaults to XML; iCalendar for PUT.
  content_type: Option<String>,
  /// Only write over this version.
  if_match: Option<String>,
  /// Only create: fail if the resource exists.
  if_none_match: Option<bool>,
}

fn keychain(account_id: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(KEYCHAIN_SERVICE, account_id).map_err(|e| e.to_string())
}

fn load(account_id: &str) -> Result<Login, String> {
  match keychain(account_id)?.get_password() {
    Ok(json) => serde_json::from_str(&json).map_err(|_| "not_signed_in".into()),
    Err(keyring::Error::NoEntry) => Err("not_signed_in".into()),
    Err(e) => Err(format!("keychain: {e}")),
  }
}

/// HTTPS on the account's own host. iCloud hands out per-user hosts (pNN-caldav.icloud.com), so
/// any icloud.com host is fine for an icloud.com account.
fn allowed(server: &Url, to: &Url) -> bool {
  if to.scheme() != "https" || !to.username().is_empty() || to.password().is_some() {
    return false;
  }
  let (Some(a), Some(b)) = (server.host_str(), to.host_str()) else {
    return false;
  };
  let icloud = |h: &str| h == "icloud.com" || h.ends_with(".icloud.com");
  a.eq_ignore_ascii_case(b) && server.port_or_known_default() == to.port_or_known_default()
    || icloud(a) && icloud(b)
}

/// Saves a login to the keychain. Replaces what was there for this account.
#[tauri::command]
pub fn caldav_save(
  account_id: String,
  server: String,
  username: String,
  password: String,
) -> Result<(), String> {
  let url = Url::parse(&server).map_err(|_| "bad_url".to_string())?;
  if !allowed(&url, &url) {
    return Err("not_allowed".into());
  }
  let json = serde_json::to_string(&Login { server, username, password }).map_err(|e| e.to_string())?;
  keychain(&account_id)?
    .set_password(&json)
    .map_err(|e| format!("keychain: {e}"))
}

/// Removes an account's login from the keychain.
#[tauri::command]
pub fn caldav_forget(account_id: String) -> Result<(), String> {
  match keychain(&account_id)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(format!("keychain: {e}")),
  }
}

/// One WebDAV request with the account's login. Follows redirects that stay on the account's
/// server. Answers with any HTTP status; fails only when the request can't be made.
#[tauri::command]
pub async fn caldav_request(
  account_id: String,
  method: String,
  url: String,
  options: Option<Options>,
) -> Result<DavResponse, String> {
  let o = options.unwrap_or_default();
  if !METHODS.contains(&method.as_str()) {
    return Err("not_allowed".into());
  }
  let login = load(&account_id)?;
  let server = Url::parse(&login.server).map_err(|_| "bad_url".to_string())?;
  let mut to = Url::parse(&url).map_err(|_| "bad_url".to_string())?;
  let verb = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
  let client = reqwest::Client::builder()
    .redirect(reqwest::redirect::Policy::none())
    .timeout(TIMEOUT)
    .build()
    .map_err(|e| e.to_string())?;

  for _ in 0..=MAX_REDIRECTS {
    if !allowed(&server, &to) {
      return Err("not_allowed".into());
    }
    let mut req = client
      .request(verb.clone(), to.clone())
      .basic_auth(&login.username, Some(&login.password))
      .header("User-Agent", "Schedee (+https://github.com/heyjawrsh/schedee)");
    if let Some(d) = &o.depth {
      req = req.header("Depth", d);
    }
    if let Some(m) = &o.if_match {
      req = req.header("If-Match", m);
    }
    if o.if_none_match == Some(true) {
      req = req.header("If-None-Match", "*");
    }
    if let Some(b) = &o.body {
      let kind = match o.content_type.as_deref() {
        Some("text/calendar") => "text/calendar; charset=utf-8",
        _ => "application/xml; charset=utf-8",
      };
      req = req.header("Content-Type", kind).body(b.clone());
    }
    let res = req.send().await.map_err(|e| format!("network: {e}"))?;
    let status = res.status();
    if status.is_redirection() {
      let next = res
        .headers()
        .get("Location")
        .and_then(|l| l.to_str().ok())
        .and_then(|l| to.join(l).ok())
        .ok_or("not_allowed")?;
      to = next;
      continue;
    }
    if res.content_length().unwrap_or(0) as usize > MAX_BYTES {
      return Err("too_large".into());
    }
    let etag = res
      .headers()
      .get("ETag")
      .and_then(|v| v.to_str().ok())
      .map(str::to_owned);
    let bytes = res.bytes().await.map_err(|e| format!("network: {e}"))?;
    if bytes.len() > MAX_BYTES {
      return Err("too_large".into());
    }
    return Ok(DavResponse {
      status: status.as_u16(),
      body: String::from_utf8_lossy(&bytes).into_owned(),
      url: to.to_string(),
      etag,
    });
  }
  Err("not_allowed".into())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn ok(server: &str, to: &str) -> bool {
    allowed(&Url::parse(server).unwrap(), &Url::parse(to).unwrap())
  }

  #[test]
  fn only_the_accounts_own_server() {
    assert!(ok("https://dav.example.com/", "https://dav.example.com/cal/"));
    assert!(!ok("https://dav.example.com/", "https://evil.example.net/"));
    assert!(!ok("https://dav.example.com/", "https://other.example.com/"));
    assert!(!ok("https://dav.example.com/", "http://dav.example.com/"));
    assert!(!ok("https://dav.example.com/", "https://dav.example.com:8443/"));
    assert!(!ok("https://dav.example.com/", "https://u:p@dav.example.com/"));
  }

  #[test]
  fn icloud_hosts_go_together() {
    assert!(ok("https://caldav.icloud.com/", "https://p42-caldav.icloud.com/123/calendars/"));
    assert!(!ok("https://caldav.icloud.com/", "https://icloud.com.evil.net/"));
    assert!(!ok("https://caldav.icloud.com/", "https://evilicloud.com/"));
  }
}
