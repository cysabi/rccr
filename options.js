const api = globalThis.browser ?? globalThis.chrome;

const SETTINGS = ["rctAppId", "rctAppSecret", "calendarToken"];

const form = document.getElementById("settings");
const status = document.getElementById("status");

// The calendar's iCal link carries the token as ?token=…, so accept either.
function calendarToken(value) {
  try {
    return new URL(value).searchParams.get("token") ?? "";
  } catch {
    return value;
  }
}

api.storage.local.get(SETTINGS).then((settings) => {
  for (const key of SETTINGS) form.elements[key].value = settings[key] ?? "";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const values = Object.fromEntries(
    SETTINGS.map((key) => [key, form.elements[key].value.trim()]),
  );
  values.calendarToken = calendarToken(values.calendarToken);
  form.elements.calendarToken.value = values.calendarToken;
  await api.storage.local.set(values);
  // A new token may mean a different calendar.
  await api.storage.local.remove("calendarCache");
  status.textContent = "Saved. Open rooms pages will reload.";
});
