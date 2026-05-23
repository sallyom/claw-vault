import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
const VAULT_PROVIDER_ALIAS = "vault";
const SECRET_PROVIDER_ALIAS_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const MODEL_PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const EXEC_SECRET_REF_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
function writeLine(message = "") {
    process.stdout.write(`${message}\n`);
}
function writeJson(value) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function normalizeOptionalString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function assertValidProviderAlias(value) {
    if (!SECRET_PROVIDER_ALIAS_PATTERN.test(value)) {
        throw new Error(`Invalid provider alias "${value}". Use lowercase letters, numbers, underscores, or hyphens.`);
    }
}
function assertValidModelProviderId(label, value) {
    if (!MODEL_PROVIDER_ID_PATTERN.test(value)) {
        throw new Error(`Invalid ${label} model provider id: ${value}`);
    }
}
function assertValidVaultSecretId(label, value) {
    if (!EXEC_SECRET_REF_ID_PATTERN.test(value) ||
        value.split("/").some((part) => part === "." || part === "..")) {
        throw new Error(`Invalid ${label} Vault secret id: ${value}`);
    }
}
function readProviderStatus(config, providerAlias) {
    const provider = config.secrets?.providers?.[providerAlias];
    if (!isRecord(provider)) {
        return { configured: false };
    }
    const providerRecord = provider;
    const pluginIntegration = providerRecord.pluginIntegration;
    return {
        configured: true,
        source: normalizeOptionalString(provider.source),
        ...(provider.source === "exec" ? { command: normalizeOptionalString(provider.command) } : {}),
        ...(provider.source === "exec" &&
            isRecord(pluginIntegration) &&
            typeof pluginIntegration.pluginId === "string" &&
            typeof pluginIntegration.integrationId === "string"
            ? {
                pluginIntegration: {
                    pluginId: pluginIntegration.pluginId,
                    integrationId: pluginIntegration.integrationId,
                },
            }
            : {}),
    };
}
function resolveResolverScriptPath() {
    return fileURLToPath(new URL("./vault-secret-ref-resolver.js", import.meta.url));
}
function buildProviderConfig() {
    return {
        source: "exec",
        pluginIntegration: {
            pluginId: "vault",
            integrationId: "vault",
        },
    };
}
function createModelApiKeyTarget(params) {
    assertValidModelProviderId("target", params.providerId);
    return {
        type: "models.providers.apiKey",
        path: `models.providers.${params.providerId}.apiKey`,
        pathSegments: ["models", "providers", params.providerId, "apiKey"],
        providerId: params.providerId,
        ref: {
            source: "exec",
            provider: params.providerAlias,
            id: params.secretId,
        },
    };
}
function parseProviderKeyMappings(values) {
    return (values ?? []).map((value) => {
        const separator = value.indexOf("=");
        if (separator <= 0 || separator === value.length - 1) {
            throw new Error(`Invalid --provider-key value "${value}". Use <model-provider-id>=<vault-secret-id>.`);
        }
        const providerId = value.slice(0, separator).trim();
        const secretId = value.slice(separator + 1).trim();
        assertValidModelProviderId("--provider-key", providerId);
        assertValidVaultSecretId(`--provider-key ${providerId}`, secretId);
        return { providerId, secretId };
    });
}
function collectProviderSecrets(options) {
    const providerSecrets = [];
    if (options.openaiId) {
        providerSecrets.push({ providerId: "openai", secretId: options.openaiId });
    }
    if (options.anthropicId) {
        providerSecrets.push({ providerId: "anthropic", secretId: options.anthropicId });
    }
    if (options.openrouterId) {
        providerSecrets.push({ providerId: "openrouter", secretId: options.openrouterId });
    }
    providerSecrets.push(...parseProviderKeyMappings(options.providerKey));
    const seen = new Set();
    for (const entry of providerSecrets) {
        const normalized = entry.providerId.toLowerCase();
        if (seen.has(normalized)) {
            throw new Error(`Duplicate model provider id in Vault setup: ${entry.providerId}`);
        }
        seen.add(normalized);
    }
    return providerSecrets;
}
function buildPlan(params) {
    return {
        version: 1,
        protocolVersion: 1,
        generatedAt: new Date().toISOString(),
        generatedBy: "manual",
        providerUpserts: {
            [params.providerAlias]: params.providerConfig,
        },
        targets: params.providerSecrets.map((entry) => createModelApiKeyTarget({
            providerAlias: params.providerAlias,
            providerId: entry.providerId,
            secretId: entry.secretId,
        })),
    };
}
async function promptOptionalSecretId(label) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return undefined;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return normalizeOptionalString(await rl.question(`${label} Vault secret id (blank to skip): `));
    }
    finally {
        rl.close();
    }
}
async function promptProviderSecrets(options) {
    const openaiId = normalizeOptionalString(options.openaiId) ?? (await promptOptionalSecretId("OpenAI"));
    const anthropicId = normalizeOptionalString(options.anthropicId) ?? (await promptOptionalSecretId("Anthropic"));
    const openrouterId = normalizeOptionalString(options.openrouterId) ?? (await promptOptionalSecretId("OpenRouter"));
    if (openaiId) {
        assertValidVaultSecretId("OpenAI", openaiId);
    }
    if (anthropicId) {
        assertValidVaultSecretId("Anthropic", anthropicId);
    }
    if (openrouterId) {
        assertValidVaultSecretId("OpenRouter", openrouterId);
    }
    return collectProviderSecrets({
        ...(openaiId ? { openaiId } : {}),
        ...(anthropicId ? { anthropicId } : {}),
        ...(openrouterId ? { openrouterId } : {}),
        providerKey: options.providerKey,
    });
}
async function runStatus(config, options) {
    const provider = readProviderStatus(config, VAULT_PROVIDER_ALIAS);
    const result = {
        providerAlias: VAULT_PROVIDER_ALIAS,
        provider,
        resolverScript: resolveResolverScriptPath(),
        vaultAddr: normalizeOptionalString(process.env.VAULT_ADDR),
        kvMount: normalizeOptionalString(process.env.CLAW_VAULT_KV_MOUNT) ?? "secret",
        kvVersion: normalizeOptionalString(process.env.CLAW_VAULT_KV_VERSION) ?? "2",
        hasVaultToken: Boolean(normalizeOptionalString(process.env.VAULT_TOKEN)),
    };
    if (options.json) {
        writeJson(result);
        return;
    }
    writeLine(`Vault provider: ${provider.configured ? "configured" : "not configured"}`);
    if (provider.source) {
        writeLine(`Source: ${provider.source}`);
    }
    if (provider.command) {
        writeLine(`Command: ${provider.command}`);
    }
    if (provider.pluginIntegration) {
        writeLine(`Plugin integration: ${provider.pluginIntegration.pluginId}:${provider.pluginIntegration.integrationId}`);
    }
    writeLine(`Resolver: ${result.resolverScript}`);
    writeLine(`VAULT_ADDR: ${result.vaultAddr ?? "not set"}`);
    writeLine(`VAULT_TOKEN: ${result.hasVaultToken ? "set" : "not set"}`);
    writeLine(`KV mount: ${result.kvMount}`);
    writeLine(`KV version: ${result.kvVersion}`);
}
async function runSetup(options) {
    const providerAlias = normalizeOptionalString(options.providerAlias) ?? VAULT_PROVIDER_ALIAS;
    assertValidProviderAlias(providerAlias);
    const providerSecrets = await promptProviderSecrets(options);
    const plan = buildPlan({
        providerAlias,
        providerConfig: buildProviderConfig(),
        providerSecrets,
    });
    const planPath = normalizeOptionalString(options.planOut) ??
        path.join(os.tmpdir(), `openclaw-vault-secrets-${process.pid}.json`);
    await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    writeLine(`Plan written to ${planPath}`);
    writeLine(`Targets: ${plan.targets.length}`);
    writeLine("");
    writeLine("Next steps:");
    writeLine(`  openclaw secrets apply --from ${planPath} --dry-run --allow-exec`);
    writeLine(`  openclaw secrets apply --from ${planPath} --allow-exec`);
    writeLine("  openclaw secrets audit --check");
    writeLine("  openclaw secrets reload");
}
export function registerVaultCommands(params) {
    const vault = params.program.command("vault").description("Manage Vault SecretRefs");
    vault
        .command("status")
        .description("Show Vault SecretRef provider status")
        .option("--json", "Print JSON status")
        .action((options) => runStatus(params.config, options));
    vault
        .command("setup")
        .description("Create a Vault SecretRef setup plan")
        .option("--plan-out <path>", "Write the generated secrets apply plan to a path")
        .option("--provider-alias <alias>", "Secret provider alias to configure", VAULT_PROVIDER_ALIAS)
        .option("--openai-id <id>", "Vault secret id for models.providers.openai.apiKey")
        .option("--anthropic-id <id>", "Vault secret id for models.providers.anthropic.apiKey")
        .option("--openrouter-id <id>", "Vault secret id for models.providers.openrouter.apiKey")
        .option("--provider-key <provider=id>", "Vault secret id for any models.providers.<provider>.apiKey target", (value, previous = []) => [...previous, value], [])
        .action((options) => runSetup(options));
}
export const __testing = {
    buildPlan,
    buildProviderConfig,
    collectProviderSecrets,
    createModelApiKeyTarget,
    parseProviderKeyMappings,
};
