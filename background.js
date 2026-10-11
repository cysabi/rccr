import { fetchEvents } from "./room-status.js";
import { loadSettings } from "./settings.js";

const api = globalThis.browser ?? globalThis.chrome;

// How long the room must be completely quiet before we reset the browser.
const IDLE_MINUTES = 60;
// How often a fresh calendar is saved for the rooms page to show.
const CALENDAR_REFRESH_HOURS = 2;
// We can't see inside the Zoom desktop app, so after a meeting is launched we
// assume it's still running until Zoom shows its post-meeting page or this
// much time passes.
const MEETING_MAX_MINUTES = 4 * 60;

const MINUTE = 60 * 1000;
const NEW_TAB_URLS = new Set([
  "about:newtab",
  "about:home",
  api.runtime.getURL("newtab.html"),
]);

// Zoom pages we leave alone. Any other zoom.us / zoom.com page that pops up in
// a new tab is treated as an ad and closed.
const ZOOM_LAUNCH_PATHS = ["/j/", "/s/", "/w/", "/my/"];
const ZOOM_WEB_CLIENT_PATHS = ["/wc/"];
const ZOOM_ENDED_PATHS = ["/postattendee", "/wc/leave"];
const ZOOM_ALLOWED_PATHS = [
  "/join",
  "/launch",
  "/signin",
  "/oauth",
  "/saml",
  "/sso",
  "/download",
  "/rec/",
  "/meeting/register",
  "/webinar/register",
];

function classifyZoomUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = url.hostname;
  const isZoom = ["zoom.us", "zoom.com"].some(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (!isZoom) return null;

  const path = url.pathname;
  const matches = (prefixes) => prefixes.some((p) => path.startsWith(p));
  if (matches(ZOOM_ENDED_PATHS)) return "ended";
  if (matches(ZOOM_WEB_CLIENT_PATHS)) return "web-client";
  if (matches(ZOOM_LAUNCH_PATHS)) return "launch";
  if (matches(ZOOM_ALLOWED_PATHS)) return "allowed";
  return "ad";
}

async function getState() {
  const { lastBusyAt = 0, meetingLaunchedAt = null } =
    await api.storage.local.get(["lastBusyAt", "meetingLaunchedAt"]);
  return { lastBusyAt, meetingLaunchedAt };
}

async function closeTab(tab) {
  // Closing the last tab would close the window, so leave a new tab behind.
  const siblings = await api.tabs.query({ windowId: tab.windowId });
  if (siblings.length === 1) {
    await api.tabs.create({ windowId: tab.windowId });
  }
  await api.tabs.remove(tab.id);
}

// Tabs that haven't loaded a real page yet. Zoom's ads arrive as brand new
// tabs, so we only close Zoom pages that are the first thing a tab opens.
// Someone navigating to zoom.us on purpose is left alone.
const freshTabs = new Set();

async function handleTabUrl(tab, url) {
  const fresh = freshTabs.has(tab.id);
  if (url !== "about:blank") freshTabs.delete(tab.id);

  switch (classifyZoomUrl(url)) {
    case "launch":
      await api.storage.local.set({ meetingLaunchedAt: Date.now() });
      break;
    case "ended":
      await api.storage.local.set({
        meetingLaunchedAt: null,
        lastBusyAt: Date.now(),
      });
      await closeTab(tab);
      break;
    case "ad":
      if (fresh) await closeTab(tab);
      break;
  }
}

api.tabs.onCreated.addListener((tab) => {
  freshTabs.add(tab.id);
  if (tab.url && tab.url !== "about:blank") handleTabUrl(tab, tab.url);
});

api.tabs.onRemoved.addListener((tabId) => freshTabs.delete(tabId));

api.tabs.onUpdated.addListener(
  (_tabId, changeInfo, tab) => {
    if (changeInfo.url) handleTabUrl(tab, changeInfo.url);
  },
  { properties: ["url"] },
);

async function isMediaPlaying(tab) {
  if (tab.audible) return true;
  try {
    return (await api.tabs.sendMessage(tab.id, { type: "media-playing?" })) === true;
  } catch {
    // No content script in this tab (about: pages, extension pages, etc).
    return false;
  }
}

async function isBusy(tabs, meetingLaunchedAt) {
  if (tabs.some((tab) => classifyZoomUrl(tab.url) === "web-client")) return true;
  if (meetingLaunchedAt && Date.now() - meetingLaunchedAt < MEETING_MAX_MINUTES * MINUTE) {
    return true;
  }
  const playing = await Promise.all(tabs.map(isMediaPlaying));
  return playing.includes(true);
}

function isClean(windows) {
  if (windows.length !== 1) return false;
  const [win] = windows;
  return win.tabs.length === 1 && NEW_TAB_URLS.has(win.tabs[0].url);
}

// Leaves one window with just the rooms page in it. A tab already showing the
// rooms page is kept rather than opening a new one, so it doesn't flash white
// and load again (e.g. the homepage, right after Firefox starts).
async function resetBrowser() {
  const windows = await api.windows.getAll({ populate: true, windowTypes: ["normal"] });
  if (windows.length === 0) {
    await api.windows.create();
    return;
  }
  const tabs = windows.flatMap((win) => win.tabs);
  const rooms =
    tabs.find((tab) => NEW_TAB_URLS.has(tab.url)) ??
    (await api.tabs.create({ windowId: windows[0].id }));
  await api.tabs.update(rooms.id, { active: true });
  await api.tabs.remove(tabs.filter((tab) => tab.id !== rooms.id).map((tab) => tab.id));
  await Promise.all(
    windows.filter((win) => win.id !== rooms.windowId).map((win) => api.windows.remove(win.id)),
  );
}

async function tick() {
  const now = Date.now();
  const windows = await api.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const tabs = windows.flatMap((win) => win.tabs);
  const { lastBusyAt, meetingLaunchedAt } = await getState();

  // Check this every tick, not just once the user goes idle, so that media
  // which stops halfway through the idle window still pushes the reset back.
  if (await isBusy(tabs, meetingLaunchedAt)) {
    await api.storage.local.set({ lastBusyAt: now });
    return;
  }
  if (now - lastBusyAt < IDLE_MINUTES * MINUTE) return;

  // System-wide on Windows, so this covers mouse and keyboard input in any app.
  const idleState = await api.idle.queryState(IDLE_MINUTES * 60);
  if (idleState === "active") return;

  if (!isClean(windows)) await resetBrowser();
}

// The rooms page watches Virtual RC over a websocket, but RC Together only
// accepts connections from its own site, and Firefox sends the extension's
// moz-extension:// origin. So swap it.
const RCT_ORIGIN = "https://recurse.rctogether.com";

api.webRequest.onBeforeSendHeaders.addListener(
  ({ requestHeaders }) => ({
    requestHeaders: [
      ...requestHeaders.filter((header) => header.name.toLowerCase() !== "origin"),
      { name: "Origin", value: RCT_ORIGIN },
    ],
  }),
  {
    urls: ["wss://recurse.rctogether.com/cable*", "https://recurse.rctogether.com/cable*"],
    types: ["websocket"],
  },
  ["blocking", "requestHeaders"],
);

// The rooms page shows this saved copy straight away, then fetches its own.
async function refreshCalendar() {
  const { calendarToken } = await loadSettings();
  if (calendarToken) await fetchEvents(calendarToken);
}

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "tick") tick();
  if (alarm.name === "calendar") refreshCalendar();
});

api.runtime.onStartup.addListener(async () => {
  await api.storage.local.set({ lastBusyAt: Date.now() });
  await resetBrowser();
});

api.alarms.get("tick").then((alarm) => {
  if (!alarm) api.alarms.create("tick", { periodInMinutes: 1 });
});

// Created without a delay, so the first one is saved right away.
api.alarms.get("calendar").then((alarm) => {
  if (!alarm) {
    api.alarms.create("calendar", {
      when: Date.now(),
      periodInMinutes: CALENDAR_REFRESH_HOURS * 60,
    });
  }
});
