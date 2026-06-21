(function () {
  "use strict";

  let active = null;
  let callbacks = {
    onChange: function () {},
    onCommit: function () {}
  };
  let ui = {};

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeDigits(value, minLength) {
    const raw = String(Math.max(0, Math.trunc(Number(value) || 0)));
    const length = Math.max(minLength, raw.length);
    return raw.padStart(length, "0").split("");
  }

  function isDecimalMode(mode) {
    return mode === "price" || mode === "liters" || mode === "discount";
  }

  function scaledDecimal(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.round(numeric * 100));
  }

  function formatScaledDecimal(value) {
    return (value / 100).toFixed(2).replace(".", ",");
  }

  function formattedValue() {
    if (!active) return "--";
    if (active.empty && !active.entered.length) return "--";
    const raw = Number(active.currentDigits.join(""));
    return isDecimalMode(active.mode) ? formatScaledDecimal(raw) : active.currentDigits.join("");
  }

  function currentValue() {
    if (!active) return null;
    const raw = Number(active.currentDigits.join(""));
    return isDecimalMode(active.mode) ? raw / 100 : raw;
  }

  function rebuildDigits() {
    const result = active.baseDigits.slice();
    const entered = active.entered;
    const offset = Math.max(0, result.length - entered.length);
    for (let i = 0; i < entered.length; i += 1) {
      result[offset + i] = entered[i];
    }
    active.currentDigits = result;
  }

  function splitDisplay() {
    const body = formattedValue();
    if (!active || !body || body === "--") {
      return { prefix: "", changed: "--", cursor: "", baseOnly: true, empty: true };
    }

    if (!active.entered.length) {
      return {
        prefix: body.slice(0, -1),
        changed: "",
        cursor: body.slice(-1),
        baseOnly: true
      };
    }

    if (isDecimalMode(active.mode)) {
      const suffixLength = Math.min(body.length, active.entered.length + (active.entered.length >= 3 ? 1 : 0));
      const suffix = body.slice(-suffixLength);
      return {
        prefix: body.slice(0, -suffixLength),
        changed: suffix.slice(0, -1),
        cursor: suffix.slice(-1),
        baseOnly: false
      };
    }

    const splitAt = Math.max(0, body.length - active.entered.length);
    const changed = body.slice(splitAt);
    return {
      prefix: body.slice(0, splitAt),
      changed: changed.slice(0, -1),
      cursor: changed.slice(-1),
      baseOnly: false
    };
  }

  function displayHtml() {
    const parts = splitDisplay();
    if (parts.empty) return '<span class="empty">--</span>';
    const baseClass = active && active.baseIsHint ? "edit-hint is-stale" : "edit-hint";
    const cursorClass = parts.baseOnly && active && active.baseIsHint
      ? "cursor-digit is-stale"
      : "cursor-digit";
    return [
      `<span class="${baseClass}">${escapeHtml(parts.prefix)}</span>`,
      parts.changed ? `<span class="edit-entered">${escapeHtml(parts.changed)}</span>` : "",
      `<span class="${cursorClass}">${escapeHtml(parts.cursor)}</span>`
    ].join("");
  }

  function render() {
    if (!active) return;
    if (ui.activeLabel) ui.activeLabel.textContent = active.label;
    if (ui.activeValue) ui.activeValue.innerHTML = displayHtml();
  }

  function notify(isCommit) {
    if (!active) return;
    const payload = {
      mode: active.mode,
      value: currentValue(),
      hasInput: active.entered.length > 0 || !active.baseIsHint,
      displayHtml: displayHtml()
    };
    callbacks.onChange(payload);
    if (isCommit) callbacks.onCommit(payload);
  }

  function setMode(options) {
    const mode = options.mode === "price"
      ? "price"
      : options.mode === "liters" ? "liters"
        : options.mode === "discount" ? "discount" : "odometer";
    const maxDigits = mode === "odometer" ? 6 : mode === "liters" ? 5 : 4;
    const hasValue = options.value !== null && options.value !== undefined && options.value !== "";
    const hasHint = options.hint !== null && options.hint !== undefined && options.hint !== "" && Number(options.hint) > 0;
    const baseValue = hasValue
      ? options.value
      : hasHint ? options.hint : 0;
    const normalizedValue = isDecimalMode(mode) ? scaledDecimal(baseValue) : Number(baseValue) || 0;
    const fallbackValue = hasHint ? (isDecimalMode(mode) ? scaledDecimal(options.hint) : Number(options.hint) || 0) : 0;

    active = {
      mode,
      label: options.label || "",
      baseIsHint: !hasValue,
      empty: !hasValue && !hasHint,
      fallbackEmpty: !hasHint,
      fallbackDigits: normalizeDigits(fallbackValue, maxDigits),
      baseDigits: normalizeDigits(normalizedValue, maxDigits),
      currentDigits: normalizeDigits(normalizedValue, maxDigits),
      entered: [],
      maxDigits
    };
    render();
  }

  function press(key) {
    if (!active) return;
    if (key === "ok") {
      notify(true);
      render();
      return;
    }
    if (key === "back") {
      if (active.entered.length) {
        active.entered.pop();
      } else if (!active.baseIsHint) {
        active.baseIsHint = true;
        active.empty = active.fallbackEmpty;
        active.baseDigits = active.fallbackDigits.slice();
      }
      rebuildDigits();
      notify(false);
      render();
      return;
    }
    if (/^[0-9]$/.test(key)) {
      active.entered.push(key);
      if (active.entered.length > active.maxDigits) {
        active.entered.shift();
      }
      rebuildDigits();
      notify(false);
      render();
    }
  }

  function init(options) {
    ui = {
      root: options.root || null,
      activeLabel: options.activeLabel || null,
      activeValue: options.activeValue || null
    };
    callbacks = {
      onChange: typeof options.onChange === "function" ? options.onChange : function () {},
      onCommit: typeof options.onCommit === "function" ? options.onCommit : function () {}
    };
    if (ui.root) {
      ui.root.querySelectorAll("[data-key]").forEach(function (button) {
        button.addEventListener("click", function () {
          button.classList.add("pressed");
          window.setTimeout(function () {
            button.classList.remove("pressed");
          }, 110);
          press(button.dataset.key);
        });
      });
    }
  }

  function getMode() {
    return active ? active.mode : "";
  }

  function getDisplayHtml() {
    return active ? displayHtml() : "--";
  }

  window.TankowanieKeypad = {
    init,
    setMode,
    press,
    getMode,
    getDisplayHtml
  };
})();
