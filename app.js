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
  let hints = normalizeHints(storage.getHints());
  let results = storage.getResults();
  let activeEdit = "odometer";
  let keypadReady = false;
  let busyAction = "";
  let userAdjustedDate = false;

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
    return fuel === "E98" ? "grafiki/E98.png" : "grafiki/LPG.png";
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

  function activeFuelHints() {
    return hints.fuels[draft.fuel] || {};
  }

  function playSound(group) {
    const sounds = window.TankowanieSounds;
    if (sounds && typeof sounds.play === "function") sounds.play(group);
  }

  function odometerHintValue() {
    return activeFuelHints().lastOdometer || 0;
  }

  function pumpPriceHintValue() {
    return activeFuelHints().suggestedPumpPrice || null;
  }

  function visiblePumpPrice() {
    return draft.pumpPrice || pumpPriceHintValue();
  }

  function effectiveDiscount() {
    const edited = draft.discountPerLiterEdited ? parseDecimal(draft.discountPerLiter) : null;
    if (edited !== null && Number.isFinite(edited) && edited >= 0) return edited;
    const fromSheet = Number(hints.discountPerLiter);
    return Number.isFinite(fromSheet) && fromSheet >= 0 ? fromSheet : 0.21;
  }

  function paidPrice() {
    const price = Number(visiblePumpPrice());
    const discount = effectiveDiscount();
    if (!Number.isFinite(price) || price <= 0) return null;
    return Math.max(0, Number((price - discount).toFixed(2)));
  }

  function totals() {
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
    return message || "Błąd synchronizacji.";
  }

  function updateOnlineState() {
    els.onlineState.textContent = navigator.onLine ? "online" : "offline";
  }

  function busyText(action) {
    if (action === "save") return "Wysyłanie do arkusza...";
    if (action === "sync") return "Synchronizacja...";
    if (action === "data") return "Pobieranie danych...";
    return "Praca online...";
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
      { action: "data", element: els.refreshButton }
    ].forEach(function (item) {
      if (!item.element) return;
      item.element.classList.toggle("action-busy", busyAction === item.action);
      item.element.disabled = isBusy;
    });
  }

  function setBusy(action) {
    busyAction = action || "";
    renderBusy();
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
    const distance = distanceSinceLast();
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
    const odometerHint = odometerHintValue();
    const priceHint = pumpPriceHintValue();

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
    setValueState(els.priceButton, !!draft.pumpPrice);

    if (litersActive) {
      els.litersValue.innerHTML = `${keypad.getDisplayHtml()} <span class="unit">l</span>`;
      els.litersValue.classList.toggle("empty", !draft.liters);
    } else if (parseDecimal(draft.liters)) {
      els.litersValue.innerHTML = `${formatLiters(draft.liters)} <span class="unit">l</span>`;
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
    const todayConsumption = completed.today ? parseDecimal(completed.today.consumption) : null;
    const lastConsumption = completed.last ? parseDecimal(completed.last.consumption) : null;
    const latestConsumption = completed.latest ? parseDecimal(completed.latest.consumption) : null;
    const sheetMonthly = parseDecimal(results.monthlyAverage);

    els.todayResultValue.textContent = todayConsumption !== null ? formatConsumption(todayConsumption) : "--";
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
    updateOnlineState();
    renderBusy();
  }

  function renderQueue() {
    if (els.syncButton) els.syncButton.hidden = !queue.length;
    if (!queue.length) {
      els.queueList.textContent = "Brak wpisów w kolejce.";
      return;
    }
    els.queueList.innerHTML = queue.map(function (item) {
      return `
        <div class="queue-item">
          <strong>${item.fuel}</strong>
          <span>${item.refuelDate}, ${item.odometer} km, ${item.liters} l, ${money(item.discountedPrice)} zł</span>
        </div>
      `;
    }).join("");
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
    const date = els.refuelDate.value || todayIso();
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

  async function saveEntry() {
    try {
      draft.date = els.refuelDate.value || todayIso();
      const entry = buildEntry();
      rememberEntryHints(entry);
      const syncSettings = currentSettings({ persist: true });
      const missing = missingSettingsMessage(syncSettings);
      if (missing || !navigator.onLine) {
        queue.push(entry);
        clearEntryDraft();
        saveAll();
        setActiveEdit("odometer");
        toast(missing ? `Wpis w kolejce. ${missing}` : "Wpis zapisany w kolejce offline.");
        return;
      }
      try {
        setBusy("save");
        await verifySyncReady(syncSettings);
        const receipt = await sync.submitEntry(syncSettings, entry);
        applyReceipt(receipt);
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
      setActiveEdit("liters", true);
      return;
    }
    setActiveEdit("odometer", true);
  }

  function bindEvents() {
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    els.inlineKeypad.addEventListener("click", function (event) {
      if (event.target && event.target.closest && event.target.closest("[data-key]")) playSound("keypad");
    }, true);

    els.fuelToggle.addEventListener("click", function () {
      playSound("other");
      draft.fuel = draft.fuel === "LPG" ? "E98" : "LPG";
      saveAll();
      setActiveEdit("odometer");
    });

    els.dateButton.addEventListener("click", function () {
      playSound("other");
      if (typeof els.refuelDate.showPicker === "function") {
        els.refuelDate.showPicker();
      } else {
        els.refuelDate.focus();
        els.refuelDate.click();
      }
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
      setActiveEdit("discount", true);
    });

    els.litersButton.addEventListener("click", function () {
      playSound("field");
      setActiveEdit("liters", true);
    });

    els.saveButton.addEventListener("click", function () {
      playSound("other");
      saveEntry();
    });
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
      "inlineKeypad", "inlineKeypadGrid", "syncWorkingPanel", "syncWorkingText", "appVersionLabel"
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
    ensureDefaultDateForEmptyDraft();
    if (draft.discountPerLiter === undefined) draft.discountPerLiter = null;
    if (draft.discountPerLiterEdited !== true) draft.discountPerLiterEdited = false;
    keypad.init({
      root: els.inlineKeypad,
      onChange: applyKeypadValue,
      onCommit: applyKeypadValue,
      onOk: advanceEditField,
      onClear: clearRefuelInputDraft
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
