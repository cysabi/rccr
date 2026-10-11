const api = globalThis.browser ?? globalThis.chrome;

// Answers the background script's idle check. Frames without playing media stay
// silent so they don't drown out a frame (like an embedded video) that has some.
api.runtime.onMessage.addListener((message) => {
  if (message?.type !== "media-playing?") return;
  const playing = [...document.querySelectorAll("video, audio")].some(
    (media) => !media.paused && !media.ended && media.readyState > 2,
  );
  if (playing) return Promise.resolve(true);
});
