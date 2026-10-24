A browser extension for the Recurse Center conference room.

## install
- **Firefox:** download the `.xpi`. It's unsigned, so either load it from `about:debugging` → *This Firefox* → *Load Temporary Add-on*, or install it in Firefox Developer Edition / Nightly with `xpinstall.signatures.required` set to `false` in `about:config`.
- **Chrome:** download the `-chrome.zip` and unzip it. Then in `chrome://extensions`, turn on *Developer mode* and choose *Load unpacked*.

## setup
These builds have no tokens bundled in. Open the extension's settings page and fill in:
- RCT app ID / secret from https://recurse.rctogether.com/apps
- your calendar token (or full iCal link) from https://www.recurse.com/calendar

Room links go through `https://www.recurse.com/zoom/<room>`. To bake in direct Zoom links (and your tokens), build it yourself with `node build.mjs` — see the README.
