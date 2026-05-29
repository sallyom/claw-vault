# Getting started with Vault SecretRefs

This guide walks through using `claw-vault` to keep OpenClaw model provider API
keys in HashiCorp Vault. It assumes you can already reach a Vault server and can
create or obtain a Vault token.

## How it works

OpenClaw stores a SecretRef in `openclaw.json`, not the API key itself. At
startup or `openclaw secrets reload`, OpenClaw asks the installed `vault` plugin
to resolve that SecretRef. The plugin reads Vault KV and returns the secret value
to OpenClaw's in-memory runtime snapshot.

OpenClaw does not read Vault on every model request. Vault only needs to be
available during startup or reload.

## Before you begin

You need:

- OpenClaw with plugin support.
- The `claw-vault` plugin installed.
- `VAULT_ADDR` for your Vault server.
- A non-root `VAULT_TOKEN` with read access to the secret paths OpenClaw will
  use.
- At least one provider API key stored as a string field in Vault KV.

Root Vault tokens are useful for setup and debugging, but do not run OpenClaw
with a root token. Give OpenClaw a narrower client token.

## Install

Use ClawHub when the package is available:

```bash
openclaw plugins install clawhub:claw-vault --force
```

Use GitHub when testing this repository directly:

```bash
openclaw plugins install git:github.com/sallyom/claw-vault --force
```

Use a local checkout during development:

```bash
openclaw plugins install /path/to/claw-vault --force
```

Check the plugin command:

```bash
openclaw vault status
```

## Store an OpenRouter key in Vault

The default settings are:

- KV mount: `secret`
- KV version: `2`
- SecretRef id shape: `<vault-secret-path>/<field>`

For OpenRouter, the recommended id is:

```text
providers/openrouter/apiKey
```

Create that secret:

```bash
export OPENROUTER_API_KEY=replace-with-openrouter-api-key
vault kv put secret/providers/openrouter apiKey="$OPENROUTER_API_KEY"
```

For OpenAI and Anthropic:

```bash
export OPENAI_API_KEY=replace-with-openai-api-key
export ANTHROPIC_API_KEY=replace-with-anthropic-api-key
vault kv put secret/providers/openai apiKey="$OPENAI_API_KEY"
vault kv put secret/providers/anthropic apiKey="$ANTHROPIC_API_KEY"
```

## Create a Vault policy

For default KV v2:

```hcl
path "secret/data/providers/*" {
  capabilities = ["read"]
}
```

For KV v1:

```hcl
path "secret/providers/*" {
  capabilities = ["read"]
}
```

Attach the policy to the token OpenClaw will use. The exact Vault command
depends on your auth method.

For a simple token-based test setup, save the policy to
`openclaw-model-providers.hcl`, then run:

```bash
vault policy write openclaw-model-providers ./openclaw-model-providers.hcl
vault token create -policy=openclaw-model-providers
```

Use the generated client token as `VAULT_TOKEN` for OpenClaw.

## Configure the OpenClaw runtime environment

Set these variables wherever the OpenClaw Gateway runs:

```bash
export VAULT_ADDR=https://vault.example.com
export VAULT_TOKEN=replace-with-vault-client-token
```

Optional:

```bash
export VAULT_NAMESPACE=namespace-name
export CLAW_VAULT_KV_MOUNT=secret
export CLAW_VAULT_KV_VERSION=2
```

For container deployments, pass the variables into the Gateway container. For a
managed service, add them to the service environment before restarting the
Gateway. A successful `openclaw vault status` in your shell does not prove the
Gateway service has the same environment.

## Generate the OpenClaw SecretRefs

Generate a plan for OpenRouter:

```bash
openclaw vault setup \
  --plan-out ./vault-secrets-plan.json \
  --openrouter-id providers/openrouter/apiKey
```

Generate a plan for several provider keys:

```bash
openclaw vault setup \
  --plan-out ./vault-secrets-plan.json \
  --openai-id providers/openai/apiKey \
  --anthropic-id providers/anthropic/apiKey \
  --openrouter-id providers/openrouter/apiKey
```

For custom OpenAI-compatible providers:

```bash
openclaw vault setup \
  --plan-out ./vault-secrets-plan.json \
  --provider-key local-openai=providers/local-openai/apiKey
```

## Apply and verify

Dry-run first:

```bash
openclaw secrets apply --from ./vault-secrets-plan.json --dry-run --allow-exec
```

Apply:

```bash
openclaw secrets apply --from ./vault-secrets-plan.json --allow-exec
```

Audit:

```bash
openclaw secrets audit --allow-exec --check
```

Reload a running Gateway:

```bash
openclaw secrets reload
```

If the Gateway is not running, start it normally after applying the plan.

## Test OpenRouter

Set a model:

```bash
openclaw models set openrouter/qwen/qwen3.7-max
```

Probe OpenRouter:

```bash
openclaw models status --probe --probe-provider openrouter
```

The probe should succeed without `OPENROUTER_API_KEY` in the OpenClaw runtime
environment. The key should come from Vault through the configured SecretRef.

## SecretRef id reference

`providers/openrouter/apiKey` means:

- Vault secret path: `providers/openrouter`
- Field: `apiKey`
- KV v2 HTTP path with default mount: `secret/data/providers/openrouter`
- KV v1 HTTP path with default mount: `secret/providers/openrouter`

The resolver requires at least one path segment and one field segment. These are
valid:

```text
providers/openrouter/apiKey
teams/production/openrouter/key
```

These are not useful:

```text
apiKey
providers/openrouter/
```

The selected Vault field must contain a string.

## Troubleshooting

### The `vault` command is missing

Run:

```bash
openclaw plugins list
```

If `vault` is missing or disabled, reinstall:

```bash
openclaw plugins install git:github.com/sallyom/claw-vault --force
```

### `VAULT_ADDR` or `VAULT_TOKEN` is missing

Set the missing variable in the command environment. If the failure happens at
Gateway startup or `openclaw secrets reload`, set the variable for the Gateway
service or container, not only your current shell.

### Vault returns 403

The token is visible but not authorized. Check:

- The token is not expired.
- The token policy grants `read`.
- KV v2 policies use `secret/data/...`.
- KV v1 policies use `secret/...`.

### Vault returns 404

Check:

- `CLAW_VAULT_KV_MOUNT` matches the mount name.
- `CLAW_VAULT_KV_VERSION` matches the mount version.
- The SecretRef id uses the expected path and field.
- The field value is a string.

For default KV v2, this should create the OpenRouter key:

```bash
vault kv put secret/providers/openrouter apiKey="$OPENROUTER_API_KEY"
```

### `secrets apply` says exec refs were skipped or rejected

Use `--allow-exec` with plans generated by `openclaw vault setup`:

```bash
openclaw secrets apply --from ./vault-secrets-plan.json --dry-run --allow-exec
openclaw secrets apply --from ./vault-secrets-plan.json --allow-exec
```

### The model still uses an old or environment key

Restart the Gateway or run:

```bash
openclaw secrets reload
```

Also remove `OPENROUTER_API_KEY` from the Gateway environment if you want to
prove the Vault SecretRef is the only OpenRouter credential source.
