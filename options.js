import { SETTINGS, loadSettings } from "./settings.js";

const api = globalThis.browser ?? globalThis.chrome;

const RCT_URL = "https://recurse.rctogether.com/api/desks";
const CALENDAR_URL = "https://www.recurse.com/calendar/events.ics";

const form = document.getElementById("settings");
const status = document.getElementById("status");
const saveButton = form.querySelector("button[type=submit]");

// The calendar's iCal link carries the token as ?token=…, so accept either.
function calendarToken(value) {
  try {
    return new URL(value).searchParams.get("token") ?? "";
  } catch {
    return value;
  }
}

loadSettings().then((settings) => {
  for (const key of SETTINGS) form.elements[key].value = settings[key];
});

// Resolves if Virtual RC accepts the app, otherwise rejects with what went wrong.
async function checkVirtualRc({ rctAppId, rctAppSecret }) {
  const url = new URL(RCT_URL);
  url.searchParams.set("app_id", rctAppId);
  url.searchParams.set("app_secret", rctAppSecret);
  let response;
  try {
    response = await fetch(url, { credentials: "omit", cache: "no-store" });
  } catch {
    throw new Error("couldn't reach virtual rc");
  }
  if (response.status === 401) throw new Error("virtual rc rejected the app id and secret");
  if (!response.ok) throw new Error(`virtual rc returned http ${response.status}`);
}

// Resolves if recurse.com serves a calendar for the token.
async function checkCalendar({ calendarToken }) {
  const url = new URL(CALENDAR_URL);
  url.searchParams.set("token", calendarToken);
  let response;
  try {
    response = await fetch(url, { credentials: "omit", cache: "no-store" });
  } catch {
    throw new Error("couldn't reach recurse.com");
  }
  if (response.status === 404) throw new Error("recurse.com rejected the calendar token");
  if (!response.ok) throw new Error(`recurse.com returned http ${response.status}`);
  if (!(await response.text()).startsWith("BEGIN:VCALENDAR")) {
    throw new Error("recurse.com didn't return a calendar");
  }
}

// Each check and the fields it covers, which are marked when it fails.
const CHECKS = [
  { fields: ["rctAppId", "rctAppSecret"], check: checkVirtualRc },
  { fields: ["calendarToken"], check: checkCalendar },
];

function showStatus(text, isError = false) {
  status.textContent = text;
  status.classList.toggle("error", isError);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(
    SETTINGS.map((key) => [key, form.elements[key].value.trim()]),
  );
  values.calendarToken = calendarToken(values.calendarToken);
  form.elements.calendarToken.value = values.calendarToken;

  saveButton.disabled = true;
  showStatus("checking…");
  for (const key of SETTINGS) form.elements[key].removeAttribute("aria-invalid");

  // Fields left empty turn that feature off, so there's nothing to check.
  const results = await Promise.allSettled(
    CHECKS.filter(({ fields }) => fields.some((key) => values[key])).map(
      async ({ fields, check }) => {
        try {
          await check(values);
        } catch (error) {
          for (const key of fields) form.elements[key].setAttribute("aria-invalid", "true");
          throw error;
        }
      },
    ),
  );
  saveButton.disabled = false;

  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason.message);
  if (errors.length > 0) {
    showStatus(`not saved: ${errors.join("; ")}`, true);
    return;
  }

  await api.storage.local.set(values);
  // A new token may mean a different calendar.
  await api.storage.local.remove("calendarCache");
  showStatus("saved. open rooms pages will reload.");
});
