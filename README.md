# claw-vault

HashiCorp Vault SecretRef provider integration for OpenClaw.

`claw-vault` lets OpenClaw read model provider API keys from Vault at
startup/reload time instead of storing those keys as plaintext in
`openclaw.json`. The repository and package are named `claw-vault`, but the
OpenClaw plugin id is `vault`.

## Quickstart

This path configures OpenRouter through Vault, then sets an OpenRouter model as
the OpenClaw default.

### 1. Install the plugin

From ClawHub, when available:

```bash
openclaw plugins install clawhub:claw-vault --force
```

From GitHub:

```bash
openclaw plugins install git:github.com/sallyom/claw-vault --force
```

From a local checkout:

```bash
openclaw plugins install /path/to/claw-vault --force
```

Confirm the command is available:

```bash
openclaw vault status
```

### 2. Put the API key in Vault

The default resolver expects a KV mount named `secret` and KV version 2. With
that default, this OpenClaw SecretRef id:

```text
providers/openrouter/apiKey
```

reads this Vault secret path and field:

```text
secret/data/providers/openrouter -> apiKey
```

Using the Vault CLI, store the key:

```bash
export OPENROUTER_API_KEY=replace-with-openrouter-api-key
vault kv put secret/providers/openrouter apiKey="$OPENROUTER_API_KEY"
```

Use a client token for OpenClaw, not a root token. The token only needs read
access to the secret paths OpenClaw should resolve. For default KV v2 paths, a
minimal policy looks like:

```hcl
path "secret/data/providers/*" {
  capabilities = ["read"]
}
```

One simple Vault CLI setup flow is:

```bash
vault policy write openclaw-model-providers ./openclaw-model-providers.hcl
vault token create -policy=openclaw-model-providers
```

### 3. Make Vault visible to OpenClaw

Set these in the same shell, service, or container environment that starts the
OpenClaw Gateway:

```bash
export VAULT_ADDR=https://vault.example.com
export VAULT_TOKEN=replace-with-vault-client-token
```

Optional settings:

```bash
export VAULT_NAMESPACE=namespace-name
export CLAW_VAULT_KV_MOUNT=secret
export CLAW_VAULT_KV_VERSION=2
```

If OpenClaw runs in a container, pass these environment variables to that
container. `openclaw vault status` can see your shell environment, but the
Gateway can only resolve SecretRefs from the environment it actually runs with.

Check what the plugin can see:

```bash
openclaw vault status
```

The status output reports whether `VAULT_ADDR` is set, whether `VAULT_TOKEN` is
present, and which KV mount/version will be used. It never prints the token.

### 4. Generate and apply an OpenClaw secrets plan

Generate a plan that maps `models.providers.openrouter.apiKey` to the Vault
SecretRef:

```bash
openclaw vault setup \
  --plan-out ./vault-secrets-plan.json \
  --openrouter-id providers/openrouter/apiKey
```

Dry-run the plan, apply it, audit the result, and reload a running Gateway:

```bash
openclaw secrets apply --from ./vault-secrets-plan.json --dry-run --allow-exec
openclaw secrets apply --from ./vault-secrets-plan.json --allow-exec
openclaw secrets audit --allow-exec --check
openclaw secrets reload
```

Use `--allow-exec` because this plugin resolves SecretRefs through an
OpenClaw-managed exec provider.

If the Gateway is not running yet, start it normally after applying the plan
instead of running `openclaw secrets reload`.

### 5. Set and probe a model

```bash
openclaw models set openrouter/qwen/qwen3.7-max
openclaw models status --probe --probe-provider openrouter
```

The probe should report `openrouter/qwen/qwen3.7-max` as healthy without an
`OPENROUTER_API_KEY` in the OpenClaw process environment.

## Other providers

Built-in shortcuts:

```bash
openclaw vault setup --openai-id providers/openai/apiKey
openclaw vault setup --anthropic-id providers/anthropic/apiKey
openclaw vault setup --openrouter-id providers/openrouter/apiKey
```

Multiple provider keys in one plan:

```bash
openclaw vault setup \
  --plan-out ./vault-secrets-plan.json \
  --openai-id providers/openai/apiKey \
  --anthropic-id providers/anthropic/apiKey \
  --openrouter-id providers/openrouter/apiKey
```

OpenAI-compatible or custom model providers use `--provider-key`:

```bash
openclaw vault setup \
  --plan-out ./vault-secrets-plan.json \
  --provider-key local-openai=providers/local-openai/apiKey \
  --provider-key groq=providers/groq/apiKey
```

Each `--provider-key <provider=id>` writes a SecretRef to
`models.providers.<provider>.apiKey`.

## SecretRef ids

SecretRef ids use this convention:

```text
<vault-secret-path>/<field>
```

Examples:

| SecretRef id | Default KV v2 Vault read | Returned field |
| --- | --- | --- |
| `providers/openrouter/apiKey` | `secret/data/providers/openrouter` | `apiKey` |
| `providers/openai/apiKey` | `secret/data/providers/openai` | `apiKey` |
| `teams/agent-prod/openrouter` | `secret/data/teams/agent-prod` | `openrouter` |

The field value must be a string.

For KV v1, set:

```bash
export CLAW_VAULT_KV_VERSION=1
```

Then `providers/openrouter/apiKey` reads
`secret/providers/openrouter -> apiKey`.

## What OpenClaw stores

`openclaw vault setup` writes an OpenClaw `secrets apply` plan. Applying that
plan stores a plugin-managed Vault provider:

```json
{
  "source": "exec",
  "pluginIntegration": {
    "pluginId": "vault",
    "integrationId": "vault"
  }
}
```

Model API key fields point at that local provider alias:

```json
{ "source": "exec", "provider": "vault", "id": "providers/openrouter/apiKey" }
```

The resolved API key is kept in OpenClaw's in-memory runtime snapshot after
startup or `openclaw secrets reload`; it is not written back to
`openclaw.json`.

## Troubleshooting

`openclaw vault` is not found:

- Confirm the plugin installed successfully with `openclaw plugins list`.
- Reinstall with `openclaw plugins install git:github.com/sallyom/claw-vault --force`.

`VAULT_ADDR is required` or `VAULT_TOKEN is required`:

- Export the missing variable in the environment that runs the command.
- For Gateway startup/reload, make sure the variable is also present in the
  Gateway service or container environment.

Vault returns 403:

- Use a client token with `read` access to the exact Vault paths.
- For default KV v2, policy paths usually look like
  `secret/data/providers/*`, not `secret/providers/*`.

Vault returns 404 or the field is missing:

- Check the mount, KV version, secret path, and field name.
- For default KV v2, create the example OpenRouter secret with
  `vault kv put secret/providers/openrouter apiKey="$OPENROUTER_API_KEY"`.

`secrets apply` rejects the plan:

- Plans containing exec providers require `--allow-exec` in write mode.
- Dry-runs skip exec checks unless `--allow-exec` is set.

The Gateway still uses old credentials:

- Run `openclaw secrets reload`, or restart the Gateway.
- For service/container installs, confirm `VAULT_ADDR` and `VAULT_TOKEN` are in
  the Gateway runtime environment, not only in your interactive shell.

## Local smoke test

This bypasses real Vault and exercises the resolver protocol:

```bash
printf '%s\n' '{"protocolVersion":1,"ids":["providers/openai/apiKey"]}' \
  | CLAW_VAULT_VALUES_JSON='{"providers/openai/apiKey":"not-a-real-value"}' \
    node ./vault-secret-ref-resolver.js
```

Expected:

```json
{"protocolVersion":1,"values":{"providers/openai/apiKey":"not-a-real-value"},"errors":{}}
```

## More docs

- [Getting started with Vault SecretRefs](docs/getting-started.md)
- OpenClaw SecretRefs: https://docs.openclaw.ai/gateway/secrets
- OpenClaw secrets CLI: https://docs.openclaw.ai/cli/secrets

## Development

```bash
npm install
npm test
```
