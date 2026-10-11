// Live status for the rooms page: who's in each Zoom room, from Virtual RC
// (RC Together), and what's on the RC calendar.

const api = globalThis.browser ?? globalThis.chrome;

const RCT_ORIGIN = "https://recurse.rctogether.com";
const RCT_CABLE_URL = "wss://recurse.rctogether.com/cable";
const CALENDAR_URL = "https://www.recurse.com/calendar/events.ics";
const RC_ZOOM_PREFIX = "https://www.recurse.com/zoom/";

// How long a downloaded calendar is used before fetching it again.
const CALENDAR_REFRESH_MINUTES = 15;
// Calendar events starting further out than this are dropped.
const CALENDAR_DAYS_AHEAD = 7;
// Virtual RC sometimes leaves people "in" a room long after they've gone.
const STALE_HOURS = 5;
// RC Together pings every 3 seconds, so this much silence means the socket died.
const SOCKET_SILENCE_SECONDS = 15;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// "Presentation Space" → "presentation_space", the form recurse.com/zoom/ links use.
export function roomSlug(name) {
  return name.trim().toLowerCase().replace(/\W+/g, "_");
}

// Follows who's in which Zoom room. The socket is only open while the page is
// visible. Calls onChange whenever peopleByRoom() would return something new.
export function watchOccupancy({ appId, appSecret }, onChange) {
  const avatars = new Map();
  let socket = null;
  let synced = false;
  let silenceTimer;
  let retryTimer;
  let retryDelay = 1000;

  const isStale = (avatar) => avatar.lastSeen < Date.now() - STALE_HOURS * HOUR;

  // Map of room slug → [{ name, image }], or null when we aren't synced, so
  // callers can tell an empty room from one we know nothing about.
  function peopleByRoom() {
    if (!synced) return null;
    const rooms = new Map();
    for (const avatar of avatars.values()) {
      if (isStale(avatar)) continue;
      if (!rooms.has(avatar.room)) rooms.set(avatar.room, []);
      rooms.get(avatar.room).push(avatar);
    }
    for (const people of rooms.values()) {
      people.sort((a, b) => a.name.localeCompare(b.name));
    }
    return rooms;
  }

  // Records an entity from the stream. Returns whether anything visible changed.
  function track(entity) {
    if (entity.type !== "Avatar" && entity.type !== "UnknownAvatar") return false;
    const before = avatars.get(entity.id);
    if (entity.deleted || !entity.zoom_user_display_name) {
      avatars.delete(entity.id);
      return Boolean(before);
    }
    const after = {
      name: entity.person_name ?? "",
      image: entity.image_path ? new URL(entity.image_path, RCT_ORIGIN).href : null,
      room: roomSlug(entity.zoom_user_display_name),
      lastSeen: Date.parse(entity.last_seen_at) || Infinity,
    };
    avatars.set(entity.id, after);
    return (
      !before ||
      before.room !== after.room ||
      before.name !== after.name ||
      before.image !== after.image ||
      isStale(before) !== isStale(after)
    );
  }

  function connect() {
    if (socket) return;
    clearTimeout(retryTimer);
    const url = new URL(RCT_CABLE_URL);
    url.searchParams.set("app_id", appId);
    url.searchParams.set("app_secret", appSecret);
    // The Origin header RC Together insists on is added by background.js.
    const ws = (socket = new WebSocket(url));
    expectMessage();

    ws.onclose = reconnect;
    ws.onmessage = ({ data }) => {
      expectMessage();
      const message = JSON.parse(data);
      switch (message.type) {
        case "welcome":
          ws.send(
            JSON.stringify({
              command: "subscribe",
              identifier: JSON.stringify({ channel: "ApiChannel" }),
            }),
          );
          return;
        case "reject_subscription":
        case "disconnect":
          reconnect();
          return;
        case undefined:
          break;
        default:
          return; // ping, confirm_subscription
      }

      const { type, payload } = message.message;
      if (type === "world") {
        avatars.clear();
        payload.entities.forEach(track);
        synced = true;
        retryDelay = 1000;
        onChange();
      } else if (type === "entity" && track(payload)) {
        onChange();
      }
    };
  }

  function disconnect() {
    clearTimeout(silenceTimer);
    clearTimeout(retryTimer);
    if (socket) {
      socket.onclose = socket.onmessage = null;
      socket.close();
      socket = null;
    }
    if (synced) {
      synced = false;
      onChange();
    }
  }

  function reconnect() {
    disconnect();
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, MINUTE);
  }

  function expectMessage() {
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(reconnect, SOCKET_SILENCE_SECONDS * 1000);
  }

  // Reconnecting gets a fresh snapshot, so there's no point holding a socket
  // open while nobody can see the page (e.g. a meeting tab is in front).
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) disconnect();
    else connect();
  });
  if (!document.hidden) connect();

  return { peopleByRoom };
}

// Upcoming calendar events that have a Zoom link, soonest first. Uses the
// cached copy while it's recent, and falls back to it if the fetch fails.
export async function loadEvents(token) {
  const { calendarCache: cache } = await api.storage.local.get("calendarCache");
  if (cache && Date.now() - cache.fetchedAt < CALENDAR_REFRESH_MINUTES * MINUTE) {
    return cache.events;
  }
  try {
    const url = new URL(CALENDAR_URL);
    url.searchParams.set("token", token);
    url.searchParams.set("omit_cancelled_events", "1");
    url.searchParams.set("scope", "all");
    const response = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!response.ok) throw new Error(`Calendar request failed: HTTP ${response.status}`);
    const fetchedAt = Date.now();
    const events = parseEvents(await response.text(), fetchedAt);
    await api.storage.local.set({ calendarCache: { fetchedAt, events } });
    return events;
  } catch (error) {
    if (cache) return cache.events;
    throw error;
  }
}

// Pulls the events with a Zoom link out of an iCalendar file, keeping the ones
// that haven't ended and start within CALENDAR_DAYS_AHEAD. recurse.com expands
// repeating events into separate VEVENTs, so there are no RRULEs to handle.
export function parseEvents(ics, now) {
  const until = now + CALENDAR_DAYS_AHEAD * DAY;
  // Cheap string comparison on YYYYMMDD skips most events without date math.
  // The day either side of the window covers time zone differences.
  const firstDay = yyyymmdd(now - DAY);
  const lastDay = yyyymmdd(until + DAY);

  const events = [];
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  for (const block of unfolded.split("BEGIN:VEVENT").slice(1)) {
    const props = {};
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/);
      if (match && !(match[1] in props)) {
        props[match[1]] = { params: match[2], value: match[3] };
      }
    }

    const link = props["X-CONFERENCE-URL"]?.value ?? props.CONFERENCE?.value;
    if (!link || !props.DTSTART || !props.DTEND) continue;
    if (props.DTEND.value.slice(0, 8) < firstDay) continue;
    if (props.DTSTART.value.slice(0, 8) > lastDay) continue;

    const start = parseDate(props.DTSTART);
    const end = parseDate(props.DTEND);
    if (start === null || end === null || end <= now || start > until) continue;

    events.push({
      title: unescapeText(props.SUMMARY?.value ?? "") || "Untitled event",
      start,
      end,
      link,
      room: link.startsWith(RC_ZOOM_PREFIX)
        ? roomSlug(link.slice(RC_ZOOM_PREFIX.length))
        : null,
    });
  }
  return events.sort((a, b) => a.start - b.start);
}

function yyyymmdd(time) {
  return new Date(time).toISOString().slice(0, 10).replaceAll("-", "");
}

function unescapeText(text) {
  return text.replace(/\\([\\;,nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

// Milliseconds since the epoch for a DATE or DATE-TIME property, honouring TZID.
function parseDate({ params, value }) {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!match) return null;
  const [, year, month, day, hour = 0, minute = 0, second = 0, utc] = match;
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  if (utc) return wallClock;

  const timeZone = params.match(/TZID=("?)([^";:]+)\1/)?.[2];
  if (!timeZone) return new Date(year, month - 1, day, hour, minute, second).getTime();
  // Guess with the zone's offset at the wall-clock time, then correct with the
  // offset at the guess, which differs only across a DST change.
  const guess = wallClock - zoneOffset(wallClock, timeZone);
  return wallClock - zoneOffset(guess, timeZone);
}

const zoneFormats = new Map();

// How far ahead of UTC the zone's clocks are at the given instant, in ms.
function zoneOffset(time, timeZone) {
  if (!zoneFormats.has(timeZone)) {
    zoneFormats.set(
      timeZone,
      new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      }),
    );
  }
  const parts = Object.fromEntries(
    zoneFormats
      .get(timeZone)
      .formatToParts(time)
      .map(({ type, value }) => [type, value]),
  );
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(time / 1000) * 1000;
}
