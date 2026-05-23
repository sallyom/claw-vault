# claw-vault

HashiCorp Vault SecretRef provider integration for OpenClaw.

This plugin keeps Vault-specific resolution outside OpenClaw core. It declares
a `secretProviderIntegrations.vault` preset that OpenClaw can use as a
plugin-managed exec SecretRef provider.

The repository and package are named `claw-vault`, but the OpenClaw plugin id is
`vault`. Config that references the plugin-managed provider should use
`pluginIntegration.pluginId: "vault"`.

## SecretRef IDs

By default, SecretRef ids use this convention:

```text
<vault-secret-path>/<field>
```

For example:

```json
{ "source": "exec", "provider": "vault", "id": "providers/openai/apiKey" }
```

With the default KV v2 mount `secret`, the resolver reads:

```text
secret/data/providers/openai
```

and returns the string field:

```text
apiKey
```

## Environment

Required for real Vault reads:

- `VAULT_ADDR`
- `VAULT_TOKEN`

Optional:

- `VAULT_NAMESPACE`
- `CLAW_VAULT_KV_MOUNT` (default: `secret`)
- `CLAW_VAULT_KV_VERSION` (default: `2`; supported: `1`, `2`)

Test fallback:

- `CLAW_VAULT_VALUES_JSON`

## Commands

```bash
openclaw vault status
openclaw vault status --json
openclaw vault setup --openai-id providers/openai/apiKey
openclaw vault setup --anthropic-id providers/anthropic/apiKey
openclaw vault setup --openrouter-id providers/openrouter/apiKey
openclaw vault setup \
  --plan-out ./vault-secrets-plan.json \
  --openai-id providers/openai/apiKey \
  --anthropic-id providers/anthropic/apiKey \
  --openrouter-id providers/openrouter/apiKey \
  --provider-key local-openai=providers/local-openai/apiKey
```

`openclaw vault setup` writes an OpenClaw secrets apply plan and prints the
commands to dry-run, apply, audit, and reload it. The generated OpenClaw config
stores a plugin-managed Vault provider and SecretRefs, not raw API keys:

```json
{
  "source": "exec",
  "pluginIntegration": {
    "pluginId": "vault",
    "integrationId": "vault"
  }
}
```

Model API key fields then point at that local provider alias:

```json
{ "source": "exec", "provider": "vault", "id": "providers/openai/apiKey" }
```

Use `--provider-key <provider=id>` for OpenAI-compatible or custom model
providers stored under `models.providers.<provider>.apiKey`.

## Local Smoke

```bash
printf '%s\n' '{"protocolVersion":1,"ids":["providers/openai/apiKey"]}' \
  | CLAW_VAULT_VALUES_JSON='{"providers/openai/apiKey":"not-a-real-value"}' \
    node ./vault-secret-ref-resolver.js
```

Expected:

```json
{"protocolVersion":1,"values":{"providers/openai/apiKey":"not-a-real-value"},"errors":{}}
```

## Install

From a local checkout:

```bash
openclaw plugins install /absolute/path/to/claw-vault --force
```

From git:

```bash
openclaw plugins install git:github.com/sallyom/claw-vault --force
openclaw plugins install git:github.com/sallyom/claw-vault@<branch-or-tag-or-sha> --force
```

Then configure SecretRefs that use provider `vault`, or run `openclaw vault setup`.

## Tests

```bash
npm install
npm test
```
