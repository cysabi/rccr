// Packages the extension with the tokens from .env and the Zoom links from
// zoom-links.json built in:
//   node build.mjs
// writes web-ext-artifacts/recurse_center_conference_room-<version>.xpi. The source tree's
// secrets.js stays empty, so the secrets only ever live in those two files and
// the package.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FILES = [
  "manifest.json",
  "background.js",
  "media.js",
  "room-status.js",
  "newtab.html",
  "newtab.css",
  "newtab.js",
  "options.html",
  "options.css",
  "options.js",
  "icons",
  "fonts",
];

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split("\n")
    .map((line) => line.match(/^\s*([\w.]+)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^(["'])(.*)\1$/, "$2")]),
);

// Like the options page, accept the whole iCal link or just its token.
function calendarToken(value = "") {
  try {
    return new URL(value).searchParams.get("token") ?? "";
  } catch {
    return value;
  }
}

const tokens = {
  rctAppId: env.RCT_APP_ID ?? "",
  rctAppSecret: env.RCT_APP_SECRET ?? "",
  calendarToken: calendarToken(env.RC_CALENDAR_TOKEN),
};
for (const [key, value] of Object.entries(tokens)) {
  if (!value) throw new Error(`.env is missing a value for ${key}`);
}

const zoomLinks = JSON.parse(fs.readFileSync("zoom-links.json", "utf8"));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rc-conference-room-"));
try {
  for (const file of FILES) fs.cpSync(file, path.join(dir, file), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "secrets.js"),
    `// hi! this is cyrene :) you've found my token! if you have any concerns about my security, or otherwise want to ask any questions, feel free to dm me on zulip @cyrene-zhang
export const TOKENS = ${JSON.stringify(tokens, null, 2)};

export const ZOOM_LINKS = ${JSON.stringify(zoomLinks, null, 2)};
`,
  );
  execFileSync("npx", ["web-ext", "lint", "--source-dir", dir], { stdio: "inherit" });
  execFileSync(
    "npx",
    [
      "web-ext",
      "build",
      "--source-dir",
      dir,
      "--artifacts-dir",
      "web-ext-artifacts",
      "--filename",
      "{name}-{version}.xpi",
      "--overwrite-dest",
    ],
    { stdio: "inherit" },
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
