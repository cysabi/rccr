# `RCCR`
> a firefox and chrome extension for the recurse center conference room

- deletes the post-meeting zoom ads (most important)
- shows a schedule of what's next on the calendar
- keybinds to open any room

## setup
- Copy `.env.example` to `.env` and fill it in:
  - `RCT_APP_` is from https://recurse.rctogether.com/apps
  - `RC_CALENDAR_TOKEN` is from https://www.recurse.com/calendar
- Copy `zoom-links.example.json` to `zoom-links.json` and fill in each room's direct zoom link
- Run `node build.mjs` for Firefox, or `node build.mjs chrome` for Chrome

The tokens from `.env` fill in the settings page the first time the extension runs. After that the settings page is the only place they're read from, so changing them there sticks across rebuilds.

Add `--public` to build without the tokens and Zoom links, into `web-ext-artifacts/public/`. Those are the builds to share.

### releasing
Bump `version` in `manifest.json` and push to `main`. The release action builds both public packages and publishes them as a GitHub release.

### developing
```sh
npx web-ext run
npx web-ext lint
```

The source tree is the Firefox version. For Chrome, run `node build.mjs chrome`, unzip the package, and load the folder from `chrome://extensions` with *Load unpacked*.

---

*empathy included • [**@cysabi**](https://github.com/cysabi) • [cysabi.github.io](https://cysabi.github.io)*
