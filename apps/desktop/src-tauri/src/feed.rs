//! Fetches ICS feeds for the desktop app. Same rules as the web build's Worker: GET only, public
//! hosts only, a size cap and a timeout. Feed URLs often carry a secret, so nothing is logged.

use reqwest::{redirect, Url};
use serde::Serialize;
use std::time::Duration;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 5;
const PRIVATE_SUFFIXES: [&str; 6] = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home.arpa",
  ".intranet",
];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Feed {
  status: u16,
  #[serde(skip_serializing_if = "Option::is_none")]
  body: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  etag: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  last_modified: Option<String>,
}

/// Only public web hosts: no IP literals, no local names, no credentials in the URL.
pub fn allowed(raw: &str) -> Option<Url> {
  let trimmed = raw.trim();
  let lower = trimmed.to_ascii_lowercase();
  let fixed = if lower.starts_with("webcal://") {
    format!("https://{}", &trimmed[9..])
  } else if lower.starts_with("webcals://") {
    format!("https://{}", &trimmed[10..])
  } else {
    trimmed.to_string()
  };
  let url = Url::parse(&fixed).ok()?;
  if url.scheme() != "https" && url.scheme() != "http" {
    return None;
  }
  if !url.username().is_empty() || url.password().is_some() {
    return None;
  }
  match url.host()? {
    url::Host::Domain(d) => {
      let host = d.trim_end_matches('.').to_ascii_lowercase();
      if !host.contains('.') || host == "localhost" {
        return None;
      }
      if PRIVATE_SUFFIXES.iter().any(|s| host.ends_with(s)) {
        return None;
      }
    }
    _ => return None,
  }
  Some(url)
}

#[tauri::command]
pub async fn fetch_feed(
  url: String,
  etag: Option<String>,
  last_modified: Option<String>,
) -> Result<Feed, String> {
  let url = allowed(&url).ok_or("not_allowed")?;
  let client = reqwest::Client::builder()
    .timeout(TIMEOUT)
    .user_agent("Schedee (+https://github.com/heyjawrsh/schedee)")
    .redirect(redirect::Policy::custom(|attempt| {
      if attempt.previous().len() >= MAX_REDIRECTS || allowed(attempt.url().as_str()).is_none() {
        attempt.error("not_allowed")
      } else {
        attempt.follow()
      }
    }))
    .build()
    .map_err(|e| format!("network: {e}"))?;
  let mut req = client
    .get(url)
    .header("Accept", "text/calendar, */*;q=0.5");
  if let Some(e) = etag {
    req = req.header("If-None-Match", e);
  }
  if let Some(m) = last_modified {
    req = req.header("If-Modified-Since", m);
  }
  let mut res = req.send().await.map_err(|e| {
    if e.is_redirect() {
      "not_allowed".to_string()
    } else {
      // No answer reads as offline on the other side.
      format!("network: {}", e.without_url())
    }
  })?;
  let status = res.status().as_u16();
  if status == 304 {
    return Ok(Feed { status, body: None, etag: None, last_modified: None });
  }
  if !res.status().is_success() {
    return Err(format!("upstream: {status}"));
  }
  let header = |name: &str| {
    res
      .headers()
      .get(name)
      .and_then(|v| v.to_str().ok())
      .map(str::to_string)
  };
  let etag = header("etag");
  let last_modified = header("last-modified");
  if res.content_length().unwrap_or(0) as usize > MAX_BYTES {
    return Err("too_large".into());
  }
  let mut bytes = Vec::new();
  while let Some(chunk) = res
    .chunk()
    .await
    .map_err(|e| format!("network: {}", e.without_url()))?
  {
    bytes.extend_from_slice(&chunk);
    if bytes.len() > MAX_BYTES {
      return Err("too_large".into());
    }
  }
  Ok(Feed {
    status,
    body: Some(String::from_utf8_lossy(&bytes).into_owned()),
    etag,
    last_modified,
  })
}

#[cfg(test)]
mod tests {
  use super::allowed;

  #[test]
  fn allows_public_hosts_only() {
    assert_eq!(
      allowed("webcal://p01-calendars.icloud.com/x").map(|u| u.to_string()),
      Some("https://p01-calendars.icloud.com/x".into())
    );
    assert!(allowed("https://calendar.google.com/a.ics").is_some());
    for bad in [
      "file:///etc/passwd",
      "ftp://example.com/a.ics",
      "http://localhost:8787/health",
      "http://127.0.0.1/a.ics",
      "http://10.0.0.5/a.ics",
      "http://[::1]/a.ics",
      "http://printer.local/a.ics",
      "http://intranet/a.ics",
      "https://user:pass@example.com/a.ics",
    ] {
      assert!(allowed(bad).is_none(), "{bad}");
    }
  }
}
