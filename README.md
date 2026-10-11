# `RCCR`
> a firefox extension for the recurse center conference room

- deletes the post-meeting zoom ads (most important)
- shows a schedule of what's next on the calendar
- keybinds to open any room

## setup
- Copy `.env.example` to `.env` and fill it in:
  - `RCT_APP_` is from https://recurse.rctogether.com/apps
  - `RC_CALENDAR_TOKEN` is from https://www.recurse.com/calendar
- Copy `zoom-links.example.json` to `zoom-links.json` and fill in each room's direct zoom link
- Run `node build.mjs`

### developing
```sh
npx web-ext run
npx web-ext lint
```

---

*empathy included • [**@cysabi**](https://github.com/cysabi) • [cysabi.github.io](https://cysabi.github.io)*
