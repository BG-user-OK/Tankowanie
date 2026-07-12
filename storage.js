(function () {
  "use strict";

  const APP_VERSION = "v3.1.0";
  const API_VERSION = "TANKOWANIE_API_V4";
  const PREFIX = "tankowanie_v1";
  const PROFILE_BG = "BG";
  const PROFILE_HANIA = "HANIA_CLIO3";
  const PROFILE_CLIO5 = "CLIO5_IWONA";
  const PROFILE_IDS = [PROFILE_BG, PROFILE_HANIA, PROFILE_CLIO5];

  const GLOBAL_KEYS = {
    settings: `${PREFIX}_settings`,
    selectedUser: `${PREFIX}_selected_user`,
    selectedVehicle: `${PREFIX}_selected_vehicle`,
    selectedProfile: `${PREFIX}_selected_profile`,
    deviceId: `${PREFIX}_device_id`
  };

  const PROFILE_KEYS = {
    draft: "draft",
    queue: "queue",
    receiptScans: "receipt_scans",
    pendingScan: "pending_scan",
    lastSummary: "last_summary",
    recentRefuel: "recent_refuel",
    entryUndoSnapshot: "entry_undo_snapshot",
    hints: "hints",
    results: "results"
  };

  const LEGACY_KEYS = {
    draft: `${PREFIX}_draft`,
    queue: `${PREFIX}_queue`,
    receiptScans: `${PREFIX}_receipt_scans`,
    pendingScan: `${PREFIX}_pending_scan`,
    lastSummary: `${PREFIX}_last_summary`,
    recentRefuel: `${PREFIX}_recent_refuel`,
    entryUndoSnapshot: `${PREFIX}_entry_undo_snapshot`,
    hints: `${PREFIX}_hints`,
    results: `${PREFIX}_results`
  };

  function normalizeProfileId(profileId) {
    const raw = String(profileId || "").trim().toUpperCase();
    if (raw === PROFILE_HANIA || raw === "HANIA" || raw === "CLIO3" || raw === "HANIA_CLIO3") {
      return PROFILE_HANIA;
    }
    if (raw === PROFILE_CLIO5 || raw === "CLIO5" || raw === "CLIO5-IWONA" || raw === "IWONA") {
      return PROFILE_CLIO5;
    }
    return PROFILE_BG;
  }

  function normalizeUserId(userId) {
    const raw = String(userId || "").trim().toUpperCase();
    if (raw === "HANIA" || raw === "MICHAŁ" || raw === "MICHAL" || raw === "MAJA") return raw === "MICHAL" ? "MICHAŁ" : raw;
    if (raw === "IWONA" || raw === "GOSIA" || raw === "GRZESIU") return raw;
    return "BG";
  }

  function vehiclesForUser(userId) {
    const user = normalizeUserId(userId);
    if (user === "HANIA") return [PROFILE_HANIA, PROFILE_CLIO5];
    if (user === "IWONA") return [PROFILE_CLIO5];
    if (user === "MICHAŁ" || user === "MAJA") return [PROFILE_HANIA];
    if (user === "BG") return PROFILE_IDS.slice();
    return [];
  }

  function normalizeVehicleForUser(vehicleId, userId) {
    const allowed = vehiclesForUser(userId);
    const vehicle = normalizeProfileId(vehicleId);
    if (allowed.indexOf(vehicle) !== -1) return vehicle;
    return allowed[0] || PROFILE_BG;
  }

  function activeFuelForProfile(profileId) {
    const profile = normalizeProfileId(profileId);
    return profile === PROFILE_HANIA ? "E95" : "LPG";
  }

  function fuelsForProfile(profileId) {
    const profile = normalizeProfileId(profileId);
    if (profile === PROFILE_HANIA) return ["E95"];
    if (profile === PROFILE_CLIO5) return ["LPG", "E95"];
    return ["LPG", "E98"];
  }

  function normalizeFuelForProfile(fuel, profileId) {
    const normalized = String(fuel || "").trim().toUpperCase();
    const fuels = fuelsForProfile(profileId);
    return fuels.indexOf(normalized) !== -1 ? normalized : activeFuelForProfile(profileId);
  }

  function profilePrefix(profileId) {
    return `${PREFIX}_profile_${normalizeProfileId(profileId)}`;
  }

  function profileKey(name, profileId) {
    return `${profilePrefix(profileId || activeProfileId)}_${PROFILE_KEYS[name]}`;
  }

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

  function migrateLegacyBg() {
    Object.keys(LEGACY_KEYS).forEach(function (name) {
      const targetKey = profileKey(name, PROFILE_BG);
      if (localStorage.getItem(targetKey) !== null) return;
      const legacyValue = localStorage.getItem(LEGACY_KEYS[name]);
      if (legacyValue !== null) localStorage.setItem(targetKey, legacyValue);
    });
  }

  let activeUserId = normalizeUserId(localStorage.getItem(GLOBAL_KEYS.selectedUser) || "");
  let activeProfileId = normalizeVehicleForUser(
    localStorage.getItem(GLOBAL_KEYS.selectedVehicle) || localStorage.getItem(GLOBAL_KEYS.selectedProfile) || PROFILE_BG,
    activeUserId
  );
  localStorage.setItem(GLOBAL_KEYS.selectedUser, activeUserId);
  localStorage.setItem(GLOBAL_KEYS.selectedVehicle, activeProfileId);
  localStorage.setItem(GLOBAL_KEYS.selectedProfile, activeProfileId);
  migrateLegacyBg();

  function setActiveUser(userId) {
    activeUserId = normalizeUserId(userId);
    activeProfileId = normalizeVehicleForUser(activeProfileId, activeUserId);
    localStorage.setItem(GLOBAL_KEYS.selectedUser, activeUserId);
    localStorage.setItem(GLOBAL_KEYS.selectedVehicle, activeProfileId);
    localStorage.setItem(GLOBAL_KEYS.selectedProfile, activeProfileId);
    return activeUserId;
  }

  function getActiveUser() {
    return activeUserId;
  }

  function getVehiclesForUser(userId) {
    return vehiclesForUser(userId || activeUserId);
  }

  function setActiveProfile(profileId) {
    activeProfileId = normalizeVehicleForUser(profileId, activeUserId);
    localStorage.setItem(GLOBAL_KEYS.selectedVehicle, activeProfileId);
    localStorage.setItem(GLOBAL_KEYS.selectedProfile, activeProfileId);
    if (activeProfileId === PROFILE_BG) migrateLegacyBg();
    return activeProfileId;
  }

  function getActiveProfile() {
    return activeProfileId;
  }

  function getProfiles() {
    return PROFILE_IDS.slice();
  }

  function createId(prefix) {
    const cryptoObj = window.crypto || {};
    if (typeof cryptoObj.randomUUID === "function") {
      return `${prefix}_${cryptoObj.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function getDeviceId() {
    let id = localStorage.getItem(GLOBAL_KEYS.deviceId);
    if (!id) {
      id = createId("device");
      localStorage.setItem(GLOBAL_KEYS.deviceId, id);
    }
    return id;
  }

  function getSettings() {
    return Object.assign({ endpointUrl: "", pin: "" }, loadJSON(GLOBAL_KEYS.settings, {}));
  }

  function saveSettings(settings) {
    saveJSON(GLOBAL_KEYS.settings, {
      endpointUrl: String(settings.endpointUrl || "").trim(),
      pin: String(settings.pin || "").trim()
    });
  }

  function getDraft() {
    const profileId = activeProfileId;
    const draft = Object.assign({
      fuel: activeFuelForProfile(profileId),
      odometer: null,
      pumpPrice: null,
      discountPerLiter: null,
      discountPerLiterEdited: false,
      liters: "",
      date: ""
    }, loadJSON(profileKey("draft", profileId), {}));
    draft.fuel = normalizeFuelForProfile(draft.fuel, profileId);
    return draft;
  }

  function saveDraft(draft) {
    const nextDraft = Object.assign({}, draft || {});
    nextDraft.fuel = normalizeFuelForProfile(nextDraft.fuel, activeProfileId);
    saveJSON(profileKey("draft"), nextDraft);
  }

  function getQueue() {
    const queue = loadJSON(profileKey("queue"), []);
    return Array.isArray(queue) ? queue : [];
  }

  function saveQueue(queue) {
    saveJSON(profileKey("queue"), Array.isArray(queue) ? queue : []);
  }

  function getReceiptScans() {
    const scans = loadJSON(profileKey("receiptScans"), []);
    return Array.isArray(scans) ? scans : [];
  }

  function saveReceiptScans(scans) {
    saveJSON(profileKey("receiptScans"), Array.isArray(scans) ? scans : []);
  }

  function getPendingScan() {
    return loadJSON(profileKey("pendingScan"), null);
  }

  function savePendingScan(scan) {
    saveJSON(profileKey("pendingScan"), scan && typeof scan === "object" ? scan : null);
  }

  function getLastSummary() {
    return Object.assign({ active: false }, loadJSON(profileKey("lastSummary"), {}));
  }

  function saveLastSummary(summary) {
    saveJSON(profileKey("lastSummary"), summary && typeof summary === "object" ? summary : { active: false });
  }

  function getRecentRefuel() {
    return loadJSON(profileKey("recentRefuel"), null);
  }

  function saveRecentRefuel(refuel) {
    saveJSON(profileKey("recentRefuel"), refuel && typeof refuel === "object" ? refuel : null);
  }

  function getEntryUndoSnapshot() {
    return loadJSON(profileKey("entryUndoSnapshot"), null);
  }

  function saveEntryUndoSnapshot(snapshot) {
    saveJSON(profileKey("entryUndoSnapshot"), snapshot && typeof snapshot === "object" ? snapshot : null);
  }

  function emptyFuelHint() {
    return {
      suggestedPumpPrice: null,
      lastPaidPrice: null,
      lastOdometer: null,
      lastLiters: null,
      lastDate: "",
      lastDateIso: "",
      previousOdometer: null,
      lastDistance: null,
      lastConsumption: null,
      history: []
    };
  }

  function defaultHints() {
    if (activeProfileId === PROFILE_CLIO5) {
      return {
        discountPerLiter: 0.21,
        latestOdometer: 47670,
        fuels: {
          LPG: Object.assign(emptyFuelHint(), {
            suggestedPumpPrice: 2.89,
            lastOdometer: 47670,
            history: [{
              odometer: 47670,
              source: "initial"
            }]
          }),
          E95: Object.assign(emptyFuelHint(), {
            lastOdometer: 47670,
            history: [{
              odometer: 47670,
              source: "initial"
            }]
          })
        }
      };
    }
    if (activeProfileId === PROFILE_HANIA) {
      return {
        discountPerLiter: 0.21,
        latestOdometer: 162508,
        fuels: {
          E95: Object.assign(emptyFuelHint(), {
            suggestedPumpPrice: 5.99,
            lastPaidPrice: 5.78,
            lastOdometer: 162508,
            lastDate: "2026-06-19",
            lastDateIso: "2026-06-19",
            lastConsumption: 5.98,
            history: [{
              dateIso: "2026-06-19",
              date: "2026-06-19",
              odometer: 162508,
              paidPrice: 5.78,
              consumption: 5.98,
              source: "initial"
            }]
          })
        }
      };
    }
    return {
      discountPerLiter: 0.21,
      latestOdometer: null,
      fuels: {
        LPG: emptyFuelHint(),
        E98: emptyFuelHint()
      }
    };
  }

  function getHints() {
    return Object.assign(defaultHints(), loadJSON(profileKey("hints"), {}));
  }

  function saveHints(hints) {
    saveJSON(profileKey("hints"), hints);
  }

  function defaultResults() {
    return {
      monthlyLabel: "",
      monthlyAverage: activeProfileId === PROFILE_HANIA || activeProfileId === PROFILE_CLIO5 ? "0" : "",
      lastLpgResult: "",
      lastReadAt: "",
      lastSyncAt: "",
      sheetTitle: ""
    };
  }

  function getResults() {
    return Object.assign(defaultResults(), loadJSON(profileKey("results"), {}));
  }

  function saveResults(results) {
    saveJSON(profileKey("results"), results);
  }

  window.TankowanieStorage = {
    APP_VERSION,
    API_VERSION,
    createId,
    getDeviceId,
    getSettings,
    saveSettings,
    getActiveUser,
    setActiveUser,
    getVehiclesForUser,
    getActiveProfile,
    setActiveProfile,
    getProfiles,
    getDraft,
    saveDraft,
    getQueue,
    saveQueue,
    getReceiptScans,
    saveReceiptScans,
    getPendingScan,
    savePendingScan,
    getLastSummary,
    saveLastSummary,
    getRecentRefuel,
    saveRecentRefuel,
    getEntryUndoSnapshot,
    saveEntryUndoSnapshot,
    getHints,
    saveHints,
    getResults,
    saveResults
  };
})();
