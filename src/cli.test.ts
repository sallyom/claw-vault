import path from "node:path";
import { describe, expect, it } from "vitest";
import { __testing } from "../cli.js";

describe("vault CLI helpers", () => {
  it("builds a secure executable resolver provider config", () => {
    const config = __testing.buildProviderConfig();

    expect(config).toMatchObject({
      source: "exec",
      timeoutMs: 5000,
      noOutputTimeoutMs: 5000,
      maxOutputBytes: 1024 * 1024,
      passEnv: [
        "VAULT_ADDR",
        "VAULT_TOKEN",
        "VAULT_NAMESPACE",
        "CLAW_VAULT_KV_MOUNT",
        "CLAW_VAULT_KV_VERSION",
        "CLAW_VAULT_VALUES_JSON",
      ],
      allowInsecurePath: true,
    });
    expect(config.command).toBe(process.execPath);
    expect(config.args).toEqual([expect.stringContaining("vault-secret-ref-resolver.js")]);
    expect(path.dirname(config.args[0])).toContain("vault");
    expect(config).not.toHaveProperty("trustedDirs");
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
