import { TOKENS } from "./secrets.js";

const api = globalThis.browser ?? globalThis.chrome;

export const SETTINGS = ["rctAppId", "rctAppSecret", "calendarToken"];

// The options page's settings. Anything left empty there falls back to the
// built-in tokens.
export async function loadSettings() {
  const stored = await api.storage.local.get(SETTINGS);
  return Object.fromEntries(SETTINGS.map((key) => [key, stored[key] || TOKENS[key]]));
}
