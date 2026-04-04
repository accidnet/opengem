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
    pub base_url: String,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptMessageInput {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptRequestInput {
    pub model: String,
    pub messages: Vec<ChatgptMessageInput>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsagePayload {
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatgptResponsePayload {
    pub text: String,
    pub usage: Option<UsagePayload>,
}

#[derive(Default)]
pub(crate) struct StoredLlmSettings {
    pub provider_id: String,
    pub provider_kind: String,
    pub base_url: String,
    pub model: String,
    pub api_key: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<i64>,
    pub account_id: Option<String>,
    pub chatgpt_email: Option<String>,
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

#[derive(Serialize, Deserialize)]
pub(crate) struct ResponsesInputTextItem {
    pub r#type: String,
    pub text: String,
}

#[derive(Serialize, Deserialize)]
pub(crate) struct ResponsesInputMessage {
    pub role: String,
    pub content: Vec<ResponsesInputTextItem>,
}

#[derive(Deserialize)]
pub(crate) struct ResponsesOutputTextItem {
    pub r#type: Option<String>,
    pub text: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct ResponsesOutputItem {
    pub content: Option<Vec<ResponsesOutputTextItem>>,
}

#[derive(Deserialize)]
pub(crate) struct ResponsesUsage {
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub total_tokens: Option<i64>,
}

#[derive(Deserialize)]
pub(crate) struct ResponsesApiResponse {
    pub output_text: Option<String>,
    pub output: Option<Vec<ResponsesOutputItem>>,
    pub usage: Option<ResponsesUsage>,
}
