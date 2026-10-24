// Packages the extension for Firefox or Chrome:
//   node build.mjs [firefox|chrome] [--public]
// writes web-ext-artifacts/rccr-<version>.xpi for Firefox, or
// web-ext-artifacts/rccr-<version>-chrome.zip for Chrome.
//
// By default the tokens from .env and the Zoom links from zoom-links.json are
// built in. The source tree's secrets.js stays empty, so the secrets only ever
// live in those two files and the package. --public leaves them out, for
// builds anyone can download, and writes to web-ext-artifacts/public instead.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILES = [
  "manifest.json",
  "background.js",
  "media.js",
  "room-status.js",
  "settings.js",
  "secrets.js",
  "newtab.html",
  "newtab.css",
  "newtab.js",
  "options.html",
  "options.css",
  "options.js",
  "icons",
  "fonts",
];
const CHROME_FILES = ["chrome-rules.json"];

const args = process.argv.slice(2);
const isPublic = args.includes("--public");
const target = args.find((arg) => !arg.startsWith("--")) ?? "firefox";
if (!["firefox", "chrome"].includes(target)) {
  throw new Error(`Unknown target "${target}", expected firefox or chrome`);
}

// Like the options page, accept the whole iCal link or just its token.
function calendarToken(value = "") {
  try {
    return new URL(value).searchParams.get("token") ?? "";
  } catch {
    return value;
  }
}

function secretsFile() {
  const env = Object.fromEntries(
    fs
      .readFileSync(".env", "utf8")
      .split("\n")
      .map((line) => line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.replace(/^(["'])(.*)\1$/, "$2")]),
  );

  const tokens = {
    rctAppId: env.RCT_APP_ID ?? "",
    rctAppSecret: env.RCT_APP_SECRET ?? "",
    calendarToken: calendarToken(env.RC_CALENDAR_TOKEN),
  };
  for (const [key, value] of Object.entries(tokens)) {
    if (!value) throw new Error(`.env is missing a value for ${key}`);
  }

  const zoomLinks = JSON.parse(fs.readFileSync("zoom-links.json", "utf8"));

  return `// hi! this is cyrene :) you've found my token! if you have any concerns about my security, or otherwise want to ask any questions, feel free to dm me on zulip @cyrene-zhang
export const TOKENS = ${JSON.stringify(tokens, null, 2)};

export const ZOOM_LINKS = ${JSON.stringify(zoomLinks, null, 2)};
`;
}

// Chrome doesn't allow blocking webRequest or background scripts, and only
// honors a homepage override on Windows and Mac. So its package fixes the RC
// Together Origin header with chrome-rules.json instead, and runs
// background.js as a service worker.
function chromeManifest(manifest) {
  const chrome = {
    ...manifest,
    permissions: [
      ...manifest.permissions.filter((permission) => !permission.startsWith("webRequest")),
      "declarativeNetRequest",
    ],
    background: { service_worker: manifest.background.scripts[0], type: manifest.background.type },
    declarative_net_request: {
      rule_resources: [{ id: "rctogether_origin", enabled: true, path: "chrome-rules.json" }],
    },
  };
  delete chrome.browser_specific_settings;
  delete chrome.chrome_settings_overrides;
  return chrome;
}

const files = target === "chrome" ? [...FILES, ...CHROME_FILES] : FILES;
const artifactsDir = isPublic ? "web-ext-artifacts/public" : "web-ext-artifacts";
const filename = target === "chrome" ? "{name}-{version}-chrome.zip" : "{name}-{version}.xpi";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-conference-room-"));
try {
  for (const file of files) fs.cpSync(file, path.join(dir, file), { recursive: true });
  if (!isPublic) fs.writeFileSync(path.join(dir, "secrets.js"), secretsFile());
  if (target === "chrome") {
    const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      `${JSON.stringify(chromeManifest(manifest), null, 2)}\n`,
    );
  } else {
    // web-ext lint checks against Firefox's rules, so it only makes sense here.
    execFileSync("npx", ["--yes", "web-ext", "lint", "--source-dir", dir], { stdio: "inherit" });
  }
  execFileSync(
    "npx",
    [
      "--yes",
      "web-ext",
      "build",
      "--source-dir",
      dir,
      "--artifacts-dir",
      artifactsDir,
      "--filename",
      filename,
      "--overwrite-dest",
    ],
    { stdio: "inherit" },
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
