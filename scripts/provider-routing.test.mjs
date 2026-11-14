import assert from "node:assert/strict";
import test from "node:test";
import { selectModelProvider } from "../src/pages/chat/providerRouting.ts";
import legacyCatalog from "../src/config/models.json" with { type: "json" };

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
const catalog = (providerId, credentialType, ids, source = "live") => ({
  providerId,
  credentialType,
  source,
  models: ids.map((id) => ({ id })),
});
const models = [
  catalog("openai", "api-key", ["gpt", "shared"]),
  catalog("openai", "oauth", ["gpt", "shared"]),
  catalog("anthropic", "api-key", ["claude", "shared"]),
];
const select = (overrides = {}) =>
  selectModelProvider({
    activeSettings: settings,
    availableProviders: [provider("openai"), provider("anthropic")],
    availableModels: models,
    hasCatalogModel: (providerId, modelId) =>
      Object.hasOwn(legacyCatalog[providerId]?.models ?? {}, modelId),
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
      model: "claude-opus-4-5-20251101",
      availableModels: [],
    }).providerId,
    "anthropic"
  );
  assert.throws(
    () => select({ model: "claude", availableProviders: [provider("openai")] }),
    /Provider/
  );
  assert.throws(
    () =>
      select({
        model: "claude-opus-4-5-20251101",
        activeSettings: { ...settings, providerId: "custom" },
        availableProviders: [provider("custom")],
        availableModels: [],
      }),
    /Provider/
  );
});
test("어느 모델 목록에도 없는 수동 ID는 현재 연결로만 전달한다", () => {
  assert.deepEqual(select({ model: "private-deployment" }), {
    providerId: "openai",
    providerKind: "api-key",
    model: "private-deployment",
  });
  assert.equal(
    select({
      model: "private-deployment",
      activeSettings: { ...settings, providerId: "anthropic" },
    }).providerId,
    "anthropic"
  );
  assert.throws(
    () =>
      select({
        model: "private-deployment",
        availableProviders: [provider("anthropic")],
      }),
    /Provider/
  );
});
test("커스텀 공급자는 현재 설정을 유지한다", () => {
  assert.deepEqual(
    select({ model: "my-model", activeSettings: { ...settings, providerId: "custom" } }),
    { providerId: "custom", providerKind: "api-key", model: "my-model" }
  );
});

test("현재 공급자의 대체 목록보다 실제 모델을 확인한 공급자를 우선한다", () => {
  const selected = select({
    model: "shared",
    availableModels: [
      catalog("openai", "api-key", ["shared"], "fallback"),
      catalog("anthropic", "api-key", ["shared"]),
    ],
  });
  assert.equal(selected.providerId, "anthropic");
});

test("한 인증 수단에서만 제공되는 모델과 폴백 모델을 해당 수단으로 보낸다", () => {
  const options = {
    availableProviders: [
      { ...provider("openai"), loggedIn: true, credentialTypes: ["api-key", "oauth"] },
    ],
    availableModels: [
      catalog("openai", "oauth", ["shared", "oauth-only"], "fallback"),
      catalog("openai", "api-key", ["shared", "api-only"]),
    ],
  };
  assert.equal(select({ ...options, model: "shared" }).providerKind, "api-key");
  assert.equal(select({ ...options, model: "api-only" }).providerKind, "api-key");
  assert.equal(select({ ...options, model: "oauth-only" }).providerKind, "oauth");
});

test("커스텀과 기본 공급자 사이에서 실제 조회된 모델로 전환한다", () => {
  const options = {
    availableProviders: [
      { ...provider("custom", false), credentialTypes: ["api-key"] },
      provider("openai"),
    ],
    availableModels: [catalog("custom", "api-key", ["private"]), ...models],
  };
  assert.equal(select({ ...options, model: "private" }).providerId, "custom");
  const activeSettings = { ...settings, providerId: "custom", model: "private" };
  assert.equal(select({ ...options, activeSettings, model: "gpt" }).providerId, "openai");
  assert.equal(select({ ...options, activeSettings, model: "user-typed" }).providerId, "custom");
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
