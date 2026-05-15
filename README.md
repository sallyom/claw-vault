# claw-vault

HashiCorp Vault SecretRef provider integration for OpenClaw.

This plugin keeps Vault-specific resolution outside OpenClaw core. It declares
a `secretProviderIntegrations.vault` preset that materializes an OpenClaw exec
secret provider.

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

## Local Smoke

```bash
printf '%s\n' '{"protocolVersion":1,"ids":["providers/openai/apiKey"]}' \
  | CLAW_VAULT_VALUES_JSON='{"providers/openai/apiKey":"not-a-real-value"}' \
    node vault-secret-ref-resolver.js
```

Expected:

```json
{"protocolVersion":1,"values":{"providers/openai/apiKey":"not-a-real-value"},"errors":{}}
```

## Install In OpenClaw Source Checkout

Until this plugin is packaged with compiled runtime output, load it as a source
plugin:

```bash
openclaw config patch --stdin <<'JSON5'
{
  plugins: {
    load: {
      paths: ["/absolute/path/to/claw-vault"],
    },
  },
}
JSON5
```

Then configure SecretRefs that use provider `vault`.

## Tests

```bash
npm install
npm test
```
