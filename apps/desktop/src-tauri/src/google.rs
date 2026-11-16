//! Google sign-in for the desktop build: authorization code with PKCE, a loopback redirect to
//! 127.0.0.1 and the system browser. The refresh token goes in the OS keychain and never reaches
//! the webview; the webview only ever gets short-lived access tokens.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, Url};
use tauri_plugin_opener::OpenerExt;

const AUTH: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN: &str = "https://oauth2.googleapis.com/token";
const SCOPES: &str = "openid email https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const KEYCHAIN_SERVICE: &str = "ee.sched.app.google";
/// How long to wait for the user to finish in the browser.
const WAIT: Duration = Duration::from_secs(300);

/// Baked in at compile time from GOOGLE_DESKTOP_CLIENT_ID and GOOGLE_DESKTOP_CLIENT_SECRET.
fn client() -> Result<(&'static str, &'static str), String> {
  match (
    option_env!("GOOGLE_DESKTOP_CLIENT_ID"),
    option_env!("GOOGLE_DESKTOP_CLIENT_SECRET"),
  ) {
    (Some(id), Some(secret)) if !id.is_empty() && !secret.is_empty() => Ok((id, secret)),
    _ => Err("not_configured".into()),
  }
}

/// What the webview gets: no refresh token.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
  access_token: String,
  /// Epoch ms.
  expires_at: u64,
  #[serde(skip_serializing_if = "Option::is_none")]
  email: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  sub: Option<String>,
}

#[derive(Deserialize)]
struct TokenResponse {
  access_token: Option<String>,
  expires_in: Option<u64>,
  refresh_token: Option<String>,
  id_token: Option<String>,
  error: Option<String>,
}

fn random(n: usize) -> Result<String, String> {
  let mut buf = vec![0u8; n];
  getrandom::fill(&mut buf).map_err(|e| e.to_string())?;
  Ok(URL_SAFE_NO_PAD.encode(buf))
}

fn challenge(verifier: &str) -> String {
  URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn now_ms() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map(|d| d.as_millis() as u64)
    .unwrap_or(0)
}

/// Email and subject from an ID token that came straight from Google over TLS.
fn id_claims(id_token: Option<&str>) -> (Option<String>, Option<String>) {
  #[derive(Deserialize)]
  struct Claims {
    email: Option<String>,
    sub: Option<String>,
  }
  let claims = id_token
    .and_then(|t| t.split('.').nth(1))
    .and_then(|p| URL_SAFE_NO_PAD.decode(p.trim_end_matches('=')).ok())
    .and_then(|b| serde_json::from_slice::<Claims>(&b).ok());
  match claims {
    Some(c) => (c.email, c.sub),
    None => (None, None),
  }
}

/// The result of one request to the loopback listener.
#[derive(Debug, PartialEq)]
enum Redirect {
  Code(String),
  Denied(String),
  /// Not ours (a favicon, a stray tab): answer and keep waiting.
  Other,
}

/// Reads a request line like `GET /?state=..&code=.. HTTP/1.1`.
fn parse_redirect(line: &str, state: &str) -> Redirect {
  let Some(path) = line.split_whitespace().nth(1) else {
    return Redirect::Other;
  };
  let Ok(url) = Url::parse(&format!("http://127.0.0.1{path}")) else {
    return Redirect::Other;
  };
  if url.path() != "/" {
    return Redirect::Other;
  }
  let get = |k: &str| {
    url
      .query_pairs()
      .find(|(key, _)| key == k)
      .map(|(_, v)| v.into_owned())
  };
  if get("state").as_deref() != Some(state) {
    return Redirect::Other;
  }
  match (get("code"), get("error")) {
    (Some(code), _) if !code.is_empty() => Redirect::Code(code),
    (_, Some(error)) => Redirect::Denied(error),
    _ => Redirect::Denied("no_code".into()),
  }
}

fn reply(mut stream: TcpStream, status: &str, body: &str) {
  let html = format!(
    "<!doctype html><meta charset=\"utf-8\"><title>Schedee</title><p style=\"font:14px system-ui;margin:40px\">{body}</p>"
  );
  let _ = write!(
    stream,
    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n{html}",
    html.len()
  );
}

/// Waits for Google to redirect the browser back with our state.
fn wait_for_code(listener: TcpListener, state: &str) -> Result<String, String> {
  listener.set_nonblocking(true).map_err(|e| e.to_string())?;
  let deadline = Instant::now() + WAIT;
  while Instant::now() < deadline {
    let stream = match listener.accept() {
      Ok((s, _)) => s,
      Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
        std::thread::sleep(Duration::from_millis(100));
        continue;
      }
      Err(e) => return Err(e.to_string()),
    };
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    if BufReader::new(&stream).read_line(&mut line).is_err() {
      continue;
    }
    match parse_redirect(&line, state) {
      Redirect::Code(code) => {
        reply(stream, "200 OK", "Signed in. You can close this tab and go back to Schedee.");
        return Ok(code);
      }
      Redirect::Denied(error) => {
        reply(stream, "200 OK", "Sign-in didn't finish. You can close this tab.");
        return Err(error);
      }
      Redirect::Other => reply(stream, "404 Not Found", "Not found."),
    }
  }
  Err("timeout".into())
}

async fn post_token(form: &[(&str, &str)]) -> Result<TokenResponse, String> {
  let res = reqwest::Client::new()
    .post(TOKEN)
    .form(form)
    .send()
    .await
    .map_err(|e| format!("network: {e}"))?;
  let r: TokenResponse = res.json().await.map_err(|e| e.to_string())?;
  if let Some(error) = r.error {
    return Err(error);
  }
  Ok(r)
}

fn keychain(account_id: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(KEYCHAIN_SERVICE, account_id).map_err(|e| e.to_string())
}

fn session(r: TokenResponse) -> Result<Session, String> {
  let (email, sub) = id_claims(r.id_token.as_deref());
  Ok(Session {
    access_token: r.access_token.ok_or("no_token")?,
    expires_at: now_ms() + r.expires_in.unwrap_or(3600) * 1000,
    email,
    sub,
  })
}

/// Opens Google's consent page in the browser and resolves with the signed-in account. The
/// refresh token is saved to the keychain under `google:<email>`.
#[tauri::command]
pub async fn google_sign_in(
  app: AppHandle,
  login_hint: Option<String>,
) -> Result<Session, String> {
  let (client_id, secret) = client()?;
  let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
  let port = listener.local_addr().map_err(|e| e.to_string())?.port();
  let redirect_uri = format!("http://127.0.0.1:{port}");
  let state = random(32)?;
  let verifier = random(32)?;

  let mut url = Url::parse(AUTH).map_err(|e| e.to_string())?;
  url
    .query_pairs_mut()
    .append_pair("client_id", client_id)
    .append_pair("redirect_uri", &redirect_uri)
    .append_pair("response_type", "code")
    .append_pair("scope", SCOPES)
    .append_pair("access_type", "offline")
    .append_pair("prompt", "consent")
    .append_pair("include_granted_scopes", "true")
    .append_pair("code_challenge", &challenge(&verifier))
    .append_pair("code_challenge_method", "S256")
    .append_pair("state", &state);
  if let Some(hint) = login_hint.as_deref().filter(|h| !h.is_empty()) {
    url.query_pairs_mut().append_pair("login_hint", hint);
  }
  app
    .opener()
    .open_url(url.as_str(), None::<&str>)
    .map_err(|e| e.to_string())?;

  let code = tauri::async_runtime::spawn_blocking(move || wait_for_code(listener, &state))
    .await
    .map_err(|e| e.to_string())??;
  if let Some(w) = app.get_webview_window("main") {
    let _ = w.set_focus();
  }

  let r = post_token(&[
    ("client_id", client_id),
    ("client_secret", secret),
    ("grant_type", "authorization_code"),
    ("code", &code),
    ("code_verifier", &verifier),
    ("redirect_uri", &redirect_uri),
  ])
  .await?;
  let refresh = r.refresh_token.clone().ok_or("no_refresh_token")?;
  let s = session(r)?;
  let email = s.email.clone().ok_or("no_email")?;
  keychain(&format!("google:{email}"))?
    .set_password(&refresh)
    .map_err(|e| format!("keychain: {e}"))?;
  Ok(s)
}

/// A fresh access token for an account signed in on this device. Fails with `invalid_grant` when
/// Google has revoked the grant, and `not_signed_in` when the keychain has nothing for it.
#[tauri::command]
pub async fn google_refresh(account_id: String) -> Result<Session, String> {
  let (client_id, secret) = client()?;
  let entry = keychain(&account_id)?;
  let refresh = match entry.get_password() {
    Ok(t) => t,
    Err(keyring::Error::NoEntry) => return Err("not_signed_in".into()),
    Err(e) => return Err(format!("keychain: {e}")),
  };
  let r = post_token(&[
    ("client_id", client_id),
    ("client_secret", secret),
    ("grant_type", "refresh_token"),
    ("refresh_token", &refresh),
  ])
  .await?;
  // Google may rotate the refresh token.
  if let Some(next) = r.refresh_token.as_deref() {
    let _ = entry.set_password(next);
  }
  session(r)
}

/// Removes an account's refresh token from the keychain.
#[tauri::command]
pub fn google_forget(account_id: String) -> Result<(), String> {
  match keychain(&account_id)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(format!("keychain: {e}")),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn reads_the_code_for_our_state() {
    assert_eq!(
      parse_redirect("GET /?state=abc&code=4%2F0xyz&scope=email HTTP/1.1\r\n", "abc"),
      Redirect::Code("4/0xyz".into())
    );
  }

  #[test]
  fn ignores_other_requests_and_states() {
    assert_eq!(parse_redirect("GET /favicon.ico HTTP/1.1", "abc"), Redirect::Other);
    assert_eq!(parse_redirect("GET /?state=zzz&code=1 HTTP/1.1", "abc"), Redirect::Other);
    assert_eq!(parse_redirect("", "abc"), Redirect::Other);
  }

  #[test]
  fn reports_a_denial() {
    assert_eq!(
      parse_redirect("GET /?state=abc&error=access_denied HTTP/1.1", "abc"),
      Redirect::Denied("access_denied".into())
    );
  }

  #[test]
  fn pkce_challenge_matches_rfc_7636() {
    assert_eq!(
      challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  }

  #[test]
  fn reads_email_from_the_id_token() {
    let payload = URL_SAFE_NO_PAD.encode(br#"{"email":"ada@example.com","sub":"1"}"#);
    assert_eq!(
      id_claims(Some(&format!("x.{payload}.y"))),
      (Some("ada@example.com".into()), Some("1".into()))
    );
    assert_eq!(id_claims(None), (None, None));
  }
}
