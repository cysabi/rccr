import { TOKENS } from "./secrets.js";

const api = globalThis.browser ?? globalThis.chrome;

export const SETTINGS = ["rctAppId", "rctAppSecret", "calendarToken", "roomName"];

// What a fresh install starts with: the tokens build.mjs packaged in, if any,
// and the defaults. After that the options page is the only source.
const INITIAL = { roomName: "Sammet", ...TOKENS };

export async function loadSettings() {
  const stored = await api.storage.local.get(SETTINGS);
  return Object.fromEntries(SETTINGS.map((key) => [key, stored[key] ?? ""]));
}

// Saves the initial value of any setting that has never been saved, so the
// options page shows the values in use. Safe to call any number of times.
export async function seedSettings() {
  const stored = await api.storage.local.get(SETTINGS);
  const missing = SETTINGS.filter((key) => !(key in stored));
  if (missing.length === 0) return;
  await api.storage.local.set(
    Object.fromEntries(missing.map((key) => [key, INITIAL[key] ?? ""])),
  );
}
