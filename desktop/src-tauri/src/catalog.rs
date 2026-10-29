use std::time::Duration;

use reqwest::Client;
use url::Url;

use crate::models::{Health, LibraryPage, Track, VersionEvent};

const PAGE_SIZE: u32 = 500;
const MAX_TRACKS: usize = 100_000;

/// Accepts `http://host:port`, `host:port`, or a connection URL with the token in the
/// fragment. Returns (base_url, token_from_url).
pub fn normalize_base(input: &str) -> Result<(String, Option<String>), String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("Укажите адрес телефона".to_string());
    }
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("http://{raw}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|_| "Некорректный URL".to_string())?;

    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Поддерживаются только http:// и https://".to_string());
    }
    if url.username() != "" || url.password().is_some() {
        return Err("URL не должен содержать логин или пароль".to_string());
    }
    if url.path() != "/" && !url.path().is_empty() {
        return Err("Укажите корневой адрес сервера, без пути".to_string());
    }

    let mut token = None;
    if let Some(fragment) = url.fragment() {
        for part in fragment.split('&') {
            if let Some(value) = part.strip_prefix("token=") {
                if !value.is_empty() {
                    token = Some(value.to_string());
                }
            }
        }
    }
    if let Some(query) = url.query() {
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            if key == "token" && !value.is_empty() {
                token = Some(value.into_owned());
            }
        }
    }

    let host = url
        .host_str()
        .ok_or_else(|| "В URL не указан адрес".to_string())?
        .to_string();
    let port = url
        .port()
        .unwrap_or(if url.scheme() == "https" { 443 } else { 8765 });
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host
    };
    let base_url = format!("{}://{}:{}", url.scheme(), host, port);

    url.set_fragment(None);
    url.set_query(None);

    Ok((base_url, token))
}

fn connection_error(err: reqwest::Error) -> String {
    if err.is_timeout() {
        "Телефон не ответил вовремя. Проверьте Wi-Fi и адрес.".to_string()
    } else {
        format!("Не удалось подключиться к телефону: {err}")
    }
}

pub async fn health(client: &Client, base_url: &str) -> Result<Health, String> {
    let response = client
        .get(format!("{}/health", base_url.trim_end_matches('/')))
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(connection_error)?;

    if !response.status().is_success() {
        return Err(format!("Сервер вернул HTTP {}", response.status().as_u16()));
    }

    let health = response
        .json::<Health>()
        .await
        .map_err(|_| "Это не VibeCast: неверный ответ /health".to_string())?;

    if !health.ok || health.app != "vibecast" {
        return Err("Это не VibeCast: неверный ответ /health".to_string());
    }
    if health.protocol < 1 {
        return Err("Неподдерживаемая версия протокола".to_string());
    }
    Ok(health)
}

async fn fetch_page(
    client: &Client,
    base_url: &str,
    token: &str,
    offset: u32,
) -> Result<LibraryPage, String> {
    let response = client
        .get(format!(
            "{}/library?offset={}&limit={}",
            base_url.trim_end_matches('/'),
            offset,
            PAGE_SIZE
        ))
        .bearer_auth(token)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(connection_error)?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err("Неверный токен. Скопируйте токен или ссылку с экрана телефона.".to_string());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Сервер вернул HTTP {} при чтении библиотеки",
            response.status().as_u16()
        ));
    }

    response
        .json::<LibraryPage>()
        .await
        .map_err(|_| "Неверный формат ответа /library".to_string())
}

pub async fn validate_token(
    client: &Client,
    base_url: &str,
    token: &str,
) -> Result<Health, String> {
    let health = health(client, base_url).await?;
    fetch_page(client, base_url, token, 0)
        .await
        .map_err(|err| {
            if err.starts_with("Неверный токен") {
                err
            } else {
                format!("{err}. Проверьте токен и подключение.")
            }
        })?;
    Ok(health)
}

pub async fn fetch_library(
    client: &Client,
    base_url: &str,
    token: &str,
) -> Result<(Vec<Track>, i64), String> {
    let mut tracks: Vec<Track> = Vec::new();
    let mut version: Option<i64> = None;
    let mut total: i64 = 0;
    let mut offset: u32 = 0;

    loop {
        let page = fetch_page(client, base_url, token, offset).await?;

        if page.version < 0 {
            return Err("Сервер вернул некорректную версию библиотеки".to_string());
        }

        match version {
            None => {
                version = Some(page.version);
                total = page.total.max(0);
            }
            Some(expected) if page.version != expected => {
                return Err("Библиотека изменилась во время синхронизации".to_string());
            }
            _ => {}
        }

        if page.tracks.is_empty() {
            break;
        }

        let received = page.tracks.len();
        tracks.extend(page.tracks);
        offset = offset.saturating_add(received as u32);

        if tracks.len() as i64 >= total || tracks.len() >= MAX_TRACKS {
            break;
        }
        if received == 0 {
            break;
        }
    }

    if tracks.len() as i64 != total {
        return Err(format!(
            "Библиотека загружена не полностью ({} из {} треков)",
            tracks.len(),
            total
        ));
    }

    Ok((tracks, version.unwrap_or(0)))
}

/// Extracts one SSE `data:` line. Heartbeats (comment lines) are ignored.
pub fn parse_sse_data(line: &str) -> Option<VersionEvent> {
    let line = line.trim_end_matches('\r').trim();
    let data = line.strip_prefix("data:")?.trim();
    serde_json::from_str::<VersionEvent>(data).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_host_and_default_port() {
        assert_eq!(
            normalize_base("192.168.1.5").unwrap(),
            ("http://192.168.1.5:8765".to_string(), None)
        );
        assert_eq!(
            normalize_base("http://phone.local:9000/").unwrap(),
            ("http://phone.local:9000".to_string(), None)
        );
    }

    #[test]
    fn extracts_token_from_fragment_and_query() {
        let (base, token) = normalize_base("http://10.0.0.2:8765/#token=abcDEF").unwrap();
        assert_eq!(base, "http://10.0.0.2:8765");
        assert_eq!(token.as_deref(), Some("abcDEF"));

        let (_, token) = normalize_base("http://10.0.0.2:8765/?token=xyz").unwrap();
        assert_eq!(token.as_deref(), Some("xyz"));
    }

    #[test]
    fn rejects_bad_urls() {
        assert!(normalize_base("").is_err());
        assert!(normalize_base("ftp://10.0.0.2").is_err());
        assert!(normalize_base("http://10.0.0.2:8765/path").is_err());
    }

    #[test]
    fn parses_sse_version_lines() {
        assert_eq!(
            parse_sse_data("data: {\"version\": 12}").map(|event| event.version),
            Some(12)
        );
        assert!(parse_sse_data(": ping").is_none());
        assert!(parse_sse_data("event: version").is_none());
    }
}
