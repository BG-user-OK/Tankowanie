(function () {
  "use strict";

  const APP_VERSION = "v1.2.3";
  const API_VERSION = "TANKOWANIE_API_V1";
  const PREFIX = "tankowanie_v1";
  const KEYS = {
    settings: `${PREFIX}_settings`,
    draft: `${PREFIX}_draft`,
    queue: `${PREFIX}_queue`,
    hints: `${PREFIX}_hints`,
    results: `${PREFIX}_results`,
    deviceId: `${PREFIX}_device_id`
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function createId(prefix) {
    const cryptoObj = window.crypto || {};
    if (typeof cryptoObj.randomUUID === "function") {
      return `${prefix}_${cryptoObj.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function getDeviceId() {
    let id = localStorage.getItem(KEYS.deviceId);
    if (!id) {
      id = createId("device");
      localStorage.setItem(KEYS.deviceId, id);
    }
    return id;
  }

  function getSettings() {
    return Object.assign({ endpointUrl: "", pin: "" }, loadJSON(KEYS.settings, {}));
  }

  function saveSettings(settings) {
    saveJSON(KEYS.settings, {
      endpointUrl: String(settings.endpointUrl || "").trim(),
      pin: String(settings.pin || "").trim()
    });
  }

  function getDraft() {
    return Object.assign({
      fuel: "LPG",
      odometer: null,
      pumpPrice: null,
      discountPerLiter: null,
      discountPerLiterEdited: false,
      liters: "",
      date: ""
    }, loadJSON(KEYS.draft, {}));
  }

  function saveDraft(draft) {
    saveJSON(KEYS.draft, draft);
  }

  function getQueue() {
    const queue = loadJSON(KEYS.queue, []);
    return Array.isArray(queue) ? queue : [];
  }

  function saveQueue(queue) {
    saveJSON(KEYS.queue, Array.isArray(queue) ? queue : []);
  }

  function getHints() {
    return Object.assign({
      discountPerLiter: 0.21,
      latestOdometer: null,
      fuels: {
        LPG: { suggestedPumpPrice: null, lastPaidPrice: null, lastOdometer: null },
        E98: { suggestedPumpPrice: null, lastPaidPrice: null, lastOdometer: null }
      }
    }, loadJSON(KEYS.hints, {}));
  }

  function saveHints(hints) {
    saveJSON(KEYS.hints, hints);
  }

  function getResults() {
    return Object.assign({
      monthlyLabel: "",
      monthlyAverage: "",
      lastLpgResult: "",
      lastReadAt: "",
      lastSyncAt: "",
      sheetTitle: ""
    }, loadJSON(KEYS.results, {}));
  }

  function saveResults(results) {
    saveJSON(KEYS.results, results);
  }

  window.TankowanieStorage = {
    APP_VERSION,
    API_VERSION,
    createId,
    getDeviceId,
    getSettings,
    saveSettings,
    getDraft,
    saveDraft,
    getQueue,
    saveQueue,
    getHints,
    saveHints,
    getResults,
    saveResults
  };
})();
