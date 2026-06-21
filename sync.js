(function () {
  "use strict";

  function normalizeUrl(url) {
    return String(url || "").trim();
  }

  function jsonpRequest(url, params) {
    const endpoint = normalizeUrl(url);
    if (!endpoint) return Promise.reject(new Error("Missing Apps Script URL."));
    return new Promise(function (resolve, reject) {
      const callback = `tankowanie_cb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script = document.createElement("script");
      const cleanup = function () {
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
      script.src = `${endpoint}${endpoint.includes("?") ? "&" : "?"}${qs}`;
      document.body.appendChild(script);
    });
  }

  async function getConfig(settings) {
    const response = await jsonpRequest(settings.endpointUrl, {
      action: "config",
      pin: settings.pin,
      appVersion: window.TankowanieStorage.APP_VERSION
    });
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "Config failed.");
    }
    return response;
  }

  async function ping(settings) {
    const response = await jsonpRequest(settings.endpointUrl, {
      action: "ping",
      appVersion: window.TankowanieStorage.APP_VERSION
    });
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "Ping failed.");
    }
    return response;
  }

  async function debugProps(settings) {
    const response = await jsonpRequest(settings.endpointUrl, {
      action: "debugProps",
      appVersion: window.TankowanieStorage.APP_VERSION
    });
    if (!response || response.ok !== true) {
      throw new Error(response && response.error ? response.error : "Debug failed.");
    }
    return response;
  }

  async function waitForReceipt(settings, requestId) {
    const delays = [700, 1200, 2200, 4000, 6500];
    for (const delay of delays) {
      await new Promise(function (resolve) { setTimeout(resolve, delay); });
      const response = await jsonpRequest(settings.endpointUrl, {
        action: "receipt",
        pin: settings.pin,
        requestId
      });
      if (response && response.ok === true && response.found) {
        return response.receipt;
      }
      if (response && response.ok === false) {
        throw new Error(response.error || "Receipt failed.");
      }
    }
    throw new Error("No write receipt from Apps Script.");
  }

  async function submitEntry(settings, entry) {
    const requestId = window.TankowanieStorage.createId("request");
    await fetch(normalizeUrl(settings.endpointUrl), {
      method: "POST",
      mode: "no-cors",
      keepalive: false,
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "submitRefuel",
        pin: settings.pin,
        requestId,
        entry
      })
    });
    const receipt = await waitForReceipt(settings, requestId);
    if (!receipt || receipt.ok !== true) {
      throw new Error(receipt && receipt.error ? receipt.error : "Submit failed.");
    }
    return receipt;
  }

  window.TankowanieSync = {
    getConfig,
    ping,
    debugProps,
    submitEntry
  };
})();
