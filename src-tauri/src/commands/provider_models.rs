use super::{settings::resolve_oauth_credential, settings_types::GetProviderCredentialInput};
use crate::{
    app_state::AppState,
    repositories::settings_repository::{default_base_url_for, load_credential},
};
use reqwest::blocking::Client;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    io::Read,
    time::{Duration, Instant, SystemTime},
};
use tauri::Manager;
use url::Url;

// 기존 ChatGPT 로그인은 OpenGem의 버전과 별개로 Codex 호환 버전을 요구합니다.
const CODEX_CATALOG_VERSION: &str = match option_env!("OPENGEM_CODEX_CATALOG_VERSION") {
    Some(version) if !version.is_empty() => version,
    _ => "0.167.0",
};
const CATALOG_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize)]
pub struct ProviderModel {
    id: String,
    name: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Catalog {
    ChatGpt,
    OpenAi,
    Anthropic,
    Gemini,
    OpenRouter,
    Custom,
}

impl Catalog {
    fn for_connection(provider: &str, kind: &str) -> Result<Self, String> {
        match (provider, kind) {
            ("openai", "oauth") => Ok(Self::ChatGpt),
            ("openai", "api-key") => Ok(Self::OpenAi),
            ("anthropic", "api-key") => Ok(Self::Anthropic),
            ("google", "api-key") => Ok(Self::Gemini),
            ("openrouter", "api-key") => Ok(Self::OpenRouter),
            ("custom", "api-key") => Ok(Self::Custom),
            _ => Err("지원하지 않는 공급자 인증 방식입니다.".to_string()),
        }
    }

    fn endpoint(self, base: &str) -> Result<Url, String> {
        let mut url =
            Url::parse(base.trim()).map_err(|_| "공급자 API 주소가 올바르지 않습니다.")?;
        if !matches!(url.scheme(), "http" | "https")
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("공급자 API 기본 주소가 올바르지 않습니다.".to_string());
        }
        {
            let mut path = url
                .path_segments_mut()
                .map_err(|_| "공급자 API 경로가 올바르지 않습니다.")?;
            path.pop_if_empty().push("models");
            if self == Self::OpenRouter {
                path.push("user");
            }
        }
        match self {
            Self::ChatGpt => {
                url.query_pairs_mut()
                    .append_pair("client_version", CODEX_CATALOG_VERSION);
            }
            Self::Gemini => {
                url.query_pairs_mut().append_pair("pageSize", "1000");
            }
            Self::Anthropic => {
                url.query_pairs_mut().append_pair("limit", "1000");
            }
            _ => {}
        }
        Ok(url)
    }

    fn model(self, value: &Value, today: &str) -> Option<ProviderModel> {
        let (id_key, name_key) = match self {
            Self::ChatGpt if value["visibility"] != "list" => return None,
            Self::ChatGpt => ("slug", "display_name"),
            Self::Gemini if !contains(&value["supportedGenerationMethods"], "generateContent") => {
                return None
            }
            Self::Gemini => ("name", "displayName"),
            Self::Anthropic => ("id", "display_name"),
            Self::OpenRouter => {
                let outputs = &value["architecture"]["output_modalities"];
                if (outputs.is_array() && !contains(outputs, "text"))
                    || (value["endpoints"].is_array()
                        && !contains(&value["endpoints"], "/api/v1/responses"))
                {
                    return None;
                }
                ("id", "name")
            }
            _ => ("id", "name"),
        };
        let raw = value[id_key].as_str()?.trim();
        let id = if self == Self::Gemini {
            let id = raw.strip_prefix("models/")?;
            // generateContent는 음성 합성과 이미지 생성 전용 모델도 지원합니다.
            if id
                .split('-')
                .any(|part| matches!(part, "tts" | "image" | "imagen" | "banana" | "lyria"))
            {
                return None;
            }
            id
        } else {
            raw
        };
        if id.is_empty()
            || (self == Self::OpenAi
                && (value["shutdown_date"]
                    .as_str()
                    .is_some_and(|date| date <= today)
                    || !openai_text_model(id)))
        {
            return None;
        }
        let name = value[name_key]
            .as_str()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(id);
        Some(ProviderModel {
            id: id.into(),
            name: name.into(),
        })
    }
}

fn contains(list: &Value, text: &str) -> bool {
    list.as_array()
        .is_some_and(|items| items.iter().any(|item| item == text))
}

// OpenAI 목록은 응답 생성 외에 음성, 이미지, 임베딩 전용 모델도 포함합니다.
fn openai_text_model(model: &str) -> bool {
    let id = model
        .strip_prefix("ft:")
        .unwrap_or(model)
        .split(':')
        .next()
        .unwrap_or(model);
    let language_model = id.starts_with("gpt-")
        || id.starts_with("chatgpt-")
        || id.starts_with("codex-")
        || id.starts_with("computer-use")
        || id
            .strip_prefix('o')
            .and_then(|s| s.bytes().next())
            .is_some_and(|b| b.is_ascii_digit());
    language_model
        && ![
            "audio",
            "realtime",
            "transcribe",
            "-live",
            "tts",
            "image",
            "instruct",
            "search-preview",
        ]
        .iter()
        .any(|tag| id.contains(tag))
}

fn fetch_models(
    catalog: Catalog,
    base: &str,
    secret: Option<&str>,
    account: Option<&str>,
) -> Result<Vec<ProviderModel>, String> {
    let endpoint = catalog.endpoint(base)?;
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "모델 목록 조회를 시작하지 못했습니다.")?;
    let started = Instant::now();
    let today = chrono::DateTime::<chrono::Utc>::from(SystemTime::now())
        .format("%Y-%m-%d")
        .to_string();
    let mut models = Vec::new();
    let mut cursors = HashSet::new();
    let mut url = endpoint.clone();
    loop {
        let remaining = CATALOG_TIMEOUT
            .checked_sub(started.elapsed())
            .ok_or("모델 목록 조회 시간이 초과되었습니다.")?;
        let request = client.get(url).timeout(remaining);
        let request = match (catalog, secret, account) {
            (Catalog::Custom, None, _) => request,
            (_, None, _) => return Err("공급자 연결 인증이 필요합니다.".to_string()),
            (Catalog::Anthropic, Some(secret), _) => request
                .header("x-api-key", secret)
                .header("anthropic-version", "2023-06-01"),
            (Catalog::Gemini, Some(secret), _) => request.header("x-goog-api-key", secret),
            (Catalog::ChatGpt, Some(secret), Some(account)) => request
                .bearer_auth(secret)
                .header("ChatGPT-Account-Id", account),
            (_, Some(secret), _) => request.bearer_auth(secret),
        };
        let response = request
            .send()
            .map_err(|_| "공급자의 모델 목록 API에 연결하지 못했습니다.")?;
        if !response.status().is_success() {
            return Err(format!(
                "모델 목록 조회에 실패했습니다 (HTTP {}).",
                response.status().as_u16()
            ));
        }
        let page: Value = serde_json::from_reader(response.take(16 * 1024 * 1024))
            .map_err(|_| "공급자가 올바른 모델 목록을 반환하지 않았습니다.")?;
        let list_key = if matches!(catalog, Catalog::ChatGpt | Catalog::Gemini) {
            "models"
        } else {
            "data"
        };
        let items = page[list_key]
            .as_array()
            .ok_or("공급자 응답에 모델 목록이 없습니다.")?;
        models.extend(items.iter().filter_map(|item| catalog.model(item, &today)));
        let next = match catalog {
            Catalog::Anthropic if page["has_more"] == true => Some((
                "after_id",
                page["last_id"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .ok_or("모델 목록의 다음 페이지가 누락되었습니다.")?,
            )),
            Catalog::Gemini => page["nextPageToken"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| ("pageToken", s)),
            _ => None,
        };
        let Some((parameter, cursor)) = next else {
            return Ok(models);
        };
        if !cursors.insert(cursor.to_string()) {
            return Err("모델 목록의 다음 페이지가 반복되었습니다.".to_string());
        }
        url = endpoint.clone();
        url.query_pairs_mut().append_pair(parameter, cursor);
    }
}

#[tauri::command]
pub async fn list_provider_models(
    app: tauri::AppHandle,
    input: GetProviderCredentialInput,
) -> Result<Vec<ProviderModel>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let provider = input.provider_id.as_str();
        let kind = input.credential_type.as_str();
        let catalog = Catalog::for_connection(provider, kind)?;
        let db = app.state::<AppState>().open_connection()?;
        // ChatGPT 로그인 토큰은 고정된 ChatGPT 서버로만 보냅니다.
        let (base, secret, account) = if catalog == Catalog::ChatGpt {
            let credential = resolve_oauth_credential(&db)?;
            (
                default_base_url_for(provider, kind).to_owned(),
                credential.access_token,
                credential.account_id,
            )
        } else {
            // 주소와 키를 같은 행에서 한 번에 읽어 설정 변경 중에도 연결을 일치시킵니다.
            let credential = load_credential(&db, provider, kind)?;
            let base = credential.base_url.ok_or("연결되지 않은 공급자입니다.")?;
            (base, credential.api_key, None)
        };
        drop(db);
        let secret = secret.as_deref().map(str::trim).filter(|s| !s.is_empty());
        fetch_models(catalog, &base, secret, account.as_deref())
    })
    .await
    .map_err(|_| "모델 목록 조회를 완료하지 못했습니다.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        thread,
    };

    #[test]
    fn uses_the_connected_catalog_and_supported_inference_modes() {
        let today = "2026-11-14";
        let codex_url = Catalog::ChatGpt
            .endpoint("https://chatgpt.com/backend-api/codex/")
            .unwrap();
        assert_eq!(codex_url.path(), "/backend-api/codex/models");
        assert_eq!(
            codex_url.query_pairs().next().unwrap().1,
            CODEX_CATALOG_VERSION
        );
        let codex = json!({"slug":"new-slug","display_name":"New Model","visibility":"list"});
        assert_eq!(
            Catalog::ChatGpt.model(&codex, today).unwrap().id,
            "new-slug"
        );
        assert!(Catalog::ChatGpt
            .model(&json!({"slug":"hidden","visibility":"hide"}), today)
            .is_none());
        assert!(Catalog::OpenAi
            .model(
                &json!({"id":"gpt-6.1-sol","shutdown_date":"2027-01-01"}),
                today
            )
            .is_some());
        assert!(Catalog::OpenAi
            .model(&json!({"id":"gpt-4","shutdown_date":today}), today)
            .is_none());
        assert!(Catalog::OpenAi
            .model(&json!({"id":"gpt-image-2"}), today)
            .is_none());
        let router_url = Catalog::OpenRouter
            .endpoint("https://openrouter.ai/api/v1")
            .unwrap();
        assert_eq!(router_url.path(), "/api/v1/models/user");
        assert!(Catalog::OpenRouter
            .model(
                &json!({"id":"org/other","endpoints":["/api/v1/images"]}),
                today
            )
            .is_none());
        assert_eq!(
            Catalog::Custom
                .model(&json!({"id":"my-model:latest"}), today)
                .unwrap()
                .id,
            "my-model:latest"
        );
    }

    #[test]
    fn reads_authenticated_paginated_gemini_and_anthropic_lists() {
        for catalog in [Catalog::Gemini, Catalog::Anthropic] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base = format!("http://{}/v1/", listener.local_addr().unwrap());
            let server = thread::spawn(move || {
                for page in 0..2 {
                    let (mut socket, _) = listener.accept().unwrap();
                    let headers: Vec<String> = BufReader::new(&socket)
                        .lines()
                        .map(Result::unwrap)
                        .take_while(|line| !line.is_empty())
                        .collect();
                    assert!(!headers[0].contains("test-secret"));
                    let body = if catalog == Catalog::Gemini {
                        assert!(headers.contains(&"x-goog-api-key: test-secret".to_owned()));
                        if page == 0 {
                            json!({"models":[
                                {"name":"models/embed","supportedGenerationMethods":["embedContent"]},
                                {"name":"models/gemini-3.8-flash-tts","supportedGenerationMethods":["generateContent"]},
                                {"name":"models/gemini-3-pro-image","supportedGenerationMethods":["generateContent"]}
                            ], "nextPageToken":"next"})
                        } else {
                            assert!(headers[0].contains("pageToken=next"));
                            json!({"models":[{"name":"models/gemini-new","displayName":"Gemini New","supportedGenerationMethods":["generateContent"]}]})
                        }
                    } else {
                        assert!(headers.contains(&"x-api-key: test-secret".to_owned()));
                        assert!(headers.contains(&"anthropic-version: 2023-06-01".to_owned()));
                        if page == 0 {
                            json!({"data":[{"id":"previous","display_name":"Previous"}],"last_id":"previous","has_more":true})
                        } else {
                            assert!(headers[0].contains("after_id=previous"));
                            json!({"data":[{"id":"claude-new","display_name":"Claude New"}],"has_more":false})
                        }
                    }.to_string();
                    write!(
                        socket,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    )
                    .unwrap();
                }
            });
            let models = fetch_models(catalog, &base, Some("test-secret"), None).unwrap();
            if catalog == Catalog::Gemini {
                assert_eq!(models.len(), 1);
                assert_eq!(models[0].id, "gemini-new");
            } else {
                assert_eq!(models.len(), 2);
                assert_eq!(models[1].name, "Claude New");
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn lists_a_saved_keyless_custom_endpoint_without_sending_authorization() {
        use crate::{
            migrations::run_migrations,
            repositories::settings_repository::{
                load_available_providers, save_provider_settings, save_selection,
            },
        };
        let mut db = rusqlite::Connection::open_in_memory().unwrap();
        run_migrations(&mut db).unwrap();
        save_selection(&db, "custom", "api-key", "example", true, 1, true, 2).unwrap();
        assert!(load_available_providers(&db).unwrap().is_empty());

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}/custom/v1", listener.local_addr().unwrap());
        save_provider_settings(&db, "custom", "api-key", None, &base).unwrap();
        let providers = load_available_providers(&db).unwrap();
        assert_eq!(providers.len(), 1);
        assert_eq!(providers[0].credential_types, ["api-key"]);
        assert!(!providers[0].has_api_key);
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let headers: Vec<_> = BufReader::new(&stream)
                .lines()
                .map(Result::unwrap)
                .take_while(|line| !line.is_empty())
                .collect();
            assert_eq!(headers[0], "GET /custom/v1/models HTTP/1.1");
            assert!(headers
                .iter()
                .all(|line| !line.to_ascii_lowercase().starts_with("authorization:")));
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n{}",
                json!({"data":[{"id":"local:latest"}]})
            )
            .unwrap();
        });
        let models = fetch_models(Catalog::Custom, &base, None, None).unwrap();
        assert_eq!(models[0].id, "local:latest");
        server.join().unwrap();
    }
}
