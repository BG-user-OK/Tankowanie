(function () {
  "use strict";

  const APP_VERSION = "v4.5.1";
  const API_VERSION = "TANKOWANIE_API_V8";
  const PREFIX = "tankowanie_v2";
  const LEGACY_PREFIX = "tankowanie_v1";
  const DEVICE_USER_KEY = "tankowanie__deviceUserId";
  const USERS = [
    { id: "BG", label: "BG", active: true, color: "#2563eb" },
    { id: "IWONA", label: "Iwona", active: true, color: "#7c3aed" },
    { id: "HANIA", label: "Hania", active: true, color: "#db2777" },
    { id: "MICHAL", label: "Micha\u0142", active: true, color: "#0891b2" },
    { id: "MAJA", label: "Maja", active: true, color: "#ea580c" },
    { id: "GOSIA", label: "Gosia", active: true, color: "#16a34a" },
    { id: "GRZESIU", label: "Grzesiu", active: true, color: "#ca8a04" }
  ];

  const CARS = {
    BG: {
      carId: "BG",
      profileId: "BG",
      fuels: ["LPG", "E98"],
      defaultFuel: "LPG",
      allowedUsers: ["BG"]
    },
    CLIO3: {
      carId: "CLIO3",
      profileId: "HANIA_CLIO3",
      fuels: ["E95"],
      defaultFuel: "E95",
      allowedUsers: ["BG", "HANIA", "IWONA", "MICHAL", "MAJA"]
    },
    CLIO5: {
      carId: "CLIO5",
      profileId: "CLIO5_IWONA",
      fuels: ["LPG", "E95"],
      defaultFuel: "LPG",
      allowedUsers: ["BG", "IWONA", "HANIA", "MICHAL", "MAJA"]
    },
    E_LS995_VW_CADDY: {
      carId: "E_LS995_VW_CADDY",
      profileId: "E_LS995_VW_CADDY",
      fuels: ["ON"],
      defaultFuel: "ON",
      allowedUsers: ["BG", "GOSIA", "GRZESIU"]
    },
    OK2071C_AUDI: {
      carId: "OK2071C_AUDI",
      profileId: "OK2071C_AUDI",
      fuels: ["ON"],
      defaultFuel: "ON",
      allowedUsers: ["BG", "GOSIA", "GRZESIU"]
    }
  };
  const CAR_IDS = Object.keys(CARS);

  const DEVICE_KEYS = {
    settings: `${PREFIX}__device__settings`,
    id: `${PREFIX}__device__id`,
    activeUser: `${PREFIX}__device__activeUser`,
    migration: `${PREFIX}__migration__v1`,
    quarantine: `${PREFIX}__migration__quarantine`
  };

  const LEGACY_SUFFIXES = [
    "entry_undo_snapshot",
    "receipt_scans",
    "pending_scan",
    "last_summary",
    "recent_refuel",
    "results",
    "hints",
    "queue",
    "draft"
  ];

  function canonicalUserId(userId) {
    const raw = String(userId || "")
      .trim()
      .toUpperCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (USERS.some(function (user) { return user.id === raw; })) {
      return raw;
    }
    return "";
  }

  function normalizeUserId(userId) {
    return canonicalUserId(userId) || "BG";
  }

  function normalizeCarId(value) {
    const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "_");
    if (!raw || raw === "BG") return "BG";
    if (raw === "CLIO3" || raw === "HANIA" || raw === "HANIA_CLIO3") return "CLIO3";
    if (raw === "CLIO5" || raw === "IWONA" || raw === "CLIO5_IWONA" || raw === "CLIO5-IWONA") return "CLIO5";
    if (
      raw === "E_LS995_VW_CADDY"
      || raw === "E-LS995__VW_CADDY"
      || raw === "E-LS995_VW_CADDY"
      || raw === "VW_CADDY"
      || raw === "CADDY"
    ) return "E_LS995_VW_CADDY";
    if (raw === "OK2071C_AUDI" || raw === "OK2071C__AUDI" || raw === "AUDI") return "OK2071C_AUDI";
    return "";
  }

  function carDefinition(carId) {
    return CARS[normalizeCarId(carId)] || CARS.BG;
  }

  function profileIdForCar(carId) {
    return carDefinition(carId).profileId;
  }

  function vehiclesForUser(userId) {
    const user = canonicalUserId(userId);
    return CAR_IDS.filter(function (carId) {
      return CARS[carId].allowedUsers.indexOf(user) !== -1;
    });
  }

  function normalizeCarForUser(carId, userId) {
    const allowed = vehiclesForUser(userId);
    const normalized = normalizeCarId(carId);
    return allowed.indexOf(normalized) !== -1 ? normalized : (allowed[0] || "");
  }

  function normalizeFuel(fuelId, carId) {
    const car = carDefinition(carId);
    const normalized = String(fuelId || "").trim().toUpperCase();
    return car.fuels.indexOf(normalized) !== -1 ? normalized : car.defaultFuel;
  }

  function userLastCarKey(userId) {
    return `${PREFIX}__user__${normalizeUserId(userId)}__lastCar`;
  }

  function workflowKey(carId) {
    return `${PREFIX}__car__${normalizeCarId(carId) || "BG"}__workflow`;
  }

  function receiptInboxKey(carId) {
    return `${PREFIX}__car__${normalizeCarId(carId) || "BG"}__receiptInbox`;
  }

  function fuelKey(name, carId, fuelId) {
    const normalizedCar = normalizeCarId(carId) || "BG";
    const normalizedFuel = normalizeFuel(fuelId, normalizedCar);
    return `${PREFIX}__car__${normalizedCar}__fuel__${normalizedFuel}__${name}`;
  }

  function parseJSON(raw, fallback) {
    try {
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function loadJSON(key, fallback) {
    return parseJSON(localStorage.getItem(key), fallback);
  }

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function createId(prefix) {
    const cryptoObj = window.crypto || {};
    if (typeof cryptoObj.randomUUID === "function") return `${prefix}_${cryptoObj.randomUUID()}`;
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function hasDraftInput(draft) {
    if (!draft || typeof draft !== "object") return false;
    return !!draft.odometer || !!draft.pumpPrice || !!draft.pumpTotal || !!Number(String(draft.liters || "").replace(",", "."));
  }

  function legacyScope(key, suffix) {
    const ending = `_${suffix}`;
    if (!key.endsWith(ending)) return null;
    const base = key.slice(0, -ending.length);
    if (base === LEGACY_PREFIX) return { carId: "", userId: "", kind: "global" };
    const profilePrefix = `${LEGACY_PREFIX}_profile_`;
    if (base.indexOf(profilePrefix) === 0) {
      return { carId: normalizeCarId(base.slice(profilePrefix.length)), userId: "", kind: "profile" };
    }
    const userPrefix = `${LEGACY_PREFIX}_user_`;
    if (base.indexOf(userPrefix) === 0) {
      const rest = base.slice(userPrefix.length);
      const marker = "_profile_";
      const markerIndex = rest.indexOf(marker);
      if (markerIndex > 0) {
        return {
          userId: normalizeUserId(rest.slice(0, markerIndex)),
          carId: normalizeCarId(rest.slice(markerIndex + marker.length)),
          kind: "userProfile"
        };
      }
    }
    return null;
  }

  function diagnosticRecord(sourceKey, type, reason, record) {
    const source = record && typeof record === "object" ? record : {};
    return {
      sourceKey,
      type,
      reason,
      entryId: String(source.entryId || ""),
      carId: normalizeCarId(source.carId || source.vehicleId || source.profileId) || "",
      fuelId: String(source.fuelId || source.fuel || "").toUpperCase(),
      recordedAt: new Date().toISOString()
    };
  }

  function resolveRecordScope(record, scope) {
    const source = record && typeof record === "object" ? record : {};
    const explicitCar = normalizeCarId(source.carId || source.vehicleId || source.profileId);
    const carId = explicitCar || (scope && scope.carId) || "";
    if (!carId) return { error: "missing-car" };
    if (explicitCar && scope && scope.carId && explicitCar !== scope.carId) return { error: "conflicting-car" };
    const rawFuel = String(source.fuelId || source.fuel || "").trim().toUpperCase();
    const car = carDefinition(carId);
    if (!rawFuel || car.fuels.indexOf(rawFuel) === -1) return { error: "missing-or-invalid-fuel" };
    return { carId, fuelId: rawFuel };
  }

  function migrateLegacyData() {
    if (localStorage.getItem(DEVICE_KEYS.migration)) return;

    const quarantine = [];
    const draftCandidates = {};
    const queueCandidates = {};
    const receiptCandidates = {};
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && key.indexOf(LEGACY_PREFIX) === 0) keys.push(key);
    }

    const oldDeviceId = localStorage.getItem(`${LEGACY_PREFIX}_device_id`);
    if (localStorage.getItem(DEVICE_KEYS.id) === null && oldDeviceId) {
      localStorage.setItem(DEVICE_KEYS.id, oldDeviceId);
    }

    const oldUser = normalizeUserId(localStorage.getItem(`${LEGACY_PREFIX}_selected_user`) || "BG");
    if (localStorage.getItem(DEVICE_KEYS.activeUser) === null) localStorage.setItem(DEVICE_KEYS.activeUser, oldUser);
    const oldCar = normalizeCarForUser(
      localStorage.getItem(`${LEGACY_PREFIX}_selected_vehicle`)
        || localStorage.getItem(`${LEGACY_PREFIX}_selected_profile`)
        || "BG",
      oldUser
    );
    if (localStorage.getItem(userLastCarKey(oldUser)) === null) localStorage.setItem(userLastCarKey(oldUser), oldCar);

    keys.forEach(function (key) {
      const suffix = LEGACY_SUFFIXES.find(function (item) { return key.endsWith(`_${item}`); });
      if (!suffix) return;
      const scope = legacyScope(key, suffix);
      const value = parseJSON(localStorage.getItem(key), null);
      if (!scope || value === null) return;

      if (suffix === "draft" && hasDraftInput(value)) {
        if (!scope.carId) {
          quarantine.push(diagnosticRecord(key, "draft", "missing-car", value));
          return;
        }
        const fuelId = normalizeFuel(value.fuel, scope.carId);
        const candidate = Object.assign({}, value, {
          fuel: fuelId,
          carId: scope.carId,
          profileId: profileIdForCar(scope.carId),
          entryId: String(value.entryId || createId("entry")),
          startedByUserId: String(value.startedByUserId || scope.userId || "")
        });
        const groupKey = `${scope.carId}|${fuelId}`;
        const signature = JSON.stringify({
          odometer: candidate.odometer || null,
          pumpPrice: candidate.pumpPrice || null,
          discountPerLiter: candidate.discountPerLiter || null,
          liters: candidate.liters || "",
          date: candidate.date || "",
          fuel: fuelId
        });
        if (!draftCandidates[groupKey]) draftCandidates[groupKey] = [];
        draftCandidates[groupKey].push({ key, candidate, signature });
        return;
      }

      if (suffix === "queue" && Array.isArray(value)) {
        value.forEach(function (record) {
          const resolved = resolveRecordScope(record, scope);
          if (resolved.error || !record || !record.entryId) {
            quarantine.push(diagnosticRecord(key, "queue", resolved.error || "missing-entryId", record));
            return;
          }
          const normalized = Object.assign({}, record, {
            carId: resolved.carId,
            vehicleId: resolved.carId,
            profileId: profileIdForCar(resolved.carId),
            fuelId: resolved.fuelId,
            fuel: resolved.fuelId
          });
          const id = String(normalized.entryId);
          if (queueCandidates[id] && JSON.stringify(queueCandidates[id].record) !== JSON.stringify(normalized)) {
            quarantine.push(diagnosticRecord(key, "queue", "conflicting-entryId", record));
            return;
          }
          queueCandidates[id] = { key, record: normalized };
        });
        return;
      }

      if (suffix === "pending_scan" || suffix === "receipt_scans") {
        const records = Array.isArray(value) ? value : [value];
        records.forEach(function (record) {
          if (!record || (record.status !== "pending" && record.status !== "ready")) return;
          const resolved = resolveRecordScope(record, scope);
          if (resolved.error || !record.entryId) {
            quarantine.push(diagnosticRecord(key, "receipt", resolved.error || "missing-entryId", record));
            return;
          }
          const normalized = Object.assign({}, record, {
            carId: resolved.carId,
            vehicleId: resolved.carId,
            profileId: profileIdForCar(resolved.carId),
            fuelId: resolved.fuelId,
            fuel: resolved.fuelId
          });
          const groupKey = `${resolved.carId}|${resolved.fuelId}`;
          const previous = receiptCandidates[groupKey];
          const rank = Date.parse(normalized.updatedAt || normalized.createdAt || "") || 0;
          if (!previous || rank >= previous.rank) receiptCandidates[groupKey] = { key, record: normalized, rank };
        });
      }
    });

    Object.keys(draftCandidates).forEach(function (groupKey) {
      const candidates = draftCandidates[groupKey];
      const unique = {};
      candidates.forEach(function (item) { unique[item.signature] = item; });
      const signatures = Object.keys(unique);
      if (signatures.length !== 1) {
        candidates.forEach(function (item) {
          quarantine.push(diagnosticRecord(item.key, "draft", "conflicting-drafts", item.candidate));
        });
        return;
      }
      const selected = unique[signatures[0]].candidate;
      const target = fuelKey("draft", selected.carId, selected.fuel);
      if (localStorage.getItem(target) === null) saveJSON(target, selected);
    });

    const queueGroups = {};
    Object.keys(queueCandidates).forEach(function (entryId) {
      const record = queueCandidates[entryId].record;
      const groupKey = `${record.carId}|${record.fuel}`;
      if (!queueGroups[groupKey]) queueGroups[groupKey] = [];
      queueGroups[groupKey].push(record);
    });
    Object.keys(queueGroups).forEach(function (groupKey) {
      const separator = groupKey.indexOf("|");
      const carId = groupKey.slice(0, separator);
      const fuelId = groupKey.slice(separator + 1);
      const target = fuelKey("offlineQueue", carId, fuelId);
      const existing = loadJSON(target, []);
      const byId = {};
      existing.concat(queueGroups[groupKey]).forEach(function (entry) {
        if (entry && entry.entryId) byId[String(entry.entryId)] = entry;
      });
      saveJSON(target, Object.keys(byId).map(function (id) { return byId[id]; }));
    });

    Object.keys(receiptCandidates).forEach(function (groupKey) {
      const record = receiptCandidates[groupKey].record;
      const target = fuelKey("pendingReceipt", record.carId, record.fuel);
      if (localStorage.getItem(target) === null) saveJSON(target, record);
    });

    saveJSON(DEVICE_KEYS.quarantine, quarantine);
    saveJSON(DEVICE_KEYS.migration, {
      completedAt: new Date().toISOString(),
      quarantined: quarantine.length,
      migratedQueues: Object.keys(queueCandidates).length,
      migratedReceipts: Object.keys(receiptCandidates).length
    });
  }

  ensureIntegrationSettings();
  migrateLegacyData();

  const TEST_CLEANUP_KEY = PREFIX + "__migration__retired_caddy_test_20260716";
  const TEST_CAR = "E_LS995_VW_CADDY";
  let testQueueCleanup = { status: "not-found" };

  function exactTestNumber(value, expected) {
    return (typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)))
      && Number(value) === expected;
  }

  function testEntryValuesMatch(entry) {
    return !!entry && typeof entry === "object"
      && (entry.fuel === "ON" || entry.fuelId === "ON")
      && entry.refuelDate === "2026-07-16"
      && exactTestNumber(entry.odometer, 555221)
      && exactTestNumber(entry.liters, 30)
      && exactTestNumber(entry.discountedPrice, 6.31);
  }

  function isRetiredTestEntry(entry, carId) {
    if (!entry || typeof entry !== "object") return false;
    const cars = [carId, entry.carId, entry.vehicleId, entry.profileId].filter(Boolean);
    if (!cars.some(value => normalizeCarId(value) === TEST_CAR)) return false;
    if (testEntryValuesMatch(entry)) return true;
    const completed = loadJSON(TEST_CLEANUP_KEY, null);
    return !!(completed && completed.entryId && entry.entryId === completed.entryId);
  }

  function cleanupRetiredCaddyTest() {
    const key = fuelKey("offlineQueue", TEST_CAR, "ON");
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) throw new Error("invalid queue");
      const candidates = entries.filter(testEntryValuesMatch);
      if (!candidates.length) return;
      testQueueCleanup = { status: "ambiguous" };
      // Never guess an ID, normalize an inconsistent record, or delete multiple candidates.
      if (candidates.length !== 1) return;
      const entry = candidates[0];
      if (typeof entry.entryId !== "string" || !entry.entryId.trim()) return;
      if ([entry.fuel, entry.fuelId].filter(value => value !== undefined).some(value => value !== "ON")) return;
      if (![entry.carId, entry.vehicleId, entry.profileId].some(Boolean)) return;
      if ([entry.carId, entry.vehicleId, entry.profileId].filter(value => value !== undefined)
        .some(value => normalizeCarId(value) !== TEST_CAR)) return;
      const completed = JSON.parse(localStorage.getItem(TEST_CLEANUP_KEY) || "null");
      if (completed && completed.entryId !== entry.entryId) return;
      let occurrences = 0;
      for (let index = 0; index < localStorage.length; index += 1) {
        const otherKey = localStorage.key(index);
        if (!otherKey || !otherKey.startsWith(PREFIX + "__car__") || !otherKey.endsWith("__offlineQueue")) continue;
        const otherEntries = JSON.parse(localStorage.getItem(otherKey));
        if (!Array.isArray(otherEntries)) return;
        occurrences += otherEntries.filter(item => item && item.entryId === entry.entryId).length;
      }
      if (occurrences !== 1) return;
      const receipt = JSON.parse(localStorage.getItem(fuelKey("pendingReceipt", TEST_CAR, "ON")) || "null");
      if (receipt && receipt.entryId === entry.entryId) return;
      if (localStorage.getItem(PREFIX + "__balance__GOSIA__tx__" + entry.entryId) !== null) return;
      // A single-key update preserves all unrelated queue items and all other storage.
      if (localStorage.getItem(key) !== raw) return;
      localStorage.setItem(key, JSON.stringify(entries.filter(item => item !== entry)));
      testQueueCleanup = { status: "removed", entryId: entry.entryId };
      saveJSON(TEST_CLEANUP_KEY, { entryId: entry.entryId, completedAt: new Date().toISOString() });
    } catch (error) {
      if (testQueueCleanup.status !== "removed") testQueueCleanup = { status: "error" };
    }
  }

  cleanupRetiredCaddyTest();

  // Ownership is explicit and independent of storage-schema and release versions.
  let activeUserId = getDeviceUser() || normalizeUserId(localStorage.getItem(DEVICE_KEYS.activeUser));
  let rememberedCar = localStorage.getItem(userLastCarKey(activeUserId));
  let activeCarId = normalizeCarForUser(rememberedCar, activeUserId);
  let carSelectionRequired = !rememberedCar || !userCanAccessCar(activeUserId, rememberedCar);
  if (getDeviceUser()) localStorage.setItem(DEVICE_KEYS.activeUser, activeUserId);

  function getDeviceUser() {
    return canonicalUserId(localStorage.getItem(DEVICE_USER_KEY));
  }

  function bindDeviceUser(userId) {
    const user = canonicalUserId(userId);
    const owner = getDeviceUser();
    if (!user || (owner && owner !== user)) throw new Error("Nie można zmienić właściciela tej instalacji.");
    if (!owner) {
      localStorage.setItem(DEVICE_USER_KEY, user);
      carSelectionRequired = true;
    }
    return user;
  }

  function canSelectUser(userId) {
    const owner = getDeviceUser();
    const user = canonicalUserId(userId);
    return !!user && (!owner || owner === "BG" || owner === user);
  }

  function userCanAccessCar(userId, carId) {
    if (!String(carId || "").trim()) return false;
    const car = normalizeCarId(carId);
    return !!car && vehiclesForUser(userId).indexOf(car) !== -1;
  }

  function canAccessCar(userId, carId) {
    return !!getDeviceUser() && canSelectUser(userId) && userCanAccessCar(userId, carId);
  }

  function hasValidContext() {
    return !carSelectionRequired && canAccessCar(activeUserId, activeCarId);
  }

  function setActiveUser(userId) {
    const user = canonicalUserId(userId);
    if (!getDeviceUser() || !canSelectUser(user)) throw new Error("Ten telefon nie może wybrać tego użytkownika.");
    activeUserId = user;
    const remembered = localStorage.getItem(userLastCarKey(activeUserId));
    activeCarId = normalizeCarForUser(remembered, activeUserId);
    carSelectionRequired = !remembered || !userCanAccessCar(activeUserId, remembered);
    localStorage.setItem(DEVICE_KEYS.activeUser, activeUserId);
    return activeUserId;
  }

  function getActiveUser() {
    return activeUserId;
  }

  function getVehiclesForUser(userId) {
    return vehiclesForUser(userId || activeUserId);
  }

  function setActiveCar(carId) {
    if (!canAccessCar(activeUserId, carId)) throw new Error("Ten użytkownik nie ma dostępu do tego auta.");
    activeCarId = normalizeCarId(carId);
    localStorage.setItem(userLastCarKey(activeUserId), activeCarId);
    carSelectionRequired = false;
    return activeCarId;
  }

  function getActiveCar() {
    return activeCarId;
  }

  function getProfiles() {
    return CAR_IDS.slice();
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEYS.id);
    if (!id) {
      id = createId("device");
      localStorage.setItem(DEVICE_KEYS.id, id);
    }
    return id;
  }

  function settingsRecord(key) {
    const record = loadJSON(key, {});
    return record && typeof record === "object" && !Array.isArray(record) ? record : {};
  }

  function settingsValue(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function clearedSettingsFields(record) {
    return Array.isArray(record.clearedFields)
      ? record.clearedFields.filter(function (field) { return field === "endpointUrl" || field === "pin"; })
      : [];
  }

  function ensureIntegrationSettings() {
    const record = settingsRecord(DEVICE_KEYS.settings);
    const legacy = settingsRecord(`${LEGACY_PREFIX}_settings`);
    const cleared = clearedSettingsFields(record);
    const recovered = Object.assign({}, record);
    let changed = false;
    ["endpointUrl", "pin"].forEach(function (field) {
      if (settingsValue(record[field]) || cleared.indexOf(field) !== -1) return;
      const value = settingsValue(legacy[field]);
      if (!value) return;
      if (field === "endpointUrl") {
        try {
          const url = new URL(value);
          if (url.protocol !== "https:" && url.protocol !== "http:") return;
        } catch (error) { return; }
      }
      recovered[field] = value;
      changed = true;
    });
    if (changed) {
      // A full photo store must not prevent reading the still-existing legacy configuration.
      try { saveJSON(DEVICE_KEYS.settings, recovered); } catch (error) {}
    }
    return { endpointUrl: settingsValue(recovered.endpointUrl), pin: settingsValue(recovered.pin) };
  }

  function getSettings() {
    return ensureIntegrationSettings();
  }

  function saveSettings(settings, options) {
    const current = ensureIntegrationSettings();
    const record = settingsRecord(DEVICE_KEYS.settings);
    const next = Object.assign({}, record);
    const explicit = options && Array.isArray(options.explicitFields) ? options.explicitFields : [];
    const cleared = new Set(clearedSettingsFields(record));
    ["endpointUrl", "pin"].forEach(function (field) {
      const value = settingsValue(settings && settings[field]);
      if (explicit.indexOf(field) !== -1) {
        next[field] = value;
        if (value) cleared.delete(field);
        else cleared.add(field);
      } else if (!current[field] && value && !cleared.has(field)) {
        next[field] = value;
      }
    });
    if (cleared.size) next.clearedFields = Array.from(cleared);
    else delete next.clearedFields;
    if (JSON.stringify(next) !== JSON.stringify(record)) saveJSON(DEVICE_KEYS.settings, next);
    return getSettings();
  }

  function getWorkflow(carId) {
    const car = carDefinition(carId || activeCarId);
    const stored = loadJSON(workflowKey(car.carId), {});
    return {
      activeFuel: normalizeFuel(stored.activeFuel, car.carId),
      recentRefuel: stored.recentRefuel && typeof stored.recentRefuel === "object" ? stored.recentRefuel : null,
      multiFuelSession: stored.multiFuelSession && typeof stored.multiFuelSession === "object"
        ? stored.multiFuelSession : null
    };
  }

  function saveWorkflow(workflow, carId) {
    const car = carDefinition(carId || activeCarId);
    saveJSON(workflowKey(car.carId), {
      activeFuel: normalizeFuel(workflow && workflow.activeFuel, car.carId),
      recentRefuel: workflow && workflow.recentRefuel && typeof workflow.recentRefuel === "object"
        ? workflow.recentRefuel
        : null,
      multiFuelSession: workflow && workflow.multiFuelSession && typeof workflow.multiFuelSession === "object"
        ? workflow.multiFuelSession : null
    });
  }

  function getActiveFuel(carId) {
    return getWorkflow(carId).activeFuel;
  }

  function setActiveFuel(fuelId, carId) {
    const car = carDefinition(carId || activeCarId);
    const workflow = getWorkflow(car.carId);
    workflow.activeFuel = normalizeFuel(fuelId, car.carId);
    saveWorkflow(workflow, car.carId);
    return workflow.activeFuel;
  }

  function defaultDraft(carId, fuelId) {
    const car = carDefinition(carId);
    return {
      entryId: "",
      startedByUserId: "",
      carId: car.carId,
      profileId: car.profileId,
      fuel: normalizeFuel(fuelId, car.carId),
      odometer: null,
      pumpPrice: null,
      pumpTotal: null,
      calculationSource: "",
      discountPerLiter: null,
      discountPerLiterEdited: false,
      liters: "",
      date: "",
      activeEdit: "odometer",
      userAdjustedDate: false
    };
  }

  function getDraft(fuelId, carId) {
    const car = carDefinition(carId || activeCarId);
    const fuel = normalizeFuel(fuelId || getActiveFuel(car.carId), car.carId);
    const draft = Object.assign(defaultDraft(car.carId, fuel), loadJSON(fuelKey("draft", car.carId, fuel), {}));
    draft.carId = car.carId;
    draft.profileId = car.profileId;
    draft.fuel = fuel;
    return draft;
  }

  function saveDraft(draft, carId) {
    const car = carDefinition(carId || draft && draft.carId || activeCarId);
    const fuel = normalizeFuel(draft && draft.fuel, car.carId);
    const value = Object.assign(defaultDraft(car.carId, fuel), draft || {}, {
      carId: car.carId,
      profileId: car.profileId,
      fuel
    });
    if (hasDraftInput(value)) {
      if (!value.entryId) value.entryId = createId("entry");
      if (!value.startedByUserId) value.startedByUserId = activeUserId;
    }
    setActiveFuel(fuel, car.carId);
    saveJSON(fuelKey("draft", car.carId, fuel), value);
    return value;
  }

  function getQueue(carId) {
    const car = carDefinition(carId || activeCarId);
    const queue = [];
    car.fuels.forEach(function (fuel) {
      const entries = loadJSON(fuelKey("offlineQueue", car.carId, fuel), []);
      if (Array.isArray(entries)) queue.push.apply(queue, entries);
    });
    return queue.sort(function (a, b) {
      return String(a.createdAt || "").localeCompare(String(b.createdAt || ""));
    });
  }

  function saveQueue(queue, carId) {
    const car = carDefinition(carId || activeCarId);
    const groups = {};
    car.fuels.forEach(function (fuel) { groups[fuel] = []; });
    (Array.isArray(queue) ? queue : []).forEach(function (entry) {
      if (!entry || !entry.entryId) return;
      const entryCar = normalizeCarId(entry.carId || entry.vehicleId || entry.profileId) || car.carId;
      if (entryCar !== car.carId) return;
      const fuel = String(entry.fuelId || entry.fuel || "").toUpperCase();
      if (car.fuels.indexOf(fuel) === -1) return;
      groups[fuel].push(Object.assign({}, entry, {
        carId: car.carId,
        vehicleId: car.carId,
        profileId: car.profileId,
        fuelId: fuel,
        fuel
      }));
    });
    car.fuels.forEach(function (fuel) {
      saveJSON(fuelKey("offlineQueue", car.carId, fuel), groups[fuel]);
    });
  }

  function receiptRank(record) {
    return Date.parse(record && (record.updatedAt || record.createdAt) || "") || 0;
  }

  function getReceiptScans(carId) {
    const car = carDefinition(carId || activeCarId);
    const inbox = loadJSON(receiptInboxKey(car.carId), []);
    const records = Array.isArray(inbox) ? inbox.slice() : [];
    car.fuels.forEach(function (fuel) {
      const legacy = loadJSON(fuelKey("pendingReceipt", car.carId, fuel), null);
      if (legacy && !records.some(function (record) { return record.entryId === legacy.entryId; })) {
        records.push(legacy);
      }
    });
    return records.filter(function (record) {
      return record && (record.status === "pending" || record.status === "ready");
    }).sort(function (a, b) { return receiptRank(b) - receiptRank(a); });
  }

  function saveReceiptScans(scans) {
    (Array.isArray(scans) ? scans : []).forEach(savePendingScan);
  }

  function getPendingScan(carId) {
    return getReceiptScans(carId)[0] || null;
  }

  function savePendingScan(scan) {
    if (!scan || typeof scan !== "object") return null;
    const carId = normalizeCarId(scan.carId || scan.vehicleId || scan.profileId) || activeCarId;
    const car = carDefinition(carId);
    const fuel = normalizeFuel(scan.fuelId || scan.fuel, car.carId);
    const value = Object.assign({}, scan, {
      carId: car.carId,
      vehicleId: car.carId,
      profileId: car.profileId,
      fuelId: fuel,
      fuel
    });
    const inbox = loadJSON(receiptInboxKey(car.carId), []);
    const records = Array.isArray(inbox) ? inbox.slice() : [];
    const index = records.findIndex(function (record) { return record.entryId === value.entryId; });
    if (index === -1) records.push(value);
    else records[index] = value;
    saveJSON(receiptInboxKey(car.carId), records);
    const legacyKey = fuelKey("pendingReceipt", car.carId, fuel);
    const legacy = loadJSON(legacyKey, null);
    if (legacy && legacy.entryId === value.entryId) localStorage.removeItem(legacyKey);
    return value;
  }

  function clearPendingScan(carId, fuelId, entryId) {
    if (!entryId) return false;
    const car = carDefinition(carId || activeCarId);
    const fuel = normalizeFuel(fuelId, car.carId);
    const inbox = loadJSON(receiptInboxKey(car.carId), []);
    if (Array.isArray(inbox)) {
      const remaining = inbox.filter(function (record) {
        return String(record.entryId || "") !== String(entryId);
      });
      if (remaining.length !== inbox.length) saveJSON(receiptInboxKey(car.carId), remaining);
    }
    const key = fuelKey("pendingReceipt", car.carId, fuel);
    const current = loadJSON(key, null);
    if (current && (!entryId || String(current.entryId || "") === String(entryId))) localStorage.removeItem(key);
    return true;
  }

  function getLastSummary(carId) {
    const car = carDefinition(carId || activeCarId);
    const summaries = {};
    car.fuels.forEach(function (fuel) {
      summaries[fuel] = loadJSON(fuelKey("lastSummary", car.carId, fuel), { active: false, fuel });
    });
    return summaries;
  }

  function saveLastSummary(summary, carId) {
    const car = carDefinition(carId || activeCarId);
    const source = summary && typeof summary === "object" ? summary : {};
    car.fuels.forEach(function (fuel) {
      const value = source[fuel] || (source.fuel === fuel ? source : { active: false, fuel });
      saveJSON(fuelKey("lastSummary", car.carId, fuel), value);
    });
  }

  function getRecentRefuel(carId) {
    return getWorkflow(carId).recentRefuel;
  }

  function saveRecentRefuel(refuel, carId) {
    const car = carDefinition(carId || activeCarId);
    const workflow = getWorkflow(car.carId);
    workflow.recentRefuel = refuel && typeof refuel === "object" ? refuel : null;
    saveWorkflow(workflow, car.carId);
  }

  function getMultiFuelSession(carId) {
    return getWorkflow(carId).multiFuelSession;
  }

  function saveMultiFuelSession(session, carId) {
    const car = carDefinition(carId || activeCarId);
    const workflow = getWorkflow(car.carId);
    workflow.multiFuelSession = session && typeof session === "object" ? session : null;
    saveWorkflow(workflow, car.carId);
  }

  function getEntryUndoSnapshot(fuelId, carId) {
    const car = carDefinition(carId || activeCarId);
    const fuel = normalizeFuel(fuelId || getActiveFuel(car.carId), car.carId);
    return loadJSON(fuelKey("undoSnapshot", car.carId, fuel), null);
  }

  function saveEntryUndoSnapshot(snapshot, fuelId, carId) {
    const car = carDefinition(carId || snapshot && snapshot.carId || activeCarId);
    const fuel = normalizeFuel(fuelId || snapshot && (snapshot.fuelId || snapshot.fuel) || getActiveFuel(car.carId), car.carId);
    const key = fuelKey("undoSnapshot", car.carId, fuel);
    if (!snapshot) localStorage.removeItem(key);
    else saveJSON(key, Object.assign({}, snapshot, { carId: car.carId, fuelId: fuel }));
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

  function getHints(carId) {
    const car = carDefinition(carId || activeCarId);
    const hints = { discountPerLiter: 0.21, latestOdometer: null, fuels: {} };
    car.fuels.forEach(function (fuel) {
      const stored = loadJSON(fuelKey("history", car.carId, fuel), {});
      hints.fuels[fuel] = Object.assign(emptyFuelHint(), stored);
      if (stored.discountPerLiter !== undefined && stored.discountPerLiter !== null && stored.discountPerLiter !== "") {
        hints.discountPerLiter = stored.discountPerLiter;
      }
      const odometer = Number(hints.fuels[fuel].lastOdometer || 0);
      if (odometer > Number(hints.latestOdometer || 0)) hints.latestOdometer = odometer;
    });
    return hints;
  }

  function saveHints(hints, carId) {
    const car = carDefinition(carId || activeCarId);
    const source = hints && typeof hints === "object" ? hints : {};
    car.fuels.forEach(function (fuel) {
      const value = Object.assign(emptyFuelHint(), source.fuels && source.fuels[fuel] || {}, {
        discountPerLiter: source.discountPerLiter !== undefined ? source.discountPerLiter : 0.21
      });
      saveJSON(fuelKey("history", car.carId, fuel), value);
    });
  }

  function defaultResults() {
    return {
      monthlyLabel: "",
      monthlyAverage: "",
      lastLpgResult: "",
      lastReadAt: "",
      lastSyncAt: "",
      sheetTitle: ""
    };
  }

  function getResults(fuelId, carId) {
    const car = carDefinition(carId || activeCarId);
    const fuel = normalizeFuel(fuelId || getActiveFuel(car.carId), car.carId);
    return Object.assign(defaultResults(), loadJSON(fuelKey("results", car.carId, fuel), {}));
  }

  function saveResults(results, fuelId, carId) {
    const car = carDefinition(carId || activeCarId);
    const fuel = normalizeFuel(fuelId || getActiveFuel(car.carId), car.carId);
    saveJSON(fuelKey("results", car.carId, fuel), Object.assign(defaultResults(), results || {}));
  }

  function saveSheetConfig(carId, config, requestId) {
    const car = carDefinition(carId);
    const responseCar = normalizeCarId(config && (config.carId || config.vehicleId || config.profileId));
    if (!config || responseCar !== car.carId) throw new Error("Sheet response car does not match request.");
    const incomingFuels = config.fuels && typeof config.fuels === "object" ? config.fuels : {};
    car.fuels.forEach(function (fuel) {
      const incoming = incomingFuels[fuel] && typeof incomingFuels[fuel] === "object" ? incomingFuels[fuel] : {};
      const exactSnapshot = {
        requestId: String(requestId || config.requestId || ""),
        carId: car.carId,
        profileId: car.profileId,
        fuelId: fuel,
        fetchedAt: String(config.readAt || new Date().toISOString()),
        discountPerLiter: config.discountPerLiter !== undefined ? config.discountPerLiter : "",
        fuel: incoming,
        results: {
          monthlyLabel: config.monthlyLabel !== undefined ? config.monthlyLabel : "",
          monthlyAverage: config.monthlyAverage !== undefined ? config.monthlyAverage : "",
          lastLpgResult: config.lastResult || config.lastLpgResult || "",
          sheetTitle: config.sheetTitle || ""
        }
      };
      saveJSON(fuelKey("sheetSnapshot", car.carId, fuel), exactSnapshot);
      saveJSON(fuelKey("history", car.carId, fuel), Object.assign(emptyFuelHint(), incoming, {
        discountPerLiter: exactSnapshot.discountPerLiter
      }));
      const previousResults = getResults(fuel, car.carId);
      saveResults({
        monthlyLabel: exactSnapshot.results.monthlyLabel,
        monthlyAverage: exactSnapshot.results.monthlyAverage,
        lastLpgResult: exactSnapshot.results.lastLpgResult,
        lastReadAt: new Date().toLocaleString("pl-PL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }),
        lastSyncAt: previousResults.lastSyncAt || "",
        sheetTitle: exactSnapshot.results.sheetTitle
      }, fuel, car.carId);
    });
    return true;
  }

  function getSheetSnapshot(fuelId, carId) {
    const car = carDefinition(carId || activeCarId);
    const fuel = normalizeFuel(fuelId || getActiveFuel(car.carId), car.carId);
    return loadJSON(fuelKey("sheetSnapshot", car.carId, fuel), null);
  }

  function getMigrationDiagnostics() {
    return {
      migration: loadJSON(DEVICE_KEYS.migration, null),
      quarantine: loadJSON(DEVICE_KEYS.quarantine, [])
    };
  }

  window.TankowanieStorage = {
    APP_VERSION,
    API_VERSION,
    USERS,
    CARS,
    createId,
    normalizeCarId,
    profileIdForCar,
    getCarDefinition: carDefinition,
    getDeviceId,
    getDeviceUser,
    bindDeviceUser,
    canSelectUser,
    canAccessCar,
    hasValidContext,
    getSettings,
    ensureIntegrationSettings,
    saveSettings,
    getActiveUser,
    setActiveUser,
    getVehiclesForUser,
    getActiveCar,
    setActiveCar,
    getActiveProfile: getActiveCar,
    setActiveProfile: setActiveCar,
    getProfiles,
    getActiveFuel,
    setActiveFuel,
    getDraft,
    saveDraft,
    getQueue,
    saveQueue,
    getReceiptScans,
    saveReceiptScans,
    getPendingScan,
    savePendingScan,
    clearPendingScan,
    getLastSummary,
    saveLastSummary,
    getRecentRefuel,
    saveRecentRefuel,
    getMultiFuelSession,
    saveMultiFuelSession,
    getEntryUndoSnapshot,
    saveEntryUndoSnapshot,
    getHints,
    saveHints,
    getResults,
    saveResults,
    saveSheetConfig,
    getSheetSnapshot,
    getMigrationDiagnostics,
    isRetiredTestEntry,
    getTestQueueCleanup: function () { return Object.assign({}, testQueueCleanup); }
  };
})();
