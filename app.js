(function () {
  "use strict";

  const storage = window.TankowanieStorage;
  const keypad = window.TankowanieKeypad;
  const sync = window.TankowanieSync;

  const els = {};
  const FUELS = ["LPG", "E98"];
  let settings = storage.getSettings();
  let draft = storage.getDraft();
  let queue = storage.getQueue();
  let hints = normalizeHints(storage.getHints());
  let results = storage.getResults();
  let activeEdit = "odometer";
  let keypadReady = false;

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
    const normalized = String(value || "").replace(",", ".").trim();
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

  function normalizeHints(value) {
    const base = Object.assign({
      discountPerLiter: 0.21,
      latestOdometer: null,
      fuels: {}
    }, value || {});
    base.fuels = Object.assign({
      LPG: { suggestedPumpPrice: null, lastPaidPrice: null, lastOdometer: null },
      E98: { suggestedPumpPrice: null, lastPaidPrice: null, lastOdometer: null }
    }, base.fuels || {});
    base.fuels.LPG = Object.assign({ suggestedPumpPrice: null, lastPaidPrice: null, lastOdometer: null }, base.fuels.LPG || {});
    base.fuels.E98 = Object.assign({ suggestedPumpPrice: null, lastPaidPrice: null, lastOdometer: null }, base.fuels.E98 || {});
    return base;
  }

  function activeFuelHints() {
    return hints.fuels[draft.fuel] || {};
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
    const edited = parseDecimal(draft.discountPerLiter);
    if (Number.isFinite(edited) && edited >= 0) return edited;
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

  function hasMissingPreviousData() {
    return FUELS.some(function (fuel) {
      return !previousOdometerForFuel(fuel);
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
    if (message.includes("TANKOWANIE_PIN value is empty")) {
      return "Apps Script: właściwość TANKOWANIE_PIN istnieje, ale nie ma wartości.";
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
        value: draft.discountPerLiter
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
      els.pumpPriceValue.innerHTML = `${keypad.getDisplayHtml()} <span class="unit">zł</span>`;
      els.pumpPriceValue.classList.toggle("stale", !draft.pumpPrice && !!priceHint);
      els.pumpPriceValue.classList.toggle("empty", !draft.pumpPrice && !priceHint);
    } else if (draft.pumpPrice) {
      els.pumpPriceValue.innerHTML = `${money(draft.pumpPrice)} <span class="unit">zł</span>`;
      els.pumpPriceValue.classList.remove("stale", "empty");
    } else {
      els.pumpPriceValue.innerHTML = priceHint
        ? `<span class="edit-hint is-stale">${money(priceHint)}</span> <span class="unit">zł</span>`
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
    const provisional = localConsumption();
    if (provisional) {
      els.lastLpgResult.textContent = formatConsumption(provisional);
      els.lastSheetRead.textContent = "";
    } else {
      els.lastLpgResult.textContent = results.lastLpgResult || "--";
      els.lastSheetRead.textContent = results.lastReadAt || "";
    }
    els.monthlyAverage.textContent = results.monthlyAverage || "--";
    els.monthlyHeading.textContent = results.monthlyLabel || "średnio Czerwiec";
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
    els.fuelLpg.classList.toggle("active", draft.fuel === "LPG");
    els.fuelE98.classList.toggle("active", draft.fuel === "E98");
    els.refuelDate.value = draft.date || todayIso();
    setValueState(els.refuelDate, !!els.refuelDate.value);

    renderEditableFields();
    renderResults();
    renderTotals();

    els.endpointInput.value = settings.endpointUrl || "";
    els.pinInput.value = settings.pin || "";
    els.syncState.textContent = results.lastSyncAt ? `sync ${results.lastSyncAt}` : "brak sync";
    els.queueState.textContent = `q: ${queue.length}`;
    renderQueue();
    updateOnlineState();
  }

  function renderQueue() {
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
    hints.discountPerLiter = Number(config.discountPerLiter || hints.discountPerLiter || 0.21);
    hints.latestOdometer = config.latestOdometer || hints.latestOdometer || null;
    hints.fuels = normalizeHints({ fuels: config.fuels || hints.fuels }).fuels;
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
    const config = await sync.getConfig(syncSettings);
    applyConfig(config);
    if (!silent) toast("Dane pobrane z arkusza.");
    return config;
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
    fuelHint.suggestedPumpPrice = entry.pumpPrice;
    fuelHint.lastPaidPrice = entry.discountedPrice;
    fuelHint.lastOdometer = entry.odometer;
    hints.fuels[entry.fuel] = fuelHint;
    hints.latestOdometer = Math.max(Number(hints.latestOdometer || 0), entry.odometer);
  }

  function clearEntryDraft() {
    draft.odometer = null;
    draft.pumpPrice = null;
    draft.discountPerLiter = null;
    draft.liters = "";
    draft.date = todayIso();
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
    try {
      const config = await verifySyncReady(syncSettings);
      applyConfig(config);
    } catch (error) {
      toast(friendlySyncError(error));
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
    if (!remaining.length) queue = [];
    else queue = remaining;
    saveAll();
    render();
    if (sent > 0) toast(`Wysłano wpisy: ${sent}.`);
  }

  function applyKeypadValue(payload) {
    if (payload.mode === "price") {
      draft.pumpPrice = payload.hasInput ? Number(payload.value.toFixed(2)) : null;
    } else if (payload.mode === "discount") {
      draft.discountPerLiter = payload.hasInput ? Number(payload.value.toFixed(2)) : null;
    } else if (payload.mode === "liters") {
      draft.liters = payload.hasInput ? payload.value.toFixed(2) : "";
    } else {
      draft.odometer = payload.hasInput ? Math.trunc(payload.value) : null;
    }
    saveAll();
    render();
  }

  function bindEvents() {
    window.addEventListener("online", updateOnlineState);
    window.addEventListener("offline", updateOnlineState);

    [els.fuelLpg, els.fuelE98].forEach(function (button) {
      button.addEventListener("click", function () {
        draft.fuel = button.dataset.fuel;
        saveAll();
        setActiveEdit("odometer");
      });
    });

    els.refuelDate.addEventListener("change", function () {
      draft.date = els.refuelDate.value;
      saveAll();
      render();
    });

    els.odometerButton.addEventListener("click", function () {
      setActiveEdit("odometer", true);
    });

    els.priceButton.addEventListener("click", function () {
      setActiveEdit("price", true);
    });

    els.discountButton.addEventListener("click", function () {
      setActiveEdit("discount", true);
    });

    els.litersButton.addEventListener("click", function () {
      setActiveEdit("liters", true);
    });

    els.saveButton.addEventListener("click", saveEntry);
    els.syncButton.addEventListener("click", syncQueue);
    els.refreshButton.addEventListener("click", function () {
      refreshConfig().catch(function (error) {
        toast(friendlySyncError(error) || "Nie udało się pobrać danych.");
      });
    });

    els.settingsToggle.addEventListener("click", function () {
      els.settingsPanel.hidden = !els.settingsPanel.hidden;
    });

    els.saveSettingsButton.addEventListener("click", function () {
      settings.endpointUrl = els.endpointInput.value.trim();
      settings.pin = els.pinInput.value.trim();
      storage.saveSettings(settings);
      render();
      toast("Ustawienia zapisane.");
      maybeAutoRefreshConfig();
    });

    els.testSettingsButton.addEventListener("click", async function () {
      settings.endpointUrl = els.endpointInput.value.trim();
      settings.pin = els.pinInput.value.trim();
      storage.saveSettings(settings);
      try {
        await sync.ping(settings);
        try {
          const props = await sync.debugProps(settings);
          if (props && props.hasTankowaniePinKey === false) {
            throw new Error("TANKOWANIE_PIN is not configured.");
          }
          if (props && props.hasTankowaniePinValue === false) {
            throw new Error("TANKOWANIE_PIN value is empty.");
          }
        } catch (debugError) {
          const debugMessage = String(debugError && debugError.message || debugError);
          if (
            debugMessage.includes("TANKOWANIE_PIN is not configured")
            || debugMessage.includes("TANKOWANIE_PIN value is empty")
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
      "monthlyLabel", "monthlyHeading", "lastLpgResult", "lastSheetRead", "fuelLpg",
      "fuelE98", "refuelDate", "odometerButton", "odometerValue", "distanceValue",
      "priceButton", "pumpPriceValue", "discountButton", "discountValue",
      "paidPriceValue", "litersButton", "litersValue", "pumpTotalValue",
      "discountTotalValue", "paidTotalValue", "saveButton", "syncButton",
      "refreshButton", "settingsPanel", "endpointInput", "pinInput",
      "saveSettingsButton", "testSettingsButton", "queueList", "toast",
      "inlineKeypad"
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
    if (!draft.date) draft.date = todayIso();
    if (draft.discountPerLiter === undefined) draft.discountPerLiter = null;
    keypad.init({
      root: els.inlineKeypad,
      onChange: applyKeypadValue,
      onCommit: applyKeypadValue
    });
    keypadReady = true;
    bindEvents();
    setActiveEdit("odometer");
    registerServiceWorker();
    window.setTimeout(maybeAutoRefreshConfig, 300);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
