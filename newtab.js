import { cachedEvents, fetchEvents, roomSlug, watchOccupancy } from "./room-status.js";
import { ZOOM_LINKS } from "./secrets.js";
import { SETTINGS, loadSettings } from "./settings.js";

const api = globalThis.browser ?? globalThis.chrome;

// An event this close to starting is marked "Starting soon".
const SOON_MINUTES = 5;

const MINUTE = 60 * 1000;

// Rooms get their direct Zoom link from zoom-links.json when the extension is
// built. Without one, they go through recurse.com, which needs you signed in.
const withLink = (room) => ({
  url: ZOOM_LINKS[room.slug] ?? `https://www.recurse.com/zoom/${room.slug}`,
  ...room,
});

const ROOMS = [
  { name: "Presentation Space", key: "P", icon: "monitor", wide: true },
  { name: "Genera", key: "G" },
  { name: "Verve", key: "V" },
  { name: "Edos", key: "E" },
  { name: "Midori", key: "M" },
].map((room) => withLink({ slug: roomSlug(room.name), ...room }));

// Drop-in spaces, shown with the pairing stations.
const LOUNGE = [{ name: "Couches", key: "C", icon: "sofa" }].map((room) =>
  withLink({ slug: roomSlug(room.name), ...room }),
);

const PAIRING_STATIONS = Array.from({ length: 5 }, (_, i) =>
  withLink({
    name: `Station ${i + 1}`,
    key: `${i + 1}`,
    icon: "users",
    slug: `pairing_station_${i + 1}`,
  }),
);

const roomTemplate = document.getElementById("room-template");
const eventTemplate = document.getElementById("event-template");

const shortcuts = new Map();
// Room slug → the tile's elements, for the live status to fill in.
const tiles = new Map();

function buildTile(room) {
  const item = roomTemplate.content.firstElementChild.cloneNode(true);
  const link = item.querySelector(".room");
  link.href = room.url;
  item.querySelector(".room-name").textContent = room.name;
  if (room.wide) item.classList.add("wide");
  item.querySelector(".room-icon use").setAttribute("href", `#icon-${room.icon ?? "video"}`);
  item.querySelector(".room-key-cap").textContent = room.key;
  shortcuts.set(room.key.toLowerCase(), link);
  tiles.set(room.slug, {
    link,
    guests: item.querySelector(".room-guests"),
    guestCount: item.querySelector(".room-guests-count"),
    faces: item.querySelector(".faces"),
    status: item.querySelector(".room-status"),
    statusLabel: item.querySelector(".room-status-label"),
    statusText: item.querySelector(".room-status-text"),
  });
  return item;
}

for (const room of ROOMS) {
  document.getElementById("rooms").append(buildTile(room));
}

for (const room of [...LOUNGE, ...PAIRING_STATIONS]) {
  document.getElementById("lounge").append(buildTile(room));
}

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
  shortcuts.get(event.key.toLowerCase())?.click();
});

const time = document.getElementById("time");
const date = document.getElementById("date");
const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});
const dateFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

function renderClock() {
  const now = new Date();
  time.textContent = timeFormat.format(now);
  time.dateTime = now.toISOString();
  date.textContent = dateFormat.format(now);
  setTimeout(renderClock, 1000 - (now % 1000));
}
renderClock();

// Live status: who's in each room, and what's on the calendar.

const hourFormat = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

const schedule = document.getElementById("schedule");
const scheduleDone = document.getElementById("schedule-done");

const settings = await loadSettings();
let occupancy = null;
// The background script saves a fresh calendar every few hours, so there's
// nearly always one to show straight away. null until there is one.
let events = await cachedEvents();
let calendarFailed = false;

function face({ name, image }) {
  const initials = document.createElement("span");
  initials.className = "face";
  initials.textContent =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join("") || "?";
  if (!image) return initials;

  const img = document.createElement("img");
  img.className = "face";
  img.src = image;
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  img.onerror = () => img.replaceWith(initials);
  return img;
}

// Everyone gets a face; the CSS clips the row when there are too many.
function renderFaces(container, people = []) {
  container.replaceChildren(...people.map(face));
  container.title = people.map((person) => person.name).join(", ");
}

const isLive = (event, now) => event.start <= now && now < event.end;
const isSoon = (event, now) => now < event.start && event.start - now <= SOON_MINUTES * MINUTE;

function renderTiles(now, people) {
  for (const [slug, tile] of tiles) {
    const here = people?.get(slug) ?? [];
    tile.guests.hidden = here.length === 0;
    tile.guestCount.textContent = here.length;
    tile.guests.title = `${here.length} guest${here.length === 1 ? "" : "s"}`;
    renderFaces(tile.faces, here);
    const roomEvents = (events ?? []).filter((event) => event.room === slug);
    const live = roomEvents.find((event) => isLive(event, now));
    const soon = !live && roomEvents.find((event) => isSoon(event, now));
    tile.link.classList.toggle("live", Boolean(live));
    tile.link.classList.toggle("soon", Boolean(soon));
    tile.status.hidden = !live && !soon;
    tile.statusLabel.textContent = live ? "Now: " : soon ? "Starting soon: " : "";
    renderStatus(tile.statusText, (live || soon)?.title ?? "");
  }
}

// The event's title, which scrolls by in a marquee after the "Now: " when
// it's too long to fit, because that's funny. The marquee is only rebuilt
// when it has to be, so people coming and going don't keep restarting it.
function renderStatus(element, text) {
  if (element.dataset.text !== text) {
    element.dataset.text = text;
    element.replaceChildren(text);
    const range = document.createRange();
    range.selectNodeContents(element);
    element.dataset.width = range.getBoundingClientRect().width;
  }
  const marquee = element.querySelector("marquee");
  const tooLong = Number(element.dataset.width) > element.clientWidth;
  if (tooLong && !marquee) {
    const marquee = document.createElement("marquee");
    marquee.scrollAmount = 4;
    marquee.textContent = text;
    element.replaceChildren(marquee);
  } else if (!tooLong && marquee) {
    element.replaceChildren(text);
  }
}

const allRooms = [
  ...ROOMS,
  ...LOUNGE,
  ...PAIRING_STATIONS,
];

// "presentation_space" → "Presentation Space", for rooms without a tile.
function roomTitle(slug) {
  return slug.replace(/(^|_)(\w)/g, (_, gap, letter) => (gap && " ") + letter.toUpperCase());
}

function buildEvent(event, now, people) {
  const item = eventTemplate.content.firstElementChild.cloneNode(true);
  const link = item.querySelector(".event");
  const room = allRooms.find((room) => room.slug === event.room);
  const live = isLive(event, now);
  const soon = isSoon(event, now);
  // A room's direct Zoom link skips recurse.com's sign-in.
  link.href = room?.url ?? event.link;
  link.classList.toggle("live", live);
  link.classList.toggle("soon", soon);
  item.querySelector(".event-when").textContent = live ? "Now" : soon ? "Starting soon" : "";
  item.querySelector(".event-start").textContent = hourFormat.format(event.start);
  item.querySelector(".event-end").textContent = hourFormat.format(event.end);
  item.querySelector(".event-title").textContent = event.title;
  item.querySelector(".event-room-name").textContent =
    room?.name ?? (event.room ? roomTitle(event.room) : "Zoom");
  item.querySelector("use").setAttribute("href", `#icon-${room?.icon ?? "video"}`);
  if (live) renderFaces(item.querySelector(".faces"), people?.get(event.room));
  return item;
}

// The rest of today's events.
function renderSchedule(now, people) {
  const today = new Date(now).toDateString();
  const shown = (events ?? []).filter(
    (event) => event.end > now && new Date(Math.max(event.start, now)).toDateString() === today,
  );
  schedule.replaceChildren(...shown.map((event) => buildEvent(event, now, people)));
  moveScrollbar();

  scheduleDone.hidden = shown.length > 0;
  scheduleDone.textContent = events
    ? "There's nothing left for today."
    : !settings.calendarToken
      ? "No calendar token. Add one on the options page."
      : calendarFailed
        ? "Couldn't load the RC calendar."
        : "Loading…";
}

const scrollbar = document.querySelector(".scrollbar");
const scrollbarThumb = document.querySelector(".scrollbar-thumb");

// Sizes and moves the scrollbar's thumb to match the schedule.
function moveScrollbar() {
  const { scrollTop, scrollHeight, clientHeight } = schedule;
  scrollbar.hidden = scrollHeight <= clientHeight + 1;
  if (scrollbar.hidden) return;
  const track = scrollbar.clientHeight;
  const thumbHeight = Math.max((clientHeight / scrollHeight) * track, 24);
  scrollbarThumb.style.height = `${thumbHeight}px`;
  scrollbarThumb.style.transform = `translateY(${(scrollTop / (scrollHeight - clientHeight)) * (track - thumbHeight)}px)`;
}
schedule.addEventListener("scroll", moveScrollbar, { passive: true });

scrollbarThumb.addEventListener("pointerdown", (event) => {
  const startY = event.clientY;
  const startTop = schedule.scrollTop;
  const { scrollHeight, clientHeight } = schedule;
  const perPixel =
    (scrollHeight - clientHeight) / (scrollbar.clientHeight - scrollbarThumb.offsetHeight);
  const drag = (move) => (schedule.scrollTop = startTop + (move.clientY - startY) * perPixel);
  scrollbarThumb.setPointerCapture(event.pointerId);
  scrollbar.classList.add("dragging");
  scrollbarThumb.addEventListener("pointermove", drag);
  scrollbarThumb.addEventListener(
    "lostpointercapture",
    () => {
      scrollbar.classList.remove("dragging");
      scrollbarThumb.removeEventListener("pointermove", drag);
    },
    { once: true },
  );
  event.preventDefault();
});

function render() {
  const now = Date.now();
  const people = occupancy?.peopleByRoom() ?? null;
  renderTiles(now, people);
  renderSchedule(now, people);
}

// Every minute, for events starting and ending.
function tick() {
  render();
  setTimeout(tick, MINUTE - (Date.now() % MINUTE));
}

// Shows the saved calendar first, then swaps in a fresh one, in case
// something was added since the background script last saved it.
async function refreshCalendar() {
  if (!settings.calendarToken) return;
  try {
    events = await fetchEvents(settings.calendarToken);
  } catch (error) {
    // The saved calendar, if there is one, is close enough.
    console.error(error);
    calendarFailed = true;
  }
  render();
}

if (settings.rctAppId && settings.rctAppSecret) {
  occupancy = watchOccupancy(
    { appId: settings.rctAppId, appSecret: settings.rctAppSecret },
    render,
  );
}
// Text is measured for the marquees, so wait for the real fonts.
await document.fonts.ready;
tick();
refreshCalendar();
window.addEventListener("resize", () => {
  // Everything scales with the window, so measure the statuses again.
  for (const tile of tiles.values()) delete tile.statusText.dataset.text;
  render();
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (SETTINGS.some((key) => key in changes)) location.reload();
  // The background script saved a fresh calendar.
  if (changes.calendarCache?.newValue) {
    events = changes.calendarCache.newValue.events;
    render();
  }
});
