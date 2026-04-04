use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettingsPayload {
    pub provider_id: String,
    pub provider_kind: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub chatgpt_logged_in: bool,
    pub chatgpt_email: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSettingsInput {
    pub provider_id: String,
    pub provider_kind: String,
    pub model: String,
    pub api_key: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedLlmSettingsPayload {
    pub provider_id: String,
    pub provider_kind: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub access_token: Option<String>,
    pub account_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChatgptLoginPayload {
    pub authorization_url: String,
}

#[derive(Default)]
pub(crate) struct StoredLlmSettings {
    pub provider_id: String,
    pub provider_kind: String,
    pub model: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub account_id: Option<String>,
    pub chatgpt_logged_in: bool,
    pub chatgpt_email: Option<String>,
}

#[derive(Default)]
pub(crate) struct StoredProviderCredential {
    pub provider_id: String,
    pub credential_type: String,
    pub api_key: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub account_id: Option<String>,
    pub email: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct TokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: Option<i64>,
    pub id_token: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct IdTokenClaims {
    pub chatgpt_account_id: Option<String>,
    pub organizations: Option<Vec<OrganizationClaim>>,
    pub email: Option<String>,
    #[serde(rename = "https://api.openai.com/auth")]
    pub auth: Option<AuthClaim>,
}

#[derive(Deserialize)]
pub(crate) struct OrganizationClaim {
    pub id: String,
}

#[derive(Deserialize)]
pub(crate) struct AuthClaim {
    pub chatgpt_account_id: Option<String>,
}

pub(crate) struct OAuthCodes {
    pub verifier: String,
    pub challenge: String,
}
