(function () {
  "use strict";

  const FILES = {
    keypad: [
      "dzwieki/klawisze_numeryczne.wav",
      "dzwieki/klawisze_numeryczne.mp3",
      "dzwieki/klawisze_numeryczne.ogg"
    ],
    field: [
      "dzwieki/pola_tankowania.wav",
      "dzwieki/pola_tankowania.mp3",
      "dzwieki/pola_tankowania.ogg"
    ],
    other: [
      "dzwieki/pozostale_funkcje.wav",
      "dzwieki/pozostale_funkcje.mp3",
      "dzwieki/pozostale_funkcje.ogg"
    ]
  };

  const failed = {};
  const lastIndex = {};
  const activeAudio = [];

  function candidatesFor(group) {
    return FILES[group] || FILES.other;
  }

  function markFailed(src) {
    failed[src] = true;
  }

  function play(group) {
    if (typeof Audio !== "function") return;
    const candidates = candidatesFor(group);
    const start = Number(lastIndex[group] || 0);
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const index = (start + offset) % candidates.length;
      const src = candidates[index];
      if (failed[src]) continue;
      lastIndex[group] = index;
      try {
        const audio = new Audio(src);
        audio.preload = "auto";
        audio.volume = 1;
        activeAudio.push(audio);
        audio.addEventListener("ended", function () {
          const activeIndex = activeAudio.indexOf(audio);
          if (activeIndex >= 0) activeAudio.splice(activeIndex, 1);
        }, { once: true });
        audio.addEventListener("error", function () {
          const activeIndex = activeAudio.indexOf(audio);
          if (activeIndex >= 0) activeAudio.splice(activeIndex, 1);
          markFailed(src);
          lastIndex[group] = (index + 1) % candidates.length;
        }, { once: true });
        const promise = audio.play();
        if (promise && typeof promise.catch === "function") {
          promise.catch(function () {
            markFailed(src);
            lastIndex[group] = (index + 1) % candidates.length;
          });
        }
      } catch (error) {
        markFailed(src);
        lastIndex[group] = (index + 1) % candidates.length;
      }
      return;
    }
  }

  window.TankowanieSounds = {
    play
  };
})();
