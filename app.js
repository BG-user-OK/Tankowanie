(function () {
  "use strict";

  const storage = window.TankowanieStorage;
  const keypad = window.TankowanieKeypad;
  const sync = window.TankowanieSync;

  const els = {};
  const FUELS = ["LPG", "E98"];
  const ROMAN_MONTHS = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  let settings = storage.getSettings();
  let draft = storage.getDraft();
  let queue = storage.getQueue();
  let pendingScan = null;
  let lastSummary = normalizeLastSummaries(storage.getLastSummary());
  let hints = normalizeHints(storage.getHints());
  let results = storage.getResults();
  let recentRefuel = normalizeRecentRefuel(storage.getRecentRefuel());
  let entryUndoSnapshot = normalizeEntryUndoSnapshot(storage.getEntryUndoSnapshot());
  const pageSessionId = storage.createId("session");
  const pageStartedAt = Date.now();
  let recentLpgReceiptContext = null;
  let activeEdit = "odometer";
  let keypadReady = false;
  let busyAction = "";
  let userAdjustedDate = false;
  const protectedClickAt = {};
  const RECEIPT_TARGET_BYTES = 520 * 1024;
  const RECEIPT_MAX_EDGE = 1600;
  let receiptPromptEntryId = "";
  let receiptActionTimer = 0;
  let receiptActionPointerActive = false;
  let receiptActionLongDone = false;
  let suppressReceiptActionClickUntil = 0;

  function $(id) {
    return document.getElementById(id);
  }

  function todayIso() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offset * 60000);
    return local.toISOString().slice(0, 10);
  }

  function parseDecimal(value) {
    const normalized = String(value === null || value === undefined ? "" : value).replace(",", ".").trim();
    if (!normalized) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function numberOrNull(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  function money(value) {
    if (!Number.isFinite(Number(value))) return "--";
    return Number(value).toFixed(2).replace(".", ",");
  }

  function signedMoney(value) {
    if (!Number.isFinite(Number(value))) return "--";
    return `-${money(Math.abs(Number(value)))}`;
  }

  function formatConsumption(value) {
    if (!Number.isFinite(Number(value))) return "--";
    return Number(value).toFixed(2).replace(".", ",");
  }

  function formatLiters(value) {
    const liters = parseDecimal(value);
    if (!Number.isFinite(liters) || liters <= 0) return "--";
    return liters.toFixed(2).replace(".", ",");
  }

  function normalizeDateIso(value) {
    const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  }

  function formatShortDate(value) {
    const iso = normalizeDateIso(value);
    if (!iso) return "--";
    const parts = iso.split("-").map(Number);
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "--";
    const day = String(parts[2]).padStart(2, "0");
    const month = ROMAN_MONTHS[parts[1] - 1] || "";
    const year = String(parts[0]).slice(-2);
    return `${day}.${month}'${year}`;
  }

  function isRefuelDraftEmpty() {
    return !draft.odometer && !draft.pumpPrice && !parseDecimal(draft.liters);
  }

  function ensureDefaultDateForEmptyDraft() {
    const today = todayIso();
    if (!draft.date) {
      draft.date = today;
      return true;
    }
    if (isRefuelDraftEmpty() && !userAdjustedDate && draft.date !== today) {
      draft.date = today;
      return true;
    }
    return false;
  }

  function fuelImagePath(fuel) {
    const version = encodeURIComponent(storage.APP_VERSION);
    return fuel === "E98" ? `grafiki/E98.png?v=${version}` : `grafiki/LPG.png?v=${version}`;
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

  function mergeFilled(target, source) {
    const result = Object.assign({}, target || {});
    Object.keys(source || {}).forEach(function (key) {
      const value = source[key];
      if (value !== null && value !== undefined && value !== "") result[key] = value;
    });
    return result;
  }

  function normalizeHistoryEntry(entry) {
    if (!entry || typeof entry !== "object") return null;
    const dateIso = normalizeDateIso(entry.dateIso || entry.refuelDate || entry.date || entry.lastDate);
    const odometer = numberOrNull(entry.odometer || entry.lastOdometer);
    const liters = parseDecimal(entry.liters || entry.lastLiters);
    const paidPrice = parseDecimal(entry.paidPrice || entry.discountedPrice || entry.lastPaidPrice);
    const previousOdometer = numberOrNull(entry.previousOdometer);
    const distance = numberOrNull(entry.distance || entry.lastDistance);
    const consumption = parseDecimal(entry.consumption || entry.lastConsumption);
    if (!dateIso && !odometer && consumption === null) return null;
    return {
      entryId: String(entry.entryId || ""),
      dateIso,
      date: String(entry.date || entry.lastDate || dateIso || ""),
      odometer: odometer || "",
      liters: liters !== null ? Number(liters.toFixed(2)) : "",
      paidPrice: paidPrice !== null ? Number(paidPrice.toFixed(2)) : "",
      previousOdometer: previousOdometer || "",
      distance: distance || "",
      consumption: consumption !== null ? Number(consumption.toFixed(2)) : "",
      source: String(entry.source || "")
    };
  }

  function historyKey(entry) {
    if (entry.entryId) return `id:${entry.entryId}`;
    return `v:${entry.dateIso}|${entry.odometer}|${entry.liters}`;
  }

  function sortHistory(history) {
    return history.sort(function (a, b) {
      if (a.dateIso !== b.dateIso) return a.dateIso < b.dateIso ? 1 : -1;
      return Number(b.odometer || 0) - Number(a.odometer || 0);
    });
  }

  function upsertHistory(history, entries) {
    const next = (Array.isArray(history) ? history : [])
      .map(normalizeHistoryEntry)
      .filter(Boolean);
    const incoming = Array.isArray(entries) ? entries : [entries];
    incoming.forEach(function (entry) {
      const normalized = normalizeHistoryEntry(entry);
      if (!normalized) return;
      const key = historyKey(normalized);
      const index = next.findIndex(function (item) {
        return historyKey(item) === key;
      });
      if (index >= 0) next[index] = mergeFilled(next[index], normalized);
      else next.push(normalized);
    });
    return sortHistory(next).slice(0, 16);
  }

  function normalizeFuelHint(value) {
    const base = Object.assign(emptyFuelHint(), value || {});
    let history = upsertHistory([], Array.isArray(base.history) ? base.history : []);
    history = upsertHistory(history, {
      dateIso: base.lastDateIso || normalizeDateIso(base.lastDate),
      date: base.lastDate,
      odometer: base.lastOdometer,
      liters: base.lastLiters,
      paidPrice: base.lastPaidPrice,
      previousOdometer: base.previousOdometer,
      distance: base.lastDistance,
      consumption: base.lastConsumption,
      source: base.provisional ? "local" : "sheet"
    });
    base.history = history;
    if (!base.lastDateIso && history[0]) base.lastDateIso = history[0].dateIso;
    return base;
  }

  function normalizeHints(value) {
    const base = Object.assign({
      discountPerLiter: 0.21,
      latestOdometer: null,
      fuels: {}
    }, value || {});
    base.fuels = base.fuels || {};
    base.fuels.LPG = normalizeFuelHint(base.fuels.LPG);
    base.fuels.E98 = normalizeFuelHint(base.fuels.E98);
    return base;
  }

  function normalizeLastSummary(value) {
    const source = value && typeof value === "object" ? value : {};
    const fuel = String(source.fuel || "").toUpperCase();
    const pumpPrice = parseDecimal(source.pumpPrice);
    const discountPerLiter = parseDecimal(source.discountPerLiter);
    const discountedPrice = parseDecimal(source.discountedPrice);
    const pumpTotal = parseDecimal(source.pumpTotal);
    const discountTotal = parseDecimal(source.discountTotal);
    const paidTotal = parseDecimal(source.paidTotal);
    return {
      active: source.active === true,
      entryId: String(source.entryId || ""),
      fuel: fuel === "E98" ? "E98" : fuel === "LPG" ? "LPG" : "",
      refuelDate: normalizeDateIso(source.refuelDate) || "",
      odometer: numberOrNull(source.odometer) || "",
      liters: parseDecimal(source.liters) !== null ? Number(parseDecimal(source.liters).toFixed(2)) : "",
      pumpPrice: pumpPrice !== null ? Number(pumpPrice.toFixed(2)) : "",
      discountPerLiter: discountPerLiter !== null ? Number(discountPerLiter.toFixed(2)) : "",
      discountedPrice: discountedPrice !== null ? Number(discountedPrice.toFixed(2)) : "",
      previousOdometer: numberOrNull(source.previousOdometer) || "",
      distance: numberOrNull(source.distance) || "",
      pumpTotal: pumpTotal !== null ? Number(pumpTotal.toFixed(2)) : "",
      discountTotal: discountTotal !== null ? Number(discountTotal.toFixed(2)) : "",
      paidTotal: paidTotal !== null ? Number(paidTotal.toFixed(2)) : "",
      createdAt: String(source.createdAt || "")
    };
  }

  function emptyLastSummary(fuel) {
    return normalizeLastSummary({ fuel, active: false });
  }

  function normalizeLastSummaries(value) {
    const source = value && typeof value === "object" ? value : {};
    const result = {
      LPG: emptyLastSummary("LPG"),
      E98: emptyLastSummary("E98")
    };
    if (source.LPG || source.E98) {
      result.LPG = normalizeLastSummary(Object.assign({ fuel: "LPG" }, source.LPG || {}));
      result.E98 = normalizeLastSummary(Object.assign({ fuel: "E98" }, source.E98 || {}));
      return result;
    }
    const legacy = normalizeLastSummary(source);
    if (legacy.active && (legacy.fuel === "LPG" || legacy.fuel === "E98")) {
      result[legacy.fuel] = legacy;
    }
    return result;
  }

  function normalizeRecentRefuel(value) {
    const source = value && typeof value === "object" ? value : {};
    const fuel = String(source.fuel || "").toUpperCase();
    const savedAt = Number(source.savedAt || 0);
    return {
      fuel: fuel === "E98" ? "E98" : fuel === "LPG" ? "LPG" : "",
      entryId: String(source.entryId || ""),
      odometer: numberOrNull(source.odometer) || "",
      refuelDate: normalizeDateIso(source.refuelDate) || "",
      savedAt: Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0
    };
  }

  function normalizeEntryUndoSnapshot(value) {
    const source = value && typeof value === "object" ? value : {};
    return source.active === true ? source : null;
  }

  function cloneState(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  function retainedSummary() {
    const summary = lastSummary && lastSummary[draft.fuel];
    return summary && summary.active && isRefuelDraftEmpty() ? summary : null;
  }

  function buildLastSummary(entry) {
    const stats = entryConsumption(entry);
    return normalizeLastSummary({
      active: true,
      entryId: entry.entryId,
      fuel: entry.fuel,
      refuelDate: entry.refuelDate,
      odometer: entry.odometer,
      liters: entry.liters,
      pumpPrice: entry.pumpPrice,
      discountPerLiter: entry.discountPerLiter,
      discountedPrice: entry.discountedPrice,
      previousOdometer: stats.previousOdometer,
      distance: stats.distance,
      pumpTotal: entry.liters * entry.pumpPrice,
      discountTotal: entry.liters * entry.discountPerLiter,
      paidTotal: entry.liters * entry.discountedPrice,
      createdAt: new Date().toISOString()
    });
  }

  function setLastSummary(summary) {
    const normalized = normalizeLastSummary(summary);
    const fuel = normalized.fuel === "E98" ? "E98" : "LPG";
    lastSummary = normalizeLastSummaries(lastSummary);
    lastSummary[fuel] = Object.assign(normalized, { fuel });
    storage.saveLastSummary(lastSummary);
  }

  function clearLastSummary() {
    if (!retainedSummary()) return;
    lastSummary = normalizeLastSummaries(lastSummary);
    lastSummary[draft.fuel] = emptyLastSummary(draft.fuel);
    storage.saveLastSummary(lastSummary);
  }

  function hasCurrentEntryInput() {
    return !!draft.odometer || !!draft.pumpPrice || !!parseDecimal(draft.liters);
  }

  function captureEntryUndoSnapshot(reason, force) {
    if (!force && entryUndoSnapshot && entryUndoSnapshot.active && hasCurrentEntryInput()) return;
    entryUndoSnapshot = {
      active: true,
      reason: String(reason || "entry"),
      createdAt: new Date().toISOString(),
      draft: cloneState(draft),
      activeEdit,
      lastSummary: cloneState(lastSummary),
      pendingScan: cloneState(pendingScan),
      hints: cloneState(hints),
      results: cloneState(results),
      recentRefuel: cloneState(recentRefuel),
      recentLpgReceiptContext: cloneState(recentLpgReceiptContext),
      userAdjustedDate
    };
    storage.saveEntryUndoSnapshot(entryUndoSnapshot);
  }

  function clearEntryUndoSnapshot() {
    entryUndoSnapshot = null;
    storage.saveEntryUndoSnapshot(null);
  }

  function restoreEntryUndoSnapshot() {
    if (!entryUndoSnapshot || !entryUndoSnapshot.active) {
      toast("Brak lokalnego stanu do cofnięcia.");
      return;
    }
    draft = Object.assign(storage.getDraft(), cloneState(entryUndoSnapshot.draft) || {});
    lastSummary = normalizeLastSummaries(cloneState(entryUndoSnapshot.lastSummary));
    pendingScan = migratePendingScan(cloneState(entryUndoSnapshot.pendingScan), []);
    hints = normalizeHints(cloneState(entryUndoSnapshot.hints));
    results = Object.assign(storage.getResults(), cloneState(entryUndoSnapshot.results) || {});
    recentRefuel = normalizeRecentRefuel(cloneState(entryUndoSnapshot.recentRefuel));
    recentLpgReceiptContext = cloneState(entryUndoSnapshot.recentLpgReceiptContext) || null;
    userAdjustedDate = !!entryUndoSnapshot.userAdjustedDate;
    const restoredActiveEdit = entryUndoSnapshot.activeEdit || "odometer";
    clearEntryUndoSnapshot();
    saveAll();
    setActiveEdit(restoredActiveEdit);
    toast("Lokalnie cofnięto wpis testowy.");
  }

  function activeFuelHints() {
    return hints.fuels[draft.fuel] || {};
  }

  function playSound(group) {
    const sounds = window.TankowanieSounds;
    if (sounds && typeof sounds.play === "function") sounds.play(group);
  }

  function runProtectedEdit(key, action) {
    const now = Date.now();
    const previous = Number(protectedClickAt[key] || 0);
    if (previous && now - previous <= 1000) {
      protectedClickAt[key] = 0;
      action();
      return;
    }
    protectedClickAt[key] = now;
    window.setTimeout(function () {
      if (protectedClickAt[key] === now) protectedClickAt[key] = 0;
    }, 1000);
  }

  function odometerHintValue() {
    return activeFuelHints().lastOdometer || 0;
  }

  function pumpPriceHintValue() {
    return activeFuelHints().suggestedPumpPrice || null;
  }

  function visiblePumpPrice() {
    const summary = retainedSummary();
    if (summary && summary.pumpPrice) return summary.pumpPrice;
    return draft.pumpPrice || pumpPriceHintValue();
  }

  function effectiveDiscount() {
    const summary = retainedSummary();
    if (summary && summary.discountPerLiter !== "") return Number(summary.discountPerLiter);
    const edited = draft.discountPerLiterEdited ? parseDecimal(draft.discountPerLiter) : null;
    if (edited !== null && Number.isFinite(edited) && edited >= 0) return edited;
    const fromSheet = Number(hints.discountPerLiter);
    return Number.isFinite(fromSheet) && fromSheet >= 0 ? fromSheet : 0.21;
  }

  function paidPrice() {
    const summary = retainedSummary();
    if (summary && summary.discountedPrice) return Number(summary.discountedPrice);
    const price = Number(visiblePumpPrice());
    const discount = effectiveDiscount();
    if (!Number.isFinite(price) || price <= 0) return null;
    return Math.max(0, Number((price - discount).toFixed(2)));
  }

  function totals() {
    const summary = retainedSummary();
    if (summary && summary.pumpTotal !== "" && summary.discountTotal !== "" && summary.paidTotal !== "") {
      return {
        pump: Number(summary.pumpTotal),
        discount: Number(summary.discountTotal),
        paid: Number(summary.paidTotal)
      };
    }
    const liters = parseDecimal(draft.liters);
    const price = Number(visiblePumpPrice());
    const discount = effectiveDiscount();
    const paid = paidPrice();
    if (!Number.isFinite(liters) || liters <= 0 || !Number.isFinite(price) || price <= 0 || paid === null) {
      return null;
    }
    return {
      pump: liters * price,
      discount: liters * discount,
      paid: liters * paid
    };
  }

  function previousOdometerForFuel(fuel) {
    let previous = numberOrNull(hints.fuels[fuel] && hints.fuels[fuel].lastOdometer);
    queue.forEach(function (item) {
      if (item && item.fuel === fuel) {
        const queued = numberOrNull(item.odometer);
        if (queued && (!previous || queued > previous)) previous = queued;
      }
    });
    return previous;
  }

  function distanceSinceLast() {
    const current = numberOrNull(draft.odometer);
    const previous = previousOdometerForFuel(draft.fuel);
    if (!current || !previous || current <= previous) return null;
    return Math.trunc(current - previous);
  }

  function localConsumption() {
    const distance = distanceSinceLast();
    const liters = parseDecimal(draft.liters);
    if (!distance || !Number.isFinite(liters) || liters <= 0) return null;
    return (liters / distance) * 100;
  }

  function completedResultsForFuel(fuel) {
    const today = todayIso();
    const fuelHint = hints.fuels[fuel] || {};
    const history = (Array.isArray(fuelHint.history) ? fuelHint.history : [])
      .map(normalizeHistoryEntry)
      .filter(function (entry) {
        return entry && parseDecimal(entry.consumption) !== null;
      });
    const todayEntry = history.find(function (entry) {
      return entry.dateIso === today;
    }) || null;
    const lastEntry = history.find(function (entry) {
      return entry.dateIso !== today;
    }) || null;
    return {
      today: todayEntry,
      last: lastEntry,
      latest: todayEntry || lastEntry || history[0] || null
    };
  }

  function entryConsumption(entry) {
    const previous = previousOdometerForFuel(entry.fuel);
    const liters = parseDecimal(entry.liters);
    const current = numberOrNull(entry.odometer);
    if (!previous || !current || current <= previous || !Number.isFinite(liters) || liters <= 0) {
      return { distance: null, consumption: null, previousOdometer: previous || null };
    }
    const distance = Math.trunc(current - previous);
    return {
      distance,
      consumption: (liters / distance) * 100,
      previousOdometer: previous
    };
  }

  function hasMissingPreviousData() {
    return FUELS.some(function (fuel) {
      const fuelHint = hints.fuels[fuel] || {};
      return !previousOdometerForFuel(fuel) || !parseDecimal(fuelHint.lastConsumption);
    });
  }

  function currentSettings(options) {
    const stored = storage.getSettings();
    const endpointFromInput = els.endpointInput ? els.endpointInput.value.trim() : "";
    const pinFromInput = els.pinInput ? els.pinInput.value.trim() : "";
    settings = {
      endpointUrl: endpointFromInput || stored.endpointUrl || "",
      pin: pinFromInput || stored.pin || ""
    };
    if (options && options.persist) storage.saveSettings(settings);
    return settings;
  }

  function missingSettingsMessage(syncSettings) {
    if (!syncSettings.endpointUrl && !syncSettings.pin) return "Uzupełnij Apps Script URL i PIN.";
    if (!syncSettings.endpointUrl) return "Uzupełnij Apps Script URL.";
    if (!syncSettings.pin) return "Uzupełnij PIN.";
    return "";
  }

  function saveAll() {
    storage.saveSettings(settings);
    storage.saveDraft(draft);
    storage.saveQueue(queue);
    storage.savePendingScan(pendingScan);
    storage.saveReceiptScans(pendingScan ? [pendingScan] : []);
    storage.saveLastSummary(lastSummary);
    storage.saveRecentRefuel(recentRefuel);
    storage.saveEntryUndoSnapshot(entryUndoSnapshot);
    storage.saveHints(hints);
    storage.saveResults(results);
  }

  function mergeMeaningful(target, source) {
    const result = Object.assign({}, target || {});
    Object.keys(source || {}).forEach(function (key) {
      const value = source[key];
      if (value !== null && value !== undefined && value !== "") {
        result[key] = value;
      }
    });
    return result;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () {
      els.toast.hidden = true;
    }, 3200);
  }

  function friendlySyncError(error) {
    const message = String(error && error.message ? error.message : error || "");
    if (message.includes("Missing endpoint API version") || message.includes("Incompatible endpoint API version")) {
      return "Endpoint Apps Script jest niezgodny z tą wersją aplikacji. Zaktualizuj istniejące wdrożenie Apps Script.";
    }
    if (message.includes("TANKOWANIE_PIN is not configured in Apps Script")) {
      return "Apps Script: ustaw PIN w Code.gs albo Script Properties.";
    }
    if (message.includes("TANKOWANIE_PIN value is empty")) {
      return "Apps Script: właściwość TANKOWANIE_PIN istnieje, ale nie ma wartości.";
    }
    if (message.includes("TANKOWANIE_PIN is not in Script Properties")) {
      return "Apps Script: TANKOWANIE_PIN musi być zapisany we Właściwościach skryptu.";
    }
    if (message.includes("TANKOWANIE_PIN is not configured")) {
      return "Apps Script: brak właściwości TANKOWANIE_PIN w tym endpoincie.";
    }
    if (message.includes("Wrong PIN")) {
      return "PIN nie pasuje do ustawienia TANKOWANIE_PIN.";
    }
    if (message.includes("Missing Apps Script URL")) {
      return "Uzupełnij Apps Script URL.";
    }
    if (message.includes("Network error")) {
      return "Brak połączenia z endpointem Apps Script.";
    }
    if (message.includes("Missing row for receipt scan") || message.includes("Missing LPG row for receipt scan")) {
      return "Skan czeka lokalnie: brakuje wiersza tankowania z arkusza.";
    }
    if (message.includes("Receipt scan is too large")) {
      return "Skan jest za duży. Zrób zdjęcie z bliższa albo słabszą jakością.";
    }
    if (message.includes("Receipt row does not match")) {
      return "Skan nie pasuje do wiersza tankowania w arkuszu.";
    }
    if (message.includes("Authorization") || message.includes("DriveApp") || message.includes("permission")) {
      return "Apps Script wymaga autoryzacji Google Drive. Uruchom authorizeDrive i wdróż skrypt ponownie.";
    }
    return message || "Błąd synchronizacji.";
  }

  function updateOnlineState() {
    els.onlineState.textContent = navigator.onLine ? "online" : "offline";
  }

  function busyText(action) {
    if (action === "save") return "Wysyłanie do arkusza...";
    if (action === "sync") return "Synchronizacja...";
    if (action === "scan") return "Wysyłanie skanu...";
    if (action === "data") return "Pobieranie danych...";
    return "Praca online...";
  }

  function receiptPromptRecord() {
    const record = findReceiptScan(receiptPromptEntryId);
    if (!record) return null;
    return record.status === "pending" || record.status === "ready" ? record : null;
  }

  function renderBusyReceiptPrompt() {
    if (!els.busyReceiptPrompt) return;
    const dialogVisible = els.receiptDialog && !els.receiptDialog.hidden;
    const record = busyAction === "save" && !dialogVisible ? receiptPromptRecord() : null;
    els.busyReceiptPrompt.hidden = !record;
  }

  function maybeContinueReceiptPromptAfterBusy() {
    const record = receiptPromptRecord();
    if (!record) return;
    if (els.receiptDialog && !els.receiptDialog.hidden) return;
    showReceiptDecision(record.entryId);
  }

  function renderBusy() {
    const isBusy = !!busyAction;
    if (!els.inlineKeypad || !els.syncWorkingPanel) return;
    els.inlineKeypad.hidden = isBusy;
    els.syncWorkingPanel.hidden = !isBusy;
    if (els.syncWorkingText) els.syncWorkingText.textContent = busyText(busyAction);
    [
      { action: "save", element: els.saveButton },
      { action: "sync", element: els.syncButton },
      { action: "scan", element: els.saveButton },
      { action: "data", element: els.refreshButton }
    ].forEach(function (item) {
      if (!item.element) return;
      item.element.classList.toggle("action-busy", busyAction === item.action);
      item.element.disabled = isBusy;
    });
    renderBusyReceiptPrompt();
  }

  function setBusy(action) {
    const previousAction = busyAction;
    busyAction = action || "";
    renderBusy();
    if (previousAction === "save" && !busyAction) maybeContinueReceiptPromptAfterBusy();
  }

  function fieldHtml(value, isStale) {
    const text = String(value || "--");
    if (text === "--") return '<span class="empty">--</span>';
    return `<span class="${isStale ? "edit-hint is-stale" : ""}">${text}</span>`;
  }

  function configureKeypad() {
    if (!keypadReady) return;
    if (activeEdit === "price") {
      keypad.setMode({
        mode: "price",
        hint: pumpPriceHintValue(),
        value: draft.pumpPrice
      });
      return;
    }
    if (activeEdit === "discount") {
      keypad.setMode({
        mode: "discount",
        hint: hints.discountPerLiter,
        value: draft.discountPerLiterEdited ? draft.discountPerLiter : null
      });
      return;
    }
    if (activeEdit === "liters") {
      keypad.setMode({
        mode: "liters",
        hint: null,
        value: draft.liters
      });
      return;
    }
    keypad.setMode({
      mode: "odometer",
      hint: odometerHintValue(),
      value: draft.odometer
    });
  }

  function keepActiveFieldVisible() {
    const target = activeEdit === "price"
      ? els.priceButton
      : activeEdit === "discount" ? els.discountButton
        : activeEdit === "liters" ? els.litersButton : els.odometerButton;
    if (!target || typeof target.scrollIntoView !== "function") return;
    window.requestAnimationFrame(function () {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  function setActiveEdit(field, shouldScroll) {
    activeEdit = field === "price" || field === "liters" || field === "discount" ? field : "odometer";
    configureKeypad();
    render();
    if (shouldScroll) keepActiveFieldVisible();
  }

  function setValueState(element, entered) {
    element.classList.toggle("entered-value", !!entered);
    element.classList.toggle("pending-value", !entered);
  }

  function setEmptyInactiveState(element, empty, active) {
    element.classList.toggle("empty-inactive", !!empty && !active);
  }

  function renderDistance() {
    const summary = retainedSummary();
    const distance = distanceSinceLast() || (summary && summary.distance ? summary.distance : null);
    const box = els.distanceValue.closest(".distance-box");
    if (distance) {
      els.distanceValue.textContent = String(distance);
      box.classList.remove("empty");
    } else {
      els.distanceValue.textContent = "--";
      box.classList.add("empty");
    }
  }

  function renderDiscount() {
    const discount = effectiveDiscount();
    const paid = paidPrice();
    const discountActive = activeEdit === "discount" && keypad.getMode() === "discount";
    els.discountButton.classList.toggle("active-edit", discountActive);
    if (discountActive) {
      const activeHtml = keypad.getDisplayHtml();
      els.discountValue.innerHTML = activeHtml === '<span class="empty">--</span>' ? "--" : `-${activeHtml}`;
    } else {
      els.discountValue.textContent = signedMoney(discount);
    }
    els.paidPriceValue.textContent = paid === null ? "--" : money(paid);
  }

  function renderEditableFields() {
    const odometerActive = activeEdit === "odometer" && keypad.getMode() === "odometer";
    const priceActive = activeEdit === "price" && keypad.getMode() === "price";
    const litersActive = activeEdit === "liters" && keypad.getMode() === "liters";
    const summary = retainedSummary();
    const odometerHint = odometerHintValue();
    const priceHint = summary && summary.pumpPrice ? summary.pumpPrice : pumpPriceHintValue();

    els.odometerButton.classList.toggle("active-edit", odometerActive);
    els.priceButton.classList.toggle("active-edit", priceActive);
    els.litersButton.classList.toggle("active-edit", litersActive);
    setEmptyInactiveState(els.odometerButton, !draft.odometer, odometerActive);
    setEmptyInactiveState(els.priceButton, !draft.pumpPrice, priceActive);
    setEmptyInactiveState(els.litersButton, !parseDecimal(draft.liters), litersActive);

    if (odometerActive) {
      els.odometerValue.innerHTML = keypad.getDisplayHtml();
      els.odometerValue.classList.toggle("stale", !draft.odometer && !!odometerHint);
      els.odometerValue.classList.toggle("empty", !draft.odometer && !odometerHint);
    } else if (draft.odometer) {
      els.odometerValue.textContent = String(draft.odometer);
      els.odometerValue.classList.remove("stale", "empty");
    } else {
      els.odometerValue.innerHTML = fieldHtml(odometerHint || "--", !!odometerHint);
      els.odometerValue.classList.toggle("stale", !!odometerHint);
      els.odometerValue.classList.toggle("empty", !odometerHint);
    }
    setValueState(els.odometerButton, !!draft.odometer);

    if (priceActive) {
      els.pumpPriceValue.innerHTML = `${keypad.getDisplayHtml()} <span class="unit">zł/litr</span>`;
      els.pumpPriceValue.classList.toggle("stale", !draft.pumpPrice && !!priceHint);
      els.pumpPriceValue.classList.toggle("empty", !draft.pumpPrice && !priceHint);
    } else if (draft.pumpPrice) {
      els.pumpPriceValue.innerHTML = `${money(draft.pumpPrice)} <span class="unit">zł/litr</span>`;
      els.pumpPriceValue.classList.remove("stale", "empty");
    } else {
      els.pumpPriceValue.innerHTML = priceHint
        ? `<span class="edit-hint is-stale">${money(priceHint)}</span> <span class="unit">zł/litr</span>`
        : '<span class="empty">--</span>';
      els.pumpPriceValue.classList.toggle("stale", !!priceHint);
      els.pumpPriceValue.classList.toggle("empty", !priceHint);
    }
    setValueState(els.priceButton, !!draft.pumpPrice || !!(summary && summary.pumpPrice));

    if (litersActive) {
      els.litersValue.innerHTML = keypad.getDisplayHtml();
      els.litersValue.classList.toggle("empty", !draft.liters);
    } else if (parseDecimal(draft.liters)) {
      els.litersValue.textContent = formatLiters(draft.liters);
      els.litersValue.classList.remove("empty");
    } else {
      els.litersValue.innerHTML = '<span class="empty">--</span>';
      els.litersValue.classList.add("empty");
    }
    setValueState(els.litersButton, !!parseDecimal(draft.liters));

    renderDistance();
    renderDiscount();
  }

  function renderResults() {
    const completed = completedResultsForFuel(draft.fuel);
    const draftDate = normalizeDateIso(els.refuelDate && els.refuelDate.value ? els.refuelDate.value : draft.date);
    const draftConsumption = draftDate === todayIso() ? localConsumption() : null;
    const todayConsumption = draftConsumption !== null
      ? draftConsumption
      : completed.today ? parseDecimal(completed.today.consumption) : null;
    const lastConsumption = completed.last ? parseDecimal(completed.last.consumption) : null;
    const latestConsumption = completed.latest ? parseDecimal(completed.latest.consumption) : null;
    const sheetMonthly = parseDecimal(results.monthlyAverage);

    els.todayResultValue.textContent = todayConsumption !== null ? formatConsumption(todayConsumption) : "--";
    els.todayResultValue.classList.toggle("provisional-result", draftConsumption !== null);
    els.lastResultValue.textContent = lastConsumption !== null ? formatConsumption(lastConsumption) : "--";
    els.lastSheetRead.textContent = (completed.today && completed.today.date) || (completed.last && completed.last.date) || results.lastReadAt || "";

    if (draft.fuel === "E98") {
      els.monthlyAverage.textContent = latestConsumption !== null ? formatConsumption(latestConsumption) : "--";
    } else {
      els.monthlyAverage.textContent = sheetMonthly !== null ? formatConsumption(sheetMonthly) : (results.monthlyAverage || "--");
    }
    els.monthlyHeading.textContent = "Średnio miesiąc";
    els.monthlyLabel.textContent = "";
  }

  function renderTotals() {
    const summary = totals();
    if (!summary) {
      els.pumpTotalValue.textContent = "--";
      els.discountTotalValue.textContent = "--";
      els.paidTotalValue.textContent = "--";
      return;
    }
    els.pumpTotalValue.textContent = `${money(summary.pump)} zł`;
    els.discountTotalValue.textContent = `${signedMoney(summary.discount)} zł`;
    els.paidTotalValue.textContent = `${money(summary.paid)} zł`;
  }

  function render() {
    document.body.classList.toggle("editing-discount", activeEdit === "discount");
    if (ensureDefaultDateForEmptyDraft()) storage.saveDraft(draft);
    if (els.fuelToggleImage) {
      els.fuelToggleImage.src = fuelImagePath(draft.fuel);
      els.fuelToggleImage.alt = draft.fuel;
    }
    if (els.fuelToggle) {
      els.fuelToggle.setAttribute("aria-label", `Wybór paliwa: ${draft.fuel}`);
      els.fuelToggle.title = draft.fuel;
    }
    if (els.inlineKeypadGrid) {
      els.inlineKeypadGrid.classList.toggle("fuel-lpg", draft.fuel === "LPG");
      els.inlineKeypadGrid.classList.toggle("fuel-e98", draft.fuel === "E98");
    }
    document.body.dataset.fuel = draft.fuel.toLowerCase();
    els.refuelDate.value = draft.date || todayIso();
    if (els.dateValue) els.dateValue.textContent = formatShortDate(els.refuelDate.value);
    if (els.dateButton) setValueState(els.dateButton, !!els.refuelDate.value);

    renderEditableFields();
    renderResults();
    renderTotals();

    els.endpointInput.value = settings.endpointUrl || "";
    els.pinInput.value = settings.pin || "";
    if (els.appVersionLabel) els.appVersionLabel.textContent = storage.APP_VERSION;
    els.syncState.textContent = results.lastSyncAt ? `sync ${results.lastSyncAt}` : "brak sync";
    els.queueState.textContent = `q: ${queue.length}`;
    renderQueue();
    renderReceiptScanState();
    updateOnlineState();
    renderBusy();
  }

  function renderQueue() {
    if (els.syncButton) els.syncButton.hidden = !queue.length;
    if (!queue.length) {
      if (els.queuePanel) els.queuePanel.classList.add("queue-empty");
      els.queueList.textContent = "";
      return;
    }
    if (els.queuePanel) els.queuePanel.classList.remove("queue-empty");
    els.queueList.innerHTML = queue.map(function (item) {
      return `
        <div class="queue-item">
          <strong>${item.fuel}</strong>
          <span>${item.refuelDate}, ${item.odometer} km, ${item.liters} l, ${money(item.discountedPrice)} zł</span>
        </div>
      `;
    }).join("");
  }

  function renderReceiptScanState() {
    if (!els.refreshButton || !els.saveButton) return;
    const record = activeReceiptScan();
    const active = !!record;
    els.refreshButton.classList.remove("scan-pending", "scan-abandon-pending");
    els.refreshButton.textContent = "☁↓";
    els.refreshButton.title = "Pobierz dane z arkusza";
    els.refreshButton.setAttribute("aria-label", "Pobierz dane");
    els.saveButton.classList.toggle("scan-pending", active);
    if (active) {
      els.saveButton.title = !isRefuelDraftEmpty()
        ? "Wyślij wpis; skan czeka"
        : record.status === "ready"
        ? "Wyślij skan paragonu"
        : "Dodaj skan paragonu";
      els.saveButton.setAttribute("aria-label", els.saveButton.title);
      return;
    }
    els.saveButton.title = "Wyślij do arkusza";
    els.saveButton.setAttribute("aria-label", "Zapisz lub wyślij");
  }

  function applyConfig(config) {
    const sheetDiscount = parseDecimal(config.discountPerLiter);
    const previousDiscount = parseDecimal(hints.discountPerLiter);
    hints.discountPerLiter = sheetDiscount !== null && sheetDiscount >= 0
      ? sheetDiscount
      : previousDiscount !== null && previousDiscount >= 0 ? previousDiscount : 0.21;
    hints.latestOdometer = config.latestOdometer || hints.latestOdometer || null;
    const incomingFuels = config.fuels || {};
    FUELS.forEach(function (fuel) {
      const existing = normalizeFuelHint(hints.fuels[fuel]);
      const incoming = normalizeFuelHint(incomingFuels[fuel]);
      const merged = mergeMeaningful(existing, incomingFuels[fuel]);
      merged.history = upsertHistory(existing.history, incoming.history);
      hints.fuels[fuel] = normalizeFuelHint(merged);
    });
    hints.fuels = normalizeHints({ fuels: hints.fuels }).fuels;
    results.monthlyLabel = config.monthlyLabel || results.monthlyLabel || "";
    results.monthlyAverage = config.monthlyAverage || results.monthlyAverage || "";
    results.lastLpgResult = config.lastLpgResult || results.lastLpgResult || "";
    results.lastReadAt = new Date().toLocaleString("pl-PL", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
    results.sheetTitle = config.sheetTitle || results.sheetTitle || "";
    saveAll();
    configureKeypad();
    render();
  }

  async function refreshConfig(options) {
    const silent = options && options.silent;
    const syncSettings = currentSettings({ persist: true });
    const missing = missingSettingsMessage(syncSettings);
    if (missing) {
      if (!silent) {
        toast(missing);
        els.settingsPanel.hidden = false;
      }
      return null;
    }
    setBusy("data");
    try {
      const config = await sync.getConfig(syncSettings);
      applyConfig(config);
      if (!silent) toast("Dane pobrane z arkusza.");
      return config;
    } finally {
      setBusy("");
    }
  }

  async function verifySyncReady(syncSettings) {
    const config = await sync.getConfig(syncSettings);
    return config;
  }

  function maybeAutoRefreshConfig() {
    const syncSettings = currentSettings();
    if (!syncSettings.endpointUrl || !syncSettings.pin || !navigator.onLine) return;
    if (!hasMissingPreviousData()) return;
    refreshConfig({ silent: true }).catch(function () {});
  }

  function buildEntry() {
    const liters = parseDecimal(draft.liters);
    const price = Number(visiblePumpPrice());
    const odometer = Number(draft.odometer);
    const date = normalizeDateIso(els.refuelDate.value || draft.date) || todayIso();
    const paid = paidPrice();
    const discount = effectiveDiscount();

    if (!Number.isInteger(odometer) || odometer <= 0) throw new Error("Uzupełnij licznik.");
    if (!Number.isFinite(liters) || liters <= 0) throw new Error("Uzupełnij ilość paliwa.");
    if (!Number.isFinite(price) || price <= 0) throw new Error("Uzupełnij cenę z dystrybutora.");
    if (!Number.isFinite(discount) || discount < 0) throw new Error("Rabat jest nieprawidłowy.");
    if (paid === null || paid <= 0) throw new Error("Cena po rabacie jest nieprawidłowa.");

    return {
      entryId: storage.createId("entry"),
      fuel: draft.fuel,
      odometer,
      liters: Number(liters.toFixed(2)),
      pumpPrice: Number(price.toFixed(2)),
      discountPerLiter: Number(discount.toFixed(2)),
      discountedPrice: paid,
      refuelDate: date,
      createdAt: new Date().toISOString(),
      deviceId: storage.getDeviceId(),
      appVersion: storage.APP_VERSION
    };
  }

  function rememberEntryHints(entry) {
    const fuelHint = hints.fuels[entry.fuel] || {};
    const entryStats = entryConsumption(entry);
    const entryConsumptionValue = entryStats.consumption !== null
      ? Number(entryStats.consumption.toFixed(2))
      : null;
    fuelHint.suggestedPumpPrice = entry.pumpPrice;
    fuelHint.lastPaidPrice = entry.discountedPrice;
    fuelHint.lastOdometer = entry.odometer;
    fuelHint.lastLiters = entry.liters;
    fuelHint.lastDate = entry.refuelDate;
    fuelHint.lastDateIso = entry.refuelDate;
    fuelHint.previousOdometer = entryStats.previousOdometer;
    fuelHint.lastDistance = entryStats.distance;
    fuelHint.lastConsumption = entryConsumptionValue;
    fuelHint.history = upsertHistory(fuelHint.history, {
      entryId: entry.entryId,
      dateIso: entry.refuelDate,
      date: entry.refuelDate,
      odometer: entry.odometer,
      liters: entry.liters,
      paidPrice: entry.discountedPrice,
      previousOdometer: entryStats.previousOdometer,
      distance: entryStats.distance,
      consumption: entryConsumptionValue,
      source: "local"
    });
    fuelHint.provisional = true;
    hints.fuels[entry.fuel] = fuelHint;
    hints.latestOdometer = Math.max(Number(hints.latestOdometer || 0), entry.odometer);
  }

  function clearEntryDraft() {
    draft.odometer = null;
    draft.pumpPrice = null;
    draft.discountPerLiter = null;
    draft.discountPerLiterEdited = false;
    draft.liters = "";
    draft.date = todayIso();
    userAdjustedDate = false;
  }

  function clearRefuelInputDraft() {
    draft.odometer = null;
    draft.pumpPrice = null;
    draft.liters = "";
    saveAll();
    setActiveEdit("odometer");
    toast("Pola tankowania wyczyszczone.");
  }

  function normalizeReceiptRecord(record) {
    const source = record && typeof record === "object" ? record : {};
    const fuel = String(source.fuel || "LPG").toUpperCase();
    return {
      entryId: String(source.entryId || ""),
      fuel: fuel === "E98" ? "E98" : "LPG",
      row: source.row ? Number(source.row) : "",
      refuelDate: normalizeDateIso(source.refuelDate || source.date) || "",
      odometer: source.odometer ? Number(source.odometer) : "",
      status: String(source.status || "pending"),
      fileName: String(source.fileName || ""),
      mimeType: String(source.mimeType || ""),
      fileSize: source.fileSize ? Number(source.fileSize) : "",
      base64: String(source.base64 || ""),
      fileUrl: String(source.fileUrl || ""),
      error: String(source.error || ""),
      sessionId: String(source.sessionId || ""),
      createdAt: String(source.createdAt || new Date().toISOString()),
      updatedAt: String(source.updatedAt || new Date().toISOString())
    };
  }

  function isActiveReceiptStatus(status) {
    return status === "pending" || status === "ready";
  }

  function receiptTimestamp(record) {
    if (record && Number.isFinite(Number(record.createdAt))) return Number(record.createdAt);
    const updated = Date.parse(record && record.updatedAt ? record.updatedAt : "");
    if (Number.isFinite(updated)) return updated;
    const created = Date.parse(record && record.createdAt ? record.createdAt : "");
    return Number.isFinite(created) ? created : 0;
  }

  function newestLegacyReceiptScan(records) {
    let latest = null;
    (Array.isArray(records) ? records : []).forEach(function (item, index) {
      const record = normalizeReceiptRecord(item);
      if (!record.entryId) return;
      const rank = receiptTimestamp(record) || index;
      if (!latest || rank >= latest.rank) latest = { record, rank };
    });
    return latest ? latest.record : null;
  }

  function migratePendingScan(current, legacyRecords) {
    const normalizedCurrent = normalizeReceiptRecord(current);
    if (current && typeof current === "object" && normalizedCurrent.entryId) {
      return isActiveReceiptStatus(normalizedCurrent.status) ? normalizedCurrent : null;
    }
    const latestLegacy = newestLegacyReceiptScan(legacyRecords);
    if (latestLegacy && isActiveReceiptStatus(latestLegacy.status)) return latestLegacy;
    return null;
  }

  function findReceiptScan(entryId) {
    const id = String(entryId || "");
    if (!id) return null;
    return pendingScan && pendingScan.entryId === id ? pendingScan : null;
  }

  function upsertReceiptScan(record) {
    const normalized = normalizeReceiptRecord(record);
    if (!normalized.entryId || !isActiveReceiptStatus(normalized.status)) return null;
    pendingScan = normalized;
    return pendingScan;
  }

  function clearPendingScan(entryId) {
    if (entryId && (!pendingScan || pendingScan.entryId !== entryId)) return;
    pendingScan = null;
    if (receiptPromptEntryId && (!entryId || receiptPromptEntryId === entryId)) receiptPromptEntryId = "";
  }

  function activeReceiptScan() {
    return pendingScan && isActiveReceiptStatus(pendingScan.status) ? pendingScan : null;
  }

  function rememberRecentRefuel(entry) {
    if (!entry || (entry.fuel !== "LPG" && entry.fuel !== "E98")) return;
    recentRefuel = normalizeRecentRefuel({
      fuel: entry.fuel,
      entryId: entry.entryId,
      odometer: entry.odometer,
      refuelDate: entry.refuelDate,
      savedAt: Date.now()
    });
    storage.saveRecentRefuel(recentRefuel);
  }

  function isRecentOtherFuelRefuel(targetFuel) {
    const context = normalizeRecentRefuel(recentRefuel);
    if (!context.fuel || context.fuel === targetFuel) return false;
    if (!context.odometer || !context.savedAt) return false;
    return Date.now() - context.savedAt <= 60 * 60 * 1000;
  }

  function applyFastSecondFuel(targetFuel) {
    if (!isRefuelDraftEmpty()) return false;
    if (!isRecentOtherFuelRefuel(targetFuel)) return false;
    captureEntryUndoSnapshot("fast-second-fuel", true);
    draft.fuel = targetFuel;
    draft.odometer = Number(recentRefuel.odometer);
    draft.pumpPrice = null;
    draft.discountPerLiter = null;
    draft.discountPerLiterEdited = false;
    draft.liters = "";
    if (recentRefuel.refuelDate) draft.date = recentRefuel.refuelDate;
    saveAll();
    setActiveEdit("price", true);
    return true;
  }

  function rememberLpgReceiptContext(entry) {
    if (!entry || entry.fuel !== "LPG") return;
    recentLpgReceiptContext = {
      entryId: entry.entryId,
      refuelDate: entry.refuelDate,
      sessionId: pageSessionId,
      createdAt: Date.now()
    };
  }

  function isRecentLpgContextForEntry(context, entry) {
    if (!context || !entry || entry.fuel !== "E98") return false;
    if (context.sessionId !== pageSessionId) return false;
    if (context.refuelDate && entry.refuelDate && context.refuelDate !== entry.refuelDate) return false;
    const created = receiptTimestamp(context);
    return created >= pageStartedAt - 10000 && Date.now() - created <= 60 * 60 * 1000;
  }

  function isCombinedE98WithCurrentLpg(entry) {
    const record = activeReceiptScan();
    if (record && record.fuel === "LPG" && isRecentLpgContextForEntry(record, entry)) return true;
    return isRecentLpgContextForEntry(recentLpgReceiptContext, entry);
  }

  function shouldTrackReceiptForEntry(entry) {
    if (!entry) return false;
    if (entry.fuel === "LPG") return true;
    if (entry.fuel === "E98") return !isCombinedE98WithCurrentLpg(entry);
    return false;
  }

  function registerReceiptCandidate(entry, receipt, prompt) {
    if (!shouldTrackReceiptForEntry(entry)) return null;
    const existing = findReceiptScan(entry.entryId) || {};
    const record = upsertReceiptScan(Object.assign(existing, {
      entryId: entry.entryId,
      fuel: entry.fuel,
      row: receipt && receipt.row ? Number(receipt.row) : existing.row || "",
      refuelDate: entry.refuelDate,
      odometer: entry.odometer,
      status: existing.status || "pending",
      sessionId: existing.sessionId || pageSessionId,
      updatedAt: new Date().toISOString()
    }));
    rememberLpgReceiptContext(entry);
    saveAll();
    render();
    if (prompt && record && (record.status === "pending" || record.status === "ready")) {
      showReceiptDecision(record.entryId);
    }
    return record;
  }

  function updateReceiptRowFromReceipt(receipt) {
    if (!receipt || !receipt.entryId) return null;
    const record = findReceiptScan(receipt.entryId);
    if (!record) return null;
    if (receipt.fuel && record.fuel !== receipt.fuel) return null;
    record.row = receipt.row ? Number(receipt.row) : record.row || "";
    record.updatedAt = new Date().toISOString();
    upsertReceiptScan(record);
    saveAll();
    render();
    return findReceiptScan(receipt.entryId);
  }

  function showReceiptDecision(entryId) {
    const record = findReceiptScan(entryId);
    if (!record || !els.receiptDialog) return;
    receiptPromptEntryId = record.entryId;
    if (els.receiptQuestionText) {
      els.receiptQuestionText.textContent = "Czy wysłać skan paragonu?";
    }
    if (els.receiptDecisionActions) els.receiptDecisionActions.hidden = false;
    if (els.receiptSourceActions) els.receiptSourceActions.hidden = true;
    if (busyAction === "save") {
      els.receiptDialog.hidden = true;
      renderBusyReceiptPrompt();
      return;
    }
    els.receiptDialog.hidden = false;
  }

  function showReceiptSource(entryId) {
    const record = findReceiptScan(entryId);
    if (!record || !els.receiptDialog) return;
    receiptPromptEntryId = record.entryId;
    if (els.receiptQuestionText) {
      els.receiptQuestionText.textContent = "Wybierz zdjęcie paragonu";
    }
    if (els.receiptDecisionActions) els.receiptDecisionActions.hidden = true;
    if (els.receiptSourceActions) els.receiptSourceActions.hidden = false;
    els.receiptDialog.hidden = false;
    renderBusyReceiptPrompt();
  }

  function hideReceiptDialog() {
    receiptPromptEntryId = "";
    if (els.receiptDialog) els.receiptDialog.hidden = true;
    renderBusyReceiptPrompt();
  }

  function chooseReceiptLater() {
    const record = findReceiptScan(receiptPromptEntryId);
    if (record) {
      record.status = record.base64 ? "ready" : "pending";
      record.updatedAt = new Date().toISOString();
      upsertReceiptScan(record);
      saveAll();
      render();
    }
    hideReceiptDialog();
    toast("Skan można dodać później chmurą.");
  }

  function clearReceiptFileInputs() {
    if (els.receiptCameraInput) els.receiptCameraInput.value = "";
    if (els.receiptGalleryInput) els.receiptGalleryInput.value = "";
  }

  function startReceiptFileChoice(source) {
    const record = findReceiptScan(receiptPromptEntryId) || activeReceiptScan();
    if (!record) return;
    receiptPromptEntryId = record.entryId;
    clearReceiptFileInputs();
    if (source === "camera" && els.receiptCameraInput) {
      els.receiptCameraInput.click();
      return;
    }
    if (els.receiptGalleryInput) els.receiptGalleryInput.click();
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("Nie udało się odczytać zdjęcia.")); };
      reader.readAsDataURL(blob);
    });
  }

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("Nie udało się wczytać zdjęcia."));
      };
      image.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob);
        else reject(new Error("Nie udało się przygotować skanu."));
      }, "image/jpeg", quality);
    });
  }

  async function compressReceiptImage(file) {
    if (!file || !file.type || !file.type.startsWith("image/")) {
      throw new Error("Wybierz plik obrazu.");
    }
    const image = await loadImageFromFile(file);
    let maxEdge = RECEIPT_MAX_EDGE;
    let bestBlob = null;
    for (let pass = 0; pass < 3; pass += 1) {
      const ratio = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * ratio));
      const height = Math.max(1, Math.round(image.height * ratio));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(image, 0, 0, width, height);
      for (const quality of [0.82, 0.72, 0.62, 0.52]) {
        const blob = await canvasToBlob(canvas, quality);
        bestBlob = blob;
        if (blob.size <= RECEIPT_TARGET_BYTES) {
          const dataUrl = await blobToDataUrl(blob);
          return {
            base64: dataUrl.split(",")[1] || "",
            mimeType: "image/jpeg",
            fileName: "",
            fileSize: blob.size
          };
        }
      }
      maxEdge = Math.round(maxEdge * 0.78);
    }
    if (!bestBlob) throw new Error("Nie udało się przygotować skanu.");
    if (bestBlob.size > 850 * 1024) throw new Error("Receipt scan is too large.");
    const fallbackDataUrl = await blobToDataUrl(bestBlob);
    return {
      base64: fallbackDataUrl.split(",")[1] || "",
      mimeType: "image/jpeg",
      fileName: "",
      fileSize: bestBlob.size
    };
  }

  function receiptFileName(record) {
    const date = normalizeDateIso(record.refuelDate) || todayIso();
    const time = new Date().toTimeString().slice(0, 8).replace(/:/g, "-");
    return `BG_ORLEN_${date}_${time}.jpg`;
  }

  async function handleReceiptFileSelected(file) {
    const record = findReceiptScan(receiptPromptEntryId) || activeReceiptScan();
    if (!record || !file) return;
    const ownsBusy = !busyAction;
    try {
      if (ownsBusy) setBusy("scan");
      const imageData = await compressReceiptImage(file);
      record.status = "ready";
      record.base64 = imageData.base64;
      record.mimeType = imageData.mimeType;
      record.fileName = receiptFileName(record);
      record.fileSize = imageData.fileSize;
      record.error = "";
      record.updatedAt = new Date().toISOString();
      upsertReceiptScan(record);
      saveAll();
      hideReceiptDialog();
      render();
      if (record.row && busyAction !== "save") {
        await uploadReceiptScanRecord(record);
      } else {
        toast("Skan zapisany lokalnie. Czeka na wiersz tankowania.");
      }
    } catch (error) {
      toast(friendlySyncError(error) || "Nie udało się zapisać skanu.");
    } finally {
      clearReceiptFileInputs();
      if (ownsBusy) setBusy("");
    }
  }

  async function uploadReceiptScanRecord(record) {
    const currentRecord = findReceiptScan(record && record.entryId);
    if (!currentRecord || currentRecord.status !== "ready") return null;
    const syncSettings = currentSettings({ persist: true });
    const missing = missingSettingsMessage(syncSettings);
    if (missing) {
      toast(`Skan czeka lokalnie. ${missing}`);
      return null;
    }
    if (!navigator.onLine) {
      toast("Skan czeka lokalnie offline.");
      return null;
    }
    if (!currentRecord.row) {
      toast("Skan czeka lokalnie: najpierw wyślij wpis tankowania.");
      return null;
    }
    if (!currentRecord.base64) {
      showReceiptSource(currentRecord.entryId);
      return null;
    }
    const previousBusy = busyAction;
    setBusy(previousBusy || "scan");
    try {
      const receipt = await sync.uploadReceiptScan(syncSettings, {
        entryId: currentRecord.entryId,
        fuel: currentRecord.fuel,
        row: currentRecord.row,
        refuelDate: currentRecord.refuelDate,
        odometer: currentRecord.odometer,
        fileName: currentRecord.fileName || receiptFileName(currentRecord),
        mimeType: currentRecord.mimeType || "image/jpeg",
        base64: currentRecord.base64
      });
      clearPendingScan(currentRecord.entryId);
      saveAll();
      render();
      toast("Skan paragonu wysłany.");
      return receipt;
    } catch (error) {
      currentRecord.error = friendlySyncError(error);
      currentRecord.updatedAt = new Date().toISOString();
      upsertReceiptScan(currentRecord);
      saveAll();
      render();
      toast(currentRecord.error || "Skan czeka lokalnie.");
      return null;
    } finally {
      setBusy(previousBusy);
    }
  }

  async function tryUploadReceiptScansForReceipt(receipt, syncSettings) {
    const record = updateReceiptRowFromReceipt(receipt);
    if (!record || record.status !== "ready" || !record.base64 || !record.row) return null;
    const activeSettings = syncSettings || currentSettings({ persist: true });
    const missing = missingSettingsMessage(activeSettings);
    if (missing || !navigator.onLine) return null;
    return uploadReceiptScanRecord(record);
  }

  function handleReceiptCloudAction() {
    const record = activeReceiptScan();
    if (!record) {
      refreshConfig().catch(function (error) {
        toast(friendlySyncError(error) || "Nie udało się pobrać danych.");
      });
      return;
    }
    if (record.status === "ready") {
      uploadReceiptScanRecord(record);
      return;
    }
    showReceiptSource(record.entryId);
  }

  function abandonActiveReceiptScan() {
    const record = activeReceiptScan();
    if (!record) return;
    clearPendingScan(record.entryId);
    saveAll();
    render();
    toast("Skan paragonu pominięty.");
  }

  function startReceiptCloudLongPress(event) {
    if (!activeReceiptScan() || busyAction) return;
    receiptActionPointerActive = true;
    receiptActionLongDone = false;
    clearTimeout(receiptActionTimer);
    if (els.saveButton) els.saveButton.classList.add("scan-abandon-pending");
    receiptActionTimer = window.setTimeout(function () {
      if (!receiptActionPointerActive) return;
      receiptActionLongDone = true;
      suppressReceiptActionClickUntil = Date.now() + 900;
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      abandonActiveReceiptScan();
      if (els.saveButton) els.saveButton.classList.remove("scan-abandon-pending");
    }, 2000);
  }

  function stopReceiptCloudLongPress() {
    receiptActionPointerActive = false;
    clearTimeout(receiptActionTimer);
    if (els.saveButton) els.saveButton.classList.remove("scan-abandon-pending");
    if (receiptActionLongDone) suppressReceiptActionClickUntil = Date.now() + 900;
  }

  async function saveEntry() {
    try {
      draft.date = els.refuelDate.value || todayIso();
      const entry = buildEntry();
      const summary = buildLastSummary(entry);
      rememberEntryHints(entry);
      setLastSummary(summary);
      const syncSettings = currentSettings({ persist: true });
      const missing = missingSettingsMessage(syncSettings);
      const trackReceipt = shouldTrackReceiptForEntry(entry);
      if (trackReceipt) registerReceiptCandidate(entry, null, false);
      if (missing || !navigator.onLine) {
        queue.push(entry);
        clearEntryDraft();
        saveAll();
        setActiveEdit("odometer");
        if (trackReceipt) showReceiptDecision(entry.entryId);
        toast(missing ? `Wpis w kolejce. ${missing}` : "Wpis zapisany w kolejce offline.");
        return;
      }
      let savedReceipt = null;
      try {
        setBusy("save");
        if (trackReceipt) showReceiptDecision(entry.entryId);
        await verifySyncReady(syncSettings);
        const receipt = await sync.submitEntry(syncSettings, entry);
        savedReceipt = receipt;
        applyReceipt(receipt);
        if (trackReceipt) registerReceiptCandidate(entry, savedReceipt, false);
        await tryUploadReceiptScansForReceipt(receipt, syncSettings);
      } catch (syncError) {
        queue.push(entry);
        clearEntryDraft();
        saveAll();
        setActiveEdit("odometer");
        toast(`Wpis został w kolejce. ${friendlySyncError(syncError)}`);
        return;
      } finally {
        setBusy("");
      }
      if (savedReceipt) await tryUploadReceiptScansForReceipt(savedReceipt, syncSettings);
      rememberRecentRefuel(entry);
      clearEntryDraft();
      saveAll();
      setActiveEdit("odometer");
      toast("Wpis wysłany do arkusza.");
    } catch (error) {
      toast(error.message || "Nie udało się zapisać wpisu.");
    }
  }

  function applyReceipt(receipt) {
    if (receipt && receipt.config) applyConfig(receipt.config);
    results.lastSyncAt = new Date().toLocaleString("pl-PL", { hour: "2-digit", minute: "2-digit" });
    if (receipt && receipt.row) {
      if (receipt.fuel && receipt.postResult && hints.fuels[receipt.fuel]) {
        const postConsumption = parseDecimal(receipt.postResult);
        hints.fuels[receipt.fuel].lastConsumption = postConsumption !== null ? postConsumption : receipt.postResult;
        if (postConsumption !== null && Array.isArray(hints.fuels[receipt.fuel].history) && hints.fuels[receipt.fuel].history[0]) {
          hints.fuels[receipt.fuel].history[0].consumption = Number(postConsumption.toFixed(2));
          hints.fuels[receipt.fuel].history[0].source = "sheet";
        }
        hints.fuels[receipt.fuel].provisional = false;
      }
      results.lastLpgResult = receipt.fuel === "LPG" && receipt.postResult ? receipt.postResult : results.lastLpgResult;
    }
    saveAll();
    configureKeypad();
    render();
  }

  async function syncQueue() {
    if (!queue.length) {
      toast("Kolejka jest pusta.");
      return;
    }
    const syncSettings = currentSettings({ persist: true });
    const missing = missingSettingsMessage(syncSettings);
    if (missing) {
      toast(missing);
      els.settingsPanel.hidden = false;
      render();
      return;
    }
    setBusy("sync");
    try {
      const config = await verifySyncReady(syncSettings);
      applyConfig(config);
    } catch (error) {
      toast(friendlySyncError(error));
      setBusy("");
      return;
    }
    let sent = 0;
    let remaining = [];
    for (let index = 0; index < queue.length; index += 1) {
      const entry = queue[index];
      try {
        const receipt = await sync.submitEntry(syncSettings, entry);
        applyReceipt(receipt);
        await tryUploadReceiptScansForReceipt(receipt, syncSettings);
        sent += 1;
      } catch (error) {
        remaining = queue.slice(index);
        toast(friendlySyncError(error) || "Część wpisów została w kolejce.");
        break;
      }
    }
    setBusy("");
    if (!remaining.length) queue = [];
    else queue = remaining;
    saveAll();
    render();
    if (sent > 0) toast(`Wysłano wpisy: ${sent}.`);
  }

  function applyKeypadValue(payload) {
    let shouldAdvanceToLiters = false;
    if (payload.mode === "price") {
      draft.pumpPrice = payload.hasInput ? Number(payload.value.toFixed(2)) : null;
      shouldAdvanceToLiters = payload.hasInput && payload.inputLength >= 3 && !draft.liters;
    } else if (payload.mode === "discount") {
      draft.discountPerLiter = payload.hasInput ? Number(payload.value.toFixed(2)) : null;
      draft.discountPerLiterEdited = !!payload.hasInput;
    } else if (payload.mode === "liters") {
      draft.liters = payload.hasInput ? payload.value.toFixed(2) : "";
    } else {
      draft.odometer = payload.hasInput ? Math.trunc(payload.value) : null;
    }
    saveAll();
    if (shouldAdvanceToLiters) {
      setActiveEdit("liters");
      return;
    }
    render();
  }

  function advanceEditField() {
    if (activeEdit === "odometer") {
      setActiveEdit("price", true);
      return;
    }
    if (activeEdit === "price") {
      if (!draft.pumpPrice) {
        const suggestedPrice = pumpPriceHintValue();
        if (suggestedPrice && Number.isFinite(Number(suggestedPrice)) && Number(suggestedPrice) > 0) {
          captureEntryUndoSnapshot("accept-price");
          draft.pumpPrice = Number(Number(suggestedPrice).toFixed(2));
          saveAll();
        }
      }
      setActiveEdit("liters", true);
      return;
    }
    setActiveEdit("odometer", true);
  }

  function bindEvents() {
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    els.inlineKeypad.addEventListener("click", function (event) {
      const keyButton = event.target && event.target.closest ? event.target.closest("[data-key]") : null;
      if (!keyButton) return;
      playSound("keypad");
      if (/^[0-9]$/.test(String(keyButton.dataset.key || ""))) {
        if (!hasCurrentEntryInput()) captureEntryUndoSnapshot("first-digit", true);
        clearLastSummary();
      }
    }, true);

    els.fuelToggle.addEventListener("click", function () {
      playSound("other");
      const targetFuel = draft.fuel === "LPG" ? "E98" : "LPG";
      if (applyFastSecondFuel(targetFuel)) return;
      draft.fuel = targetFuel;
      saveAll();
      setActiveEdit("odometer");
    });

    els.dateButton.addEventListener("click", function () {
      playSound("other");
      runProtectedEdit("date", function () {
        if (typeof els.refuelDate.showPicker === "function") {
          els.refuelDate.showPicker();
        } else {
          els.refuelDate.focus();
          els.refuelDate.click();
        }
      });
    });

    els.refuelDate.addEventListener("change", function () {
      userAdjustedDate = true;
      draft.date = els.refuelDate.value;
      saveAll();
      render();
    });

    els.odometerButton.addEventListener("click", function () {
      playSound("field");
      setActiveEdit("odometer", true);
    });

    els.priceButton.addEventListener("click", function () {
      playSound("field");
      setActiveEdit("price", true);
    });

    els.discountButton.addEventListener("click", function () {
      playSound("other");
      runProtectedEdit("discount", function () {
        setActiveEdit("discount", true);
      });
    });

    els.litersButton.addEventListener("click", function () {
      playSound("field");
      setActiveEdit("liters", true);
    });

    els.saveButton.addEventListener("click", function () {
      if (Date.now() < suppressReceiptActionClickUntil) return;
      playSound("other");
      if (activeReceiptScan() && isRefuelDraftEmpty()) {
        handleReceiptCloudAction();
        return;
      }
      saveEntry();
    });
    els.saveButton.addEventListener("pointerdown", startReceiptCloudLongPress);
    els.saveButton.addEventListener("pointerup", stopReceiptCloudLongPress);
    els.saveButton.addEventListener("pointercancel", stopReceiptCloudLongPress);
    els.saveButton.addEventListener("pointerleave", stopReceiptCloudLongPress);
    els.syncButton.addEventListener("click", function () {
      playSound("other");
      syncQueue();
    });
    els.refreshButton.addEventListener("click", function () {
      playSound("other");
      refreshConfig().catch(function (error) {
        toast(friendlySyncError(error) || "Nie udało się pobrać danych.");
      });
    });

    els.receiptYesButton.addEventListener("click", function () {
      playSound("other");
      showReceiptSource(receiptPromptEntryId);
    });
    if (els.busyReceiptYesButton) {
      els.busyReceiptYesButton.addEventListener("click", function () {
        playSound("other");
        showReceiptSource(receiptPromptEntryId);
      });
    }
    els.receiptLaterButton.addEventListener("click", function () {
      playSound("other");
      chooseReceiptLater();
    });
    if (els.busyReceiptLaterButton) {
      els.busyReceiptLaterButton.addEventListener("click", function () {
        playSound("other");
        chooseReceiptLater();
      });
    }
    els.receiptCameraButton.addEventListener("click", function () {
      playSound("other");
      startReceiptFileChoice("camera");
    });
    els.receiptGalleryButton.addEventListener("click", function () {
      playSound("other");
      startReceiptFileChoice("gallery");
    });
    els.receiptCancelButton.addEventListener("click", function () {
      playSound("other");
      hideReceiptDialog();
    });
    els.receiptCameraInput.addEventListener("change", function () {
      handleReceiptFileSelected(els.receiptCameraInput.files && els.receiptCameraInput.files[0]);
    });
    els.receiptGalleryInput.addEventListener("change", function () {
      handleReceiptFileSelected(els.receiptGalleryInput.files && els.receiptGalleryInput.files[0]);
    });

    els.settingsToggle.addEventListener("click", function () {
      playSound("other");
      els.settingsPanel.hidden = !els.settingsPanel.hidden;
    });

    els.saveSettingsButton.addEventListener("click", function () {
      playSound("other");
      settings.endpointUrl = els.endpointInput.value.trim();
      settings.pin = els.pinInput.value.trim();
      storage.saveSettings(settings);
      render();
      toast("Ustawienia zapisane.");
      maybeAutoRefreshConfig();
    });

    els.testSettingsButton.addEventListener("click", async function () {
      playSound("other");
      settings.endpointUrl = els.endpointInput.value.trim();
      settings.pin = els.pinInput.value.trim();
      storage.saveSettings(settings);
      try {
        await sync.ping(settings);
        try {
          const props = await sync.debugProps(settings);
          if (!(props && props.pinConfigured === true)) {
            const visibleScriptKeys = Array.isArray(props && props.propertyKeys) ? props.propertyKeys : [];
            const keyVisible = visibleScriptKeys.indexOf("TANKOWANIE_PIN") !== -1;
            if (props && props.scriptHasTankowaniePinKey === false && (props.userHasTankowaniePinKey || props.documentHasTankowaniePinKey)) {
              throw new Error("TANKOWANIE_PIN is not in Script Properties.");
            }
            if (props && props.hasTankowaniePinKey === false && !keyVisible) {
              throw new Error("TANKOWANIE_PIN is not configured.");
            }
            if (props && (props.hasTankowaniePinValue === false || (props.hasTankowaniePinKey === false && keyVisible))) {
              throw new Error("TANKOWANIE_PIN value is empty.");
            }
          }
        } catch (debugError) {
          const debugMessage = String(debugError && debugError.message || debugError);
          if (
            debugMessage.includes("TANKOWANIE_PIN is not configured")
            || debugMessage.includes("TANKOWANIE_PIN value is empty")
            || debugMessage.includes("TANKOWANIE_PIN is not in Script Properties")
            || debugMessage.includes("endpoint API version")
          ) {
            throw debugError;
          }
        }
        await refreshConfig();
      } catch (error) {
        toast(friendlySyncError(error) || "Test nieudany.");
      }
    });
  }

  function cacheElements() {
    [
      "settingsToggle", "onlineState", "syncState", "queueState", "monthlyAverage",
      "monthlyLabel", "monthlyHeading", "todayResultValue", "lastResultValue",
      "lastSheetRead", "fuelToggle", "fuelToggleImage", "refuelDate", "dateButton",
      "dateValue", "odometerButton", "odometerValue", "distanceValue",
      "priceButton", "pumpPriceValue", "discountButton", "discountValue",
      "paidPriceValue", "litersButton", "litersValue", "pumpTotalValue",
      "discountTotalValue", "paidTotalValue", "saveButton", "syncButton",
      "refreshButton", "settingsPanel", "endpointInput", "pinInput",
      "saveSettingsButton", "testSettingsButton", "queueList", "toast",
      "inlineKeypad", "inlineKeypadGrid", "syncWorkingPanel", "syncWorkingText",
      "busyReceiptPrompt", "busyReceiptYesButton", "busyReceiptLaterButton",
      "appVersionLabel", "queuePanel", "receiptDialog", "receiptQuestionText",
      "receiptDecisionActions", "receiptSourceActions", "receiptYesButton",
      "receiptLaterButton", "receiptCameraButton", "receiptGalleryButton",
      "receiptCancelButton", "receiptCameraInput", "receiptGalleryInput"
    ].forEach(function (id) {
      els[id] = $(id);
    });
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    }
  }

  function init() {
    cacheElements();
    pendingScan = migratePendingScan(storage.getPendingScan(), storage.getReceiptScans());
    storage.savePendingScan(pendingScan);
    storage.saveReceiptScans(pendingScan ? [pendingScan] : []);
    ensureDefaultDateForEmptyDraft();
    if (draft.discountPerLiter === undefined) draft.discountPerLiter = null;
    if (draft.discountPerLiterEdited !== true) draft.discountPerLiterEdited = false;
    keypad.init({
      root: els.inlineKeypad,
      onChange: applyKeypadValue,
      onCommit: applyKeypadValue,
      onOk: advanceEditField,
      onClear: clearRefuelInputDraft,
      onUndo: restoreEntryUndoSnapshot
    });
    keypadReady = true;
    bindEvents();
    setActiveEdit("odometer");
    registerServiceWorker();
    window.setTimeout(maybeAutoRefreshConfig, 300);
    window.setInterval(function () {
      if (ensureDefaultDateForEmptyDraft()) {
        storage.saveDraft(draft);
        render();
      }
    }, 60000);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
