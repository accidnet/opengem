import assert from "node:assert/strict";
import test from "node:test";
import { selectModelProvider } from "../src/pages/chat/providerRouting.ts";

const provider = (providerId, hasApiKey = true) => ({
  providerId,
  credentialTypes: hasApiKey ? ["api-key"] : [],
  apiUrls: {},
  hasApiKey,
  loggedIn: false,
});
const settings = {
  providerId: "openai",
  providerKind: "api-key",
  model: "gpt",
  baseUrl: "https://example.test",
  apiKey: "test",
};
const models = [
  { providerId: "openai", models: [{ id: "gpt" }, { id: "shared" }] },
  { providerId: "anthropic", models: [{ id: "claude" }, { id: "shared" }] },
];
const select = (overrides = {}) =>
  selectModelProvider({
    activeSettings: settings,
    availableProviders: [provider("openai"), provider("anthropic")],
    availableModels: models,
    catalogModels: [],
    ...overrides,
  });

test("에이전트 모델에 맞는 설정된 공급자를 선택한다", () => {
  assert.deepEqual(select({ model: "claude" }), {
    providerId: "anthropic",
    providerKind: "api-key",
    model: "claude",
  });
});
test("동일 모델은 현재 공급자를 우선하고 빈 모델은 현재 모델을 사용한다", () => {
  assert.equal(select({ model: "shared" }).providerId, "openai");
  assert.equal(select({ model: "  " }).model, "gpt");
});
test("카탈로그 모델을 인식하고 공급자 설정이 없으면 실패한다", () => {
  assert.equal(
    select({
      model: "legacy",
      availableModels: [],
      catalogModels: [{ providerId: "anthropic", models: [{ id: "legacy" }] }],
    }).providerId,
    "anthropic"
  );
  assert.throws(
    () => select({ model: "claude", availableProviders: [provider("openai")] }),
    /Provider/
  );
  assert.throws(() => select({ model: "unknown" }), /Provider/);
});
test("커스텀 공급자는 현재 설정을 유지한다", () => {
  assert.deepEqual(
    select({ model: "my-model", activeSettings: { ...settings, providerId: "custom" } }),
    { providerId: "custom", providerKind: "api-key", model: "my-model" }
  );
});

test("OpenAI 전환 및 현재 공급자에서 인증 우선순위를 따르고 비활성 수단은 제외한다", () => {
  const openai = { ...provider("openai"), loggedIn: true, credentialTypes: ["api-key", "oauth"] };
  const base = {
    ...settings,
    openaiOauthEnabled: true,
    openaiApiKeyEnabled: true,
    openaiOauthPriority: 1,
    openaiApiKeyPriority: 2,
  };
  const availableProviders = [openai, provider("anthropic")];
  assert.equal(
    select({
      model: "gpt",
      activeSettings: { ...base, providerId: "anthropic", model: "claude" },
      availableProviders,
    }).providerKind,
    "oauth"
  );
  assert.equal(
    select({
      model: "gpt",
      activeSettings: { ...base, openaiOauthPriority: 2, openaiApiKeyPriority: 1 },
      availableProviders,
    }).providerKind,
    "api-key"
  );
  assert.equal(
    select({
      model: "gpt",
      activeSettings: { ...base, openaiOauthEnabled: false },
      availableProviders,
    }).providerKind,
    "api-key"
  );
  assert.equal(
    select({
      model: "gpt",
      activeSettings: { ...base, openaiApiKeyEnabled: false },
      availableProviders,
    }).providerKind,
    "oauth"
  );
  assert.throws(
    () =>
      select({
        model: "gpt",
        activeSettings: { ...base, openaiOauthEnabled: false, openaiApiKeyEnabled: false },
        availableProviders,
      }),
    /비활성화/
  );
  assert.throws(
    () =>
      select({
        model: "gpt",
        activeSettings: {
          ...base,
          providerId: "anthropic",
          model: "claude",
          openaiOauthEnabled: false,
          openaiApiKeyEnabled: false,
        },
        availableProviders,
      }),
    /비활성화/
  );
  assert.throws(
    () =>
      select({
        model: "gpt",
        activeSettings: { ...base, openaiApiKeyEnabled: false },
        availableProviders: [provider("openai")],
      }),
    /Provider/
  );
});
