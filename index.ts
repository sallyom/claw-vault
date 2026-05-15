import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "vault",
  name: "Vault",
  description: "HashiCorp Vault SecretRef provider integration",
  register() {
    // Secret provider integration is declared in openclaw.plugin.json.
  },
});
