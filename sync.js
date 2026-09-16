(function () {
  "use strict";

  function normalizeUrl(url) {
    return String(url || "").trim();
  }

  function appVersion() {
    return window.TankowanieStorage.APP_VERSION;
  }

  function apiVersion() {
    return window.TankowanieStorage.API_VERSION;
  }

  function withClientMeta(params) {
    return Object.assign({
      appVersion: appVersion(),
      apiVersion: apiVersion()
    }, params || {});
  }

  function assertApiCompatible(response) {
    if (!response || response.ok !== true) return;
    if (!response.apiVersion) throw new Error("Missing endpoint API version.");
    if (response.apiVersion !== apiVersion()) throw new Error("Incompatible endpoint API version.");
  }

  function jsonpRequest(url, params) {
    const endpoint = normalizeUrl(url);
    if (!endpoint) return Promise.reject(new Error("Missing Apps Script URL."));
    return new Promise(function (resolve, reject) {
      const callback = `tankowanie_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      let timeout;
      const cleanup = function () {
        window.clearTimeout(timeout);
        delete window[callback];
        script.remove();
      };
      window[callback] = function (payload) {
        cleanup();
        resolve(payload);
      };
      const query = Object.assign({}, params || {}, { callback });
      const qs = Object.keys(query)
        .map(function (key) {
          return `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`;
        })
        .join("&");
      script.onerror = function () {
        cleanup();
        reject(new Error("Network error."));
      };
      timeout = window.setTimeout(function () {
        cleanup();
        reject(new Error("Network timeout."));
      }, 45000);
      script.src = `${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs}`;
      document.body.appendChild(script);
    });
  }

  async function getConfig(settings, context) {
    const request = context || {};
    const response = await jsonpRequest(settings.endpointUrl, withClientMeta({
      action: "config",
      pin: settings.pin,
      requestId: request.requestId || settings.requestId || "",
      profileId: request.profileId || settings.profileId || "BG",
      carId: request.carId || settings.carId || settings.vehicleId || "BG",
      vehicleId: request.carId || settings.carId || settings.vehicleId || "BG",
      fuelId: request.fuelId || settings.fuelId || "",
      userId: request.userId || settings.userId || "BG"
    }));
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "Config failed.");
    }
    assertApiCompatible(response);
    return response;
  }

  async function ping(settings) {
    const response = await jsonpRequest(settings.endpointUrl, withClientMeta({
      action: "ping"
    }));
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "Ping failed.");
    }
    assertApiCompatible(response);
    return response;
  }

  async function debugProps(settings) {
    const response = await jsonpRequest(settings.endpointUrl, withClientMeta({
      action: "debugProps"
    }));
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "Debug failed.");
    }
    assertApiCompatible(response);
    return response;
  }

  async function waitForReceipt(settings, requestId, context) {
    const request = context || {};
    const delays = [700, 1200, 2200, 4000, 6500];
    for (const delay of delays) {
      await new Promise(function (resolve) { setTimeout(resolve, delay); });
      const response = await jsonpRequest(settings.endpointUrl, withClientMeta({
        action: "receipt",
        pin: settings.pin,
        profileId: request.profileId || settings.profileId || "BG",
        carId: request.carId || settings.carId || settings.vehicleId || "BG",
        userId: request.userId || settings.userId || "BG",
        requestId
      }));
      if (response && response.ok === true && response.found) {
        assertApiCompatible(response);
        return response.receipt;
      }
      if (response && response.ok === false) {
        throw new Error(response.error || "Receipt failed.");
      }
      assertApiCompatible(response);
    }
    throw new Error("No write receipt from Apps Script.");
  }

  async function postAction(settings, action, payloadKey, payload) {
    // Each transport attempt polls its own receipt; the payload keeps its durable transaction ID.
    const requestId = (payload.requestId || "request") + "_" + window.TankowanieStorage.createId("attempt");
    const context = {
      profileId: payload && payload.profileId || settings.profileId || "BG",
      carId: payload && (payload.carId || payload.vehicleId) || settings.carId || settings.vehicleId || "BG",
      userId: payload && payload.userId || settings.userId || "BG"
    };
    const body = {
      action,
      appVersion: appVersion(),
      apiVersion: apiVersion(),
      pin: settings.pin,
      profileId: context.profileId,
      carId: context.carId,
      vehicleId: context.carId,
      userId: context.userId,
      requestId
    };
    body[payloadKey] = payload;
    await fetch(normalizeUrl(settings.endpointUrl), {
      method: "POST",
      mode: "no-cors",
      keepalive: false,
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body)
    });
    const receipt = await waitForReceipt(settings, requestId, context);
    if (!receipt || receipt.ok !== true) {
      throw new Error(receipt && receipt.error ? receipt.error : `${action} failed.`);
    }
    return receipt;
  }

  async function submitEntry(settings, entry) {
    if (window.TankowanieStorage.isRetiredTestEntry(entry, settings.carId || settings.vehicleId || settings.profileId)) {
      throw new Error("Stary wpis testowy Caddy jest zablokowany. Nie został wysłany.");
    }
    return postAction(settings, "submitRefuel", "entry", entry);
  }

  async function uploadReceiptScan(settings, receiptScan) {
    return postAction(settings, "uploadReceiptScan", "receipt", receiptScan);
  }

  async function uploadOrphanReceiptScan(settings, receiptScan) {
    return postAction(settings, "uploadOrphanReceiptScan", "receipt", receiptScan);
  }

  window.TankowanieSync = {
    getBalance: async function (settings, transactionIds) {
      const response = await jsonpRequest(settings.endpointUrl, withClientMeta({
        action: "getBalance", pin: settings.pin, profileId: settings.profileId,
        carId: settings.carId, userId: settings.userId,
        transactionIds: JSON.stringify(transactionIds || [])
      }));
      if (!response || !response.ok) throw new Error(response && response.error || "Nie udało się pobrać salda.");
      assertApiCompatible(response);
      return response;
    },
    addDeposit: function (settings, deposit) {
      return postAction(settings, "addDeposit", "deposit", deposit);
    },
    getConfig,
    ping,
    debugProps,
    submitEntry,
    uploadReceiptScan,
    uploadOrphanReceiptScan
  };
})();
