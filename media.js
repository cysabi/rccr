const api = globalThis.browser ?? globalThis.chrome;

// Answers the background script's idle check. Frames without playing media stay
// silent so they don't drown out a frame (like an embedded video) that has some.
// Answers with sendResponse rather than a Promise, which Chrome doesn't take.
api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "media-playing?") return;
  const playing = [...document.querySelectorAll("video, audio")].some(
    (media) =>
      !media.paused &&
      !media.ended &&
      !media.muted &&
      media.volume > 0 &&
      media.readyState > 2,
  );
  if (playing) sendResponse(true);
});
