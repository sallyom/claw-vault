import { describe, expect, it } from "vitest";
import { __testing } from "../cli.js";

describe("vault CLI helpers", () => {
  it("builds a plugin-managed resolver provider config", () => {
    const config = __testing.buildProviderConfig();

    expect(config).toEqual({
      source: "exec",
      pluginIntegration: {
        pluginId: "vault",
        integrationId: "vault",
      },
    });
  });

  it("builds model provider targets for Vault SecretRefs", () => {
    expect(
      __testing.createModelApiKeyTarget({
        providerAlias: "vault",
        providerId: "openai",
        secretId: "providers/openai/apiKey",
      }),
    ).toEqual({
      type: "models.providers.apiKey",
      path: "models.providers.openai.apiKey",
      pathSegments: ["models", "providers", "openai", "apiKey"],
      providerId: "openai",
      ref: {
        source: "exec",
        provider: "vault",
        id: "providers/openai/apiKey",
      },
    });
  });

  it("parses generic model provider key mappings", () => {
    expect(
      __testing.parseProviderKeyMappings([
        "local-openai=providers/local-openai/apiKey",
        "groq=providers/groq/apiKey",
      ]),
    ).toEqual([
      { providerId: "local-openai", secretId: "providers/local-openai/apiKey" },
      { providerId: "groq", secretId: "providers/groq/apiKey" },
    ]);
  });

  it("collects built-in and generic provider secret mappings", () => {
    expect(
      __testing.collectProviderSecrets({
        openaiId: "providers/openai/apiKey",
        anthropicId: "providers/anthropic/apiKey",
        openrouterId: "providers/openrouter/apiKey",
        providerKey: ["local-openai=providers/local-openai/apiKey"],
      }),
    ).toEqual([
      { providerId: "openai", secretId: "providers/openai/apiKey" },
      { providerId: "anthropic", secretId: "providers/anthropic/apiKey" },
      { providerId: "openrouter", secretId: "providers/openrouter/apiKey" },
      { providerId: "local-openai", secretId: "providers/local-openai/apiKey" },
    ]);
  });

  it("rejects duplicate model provider mappings", () => {
    expect(() =>
      __testing.collectProviderSecrets({
        openrouterId: "providers/openrouter/apiKey",
        providerKey: ["openrouter=providers/other-openrouter/apiKey"],
      }),
    ).toThrow("Duplicate model provider id");
  });

  it("builds an apply plan for multiple provider keys", () => {
    const providerConfig = __testing.buildProviderConfig();
    const plan = __testing.buildPlan({
      providerAlias: "vault",
      providerConfig,
      providerSecrets: [
        { providerId: "openai", secretId: "providers/openai/apiKey" },
        { providerId: "anthropic", secretId: "providers/anthropic/apiKey" },
        { providerId: "openrouter", secretId: "providers/openrouter/apiKey" },
        { providerId: "local-openai", secretId: "providers/local-openai/apiKey" },
      ],
    });

    expect(plan.providerUpserts).toEqual({ vault: providerConfig });
    expect(plan.targets.map((target) => target.path)).toEqual([
      "models.providers.openai.apiKey",
      "models.providers.anthropic.apiKey",
      "models.providers.openrouter.apiKey",
      "models.providers.local-openai.apiKey",
    ]);
  });
});
