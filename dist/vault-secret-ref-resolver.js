#!/usr/bin/env node

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(input));
  });
}

function writeResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

function parseRequest(input) {
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.ids)) {
    throw new Error("invalid exec SecretRef request");
  }
  return {
    protocolVersion: 1,
    ids: parsed.ids.filter((id) => typeof id === "string" && id.length > 0),
  };
}

function parseInlineValues() {
  const raw = process.env.CLAW_VAULT_VALUES_JSON;
  if (!raw) {
    return undefined;
  }
  const values = JSON.parse(raw);
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw new Error("CLAW_VAULT_VALUES_JSON must be a JSON object");
  }
  return values;
}

function resolveFromInlineValues(ids) {
  const values = parseInlineValues();
  if (!values) {
    return undefined;
  }
  const response = { protocolVersion: 1, values: {}, errors: {} };
  for (const id of ids) {
    if (typeof values[id] === "string") {
      response.values[id] = values[id];
    } else {
      response.errors[id] = {
        message: "Vault credential id was not present in CLAW_VAULT_VALUES_JSON.",
      };
    }
  }
  return response;
}

function normalizeVaultAddress() {
  const raw = process.env.VAULT_ADDR?.trim();
  if (!raw) {
    throw new Error("VAULT_ADDR is required.");
  }
  return raw.replace(/\/+$/u, "");
}

function resolveVaultToken() {
  const token = process.env.VAULT_TOKEN?.trim();
  if (!token) {
    throw new Error("VAULT_TOKEN is required.");
  }
  return token;
}

function resolveKvMount() {
  return process.env.CLAW_VAULT_KV_MOUNT?.trim().replace(/^\/+|\/+$/gu, "") || "secret";
}

function resolveKvVersion() {
  const raw = process.env.CLAW_VAULT_KV_VERSION?.trim();
  if (!raw || raw === "2") {
    return 2;
  }
  if (raw === "1") {
    return 1;
  }
  throw new Error("CLAW_VAULT_KV_VERSION must be 1 or 2.");
}

function parseVaultId(id) {
  const parts = id.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error(
      `Vault SecretRef id "${id}" must use "<path>/<field>", for example "providers/openai/apiKey".`,
    );
  }
  const field = parts.at(-1);
  const secretPath = parts.slice(0, -1).join("/");
  return { secretPath, field };
}

function buildVaultUrl(params) {
  const mount = encodePathSegment(resolveKvMount());
  const path = encodePath(params.secretPath);
  const base = normalizeVaultAddress();
  if (resolveKvVersion() === 2) {
    return `${base}/v1/${mount}/data/${path}`;
  }
  return `${base}/v1/${mount}/${path}`;
}

function encodePath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function encodePathSegment(segment) {
  return segment
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function readVaultSecret(id) {
  const parsedId = parseVaultId(id);
  const headers = {
    "X-Vault-Token": resolveVaultToken(),
  };
  const namespace = process.env.VAULT_NAMESPACE?.trim();
  if (namespace) {
    headers["X-Vault-Namespace"] = namespace;
  }
  const response = await fetch(buildVaultUrl(parsedId), { headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Vault read failed for "${id}" (${response.status}): ${body.trim()}`);
  }
  const payload = await response.json();
  const data = resolveKvVersion() === 2 ? payload?.data?.data : payload?.data;
  const value = data?.[parsedId.field];
  if (typeof value !== "string") {
    throw new Error(`Vault secret "${id}" did not contain a string field "${parsedId.field}".`);
  }
  return value;
}

async function resolveFromVault(ids) {
  const response = { protocolVersion: 1, values: {}, errors: {} };
  await Promise.all(
    ids.map(async (id) => {
      try {
        response.values[id] = await readVaultSecret(id);
      } catch (error) {
        response.errors[id] = {
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  return response;
}

async function main() {
  const input = await readStdin();
  const request = parseRequest(input);
  const inline = resolveFromInlineValues(request.ids);
  if (inline) {
    writeResponse(inline);
    return;
  }
  writeResponse(await resolveFromVault(request.ids));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  writeResponse({
    protocolVersion: 1,
    values: {},
    errors: {
      request: { message },
    },
  });
});
