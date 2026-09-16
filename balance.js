(function () {
  "use strict";
  const PREFIX = "tankowanie_v2__balance__GOSIA__";
  const CACHE = PREFIX + "snapshot";
  const TRANSACTION = PREFIX + "tx__";
  function read(key, fallback) {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  }
  function transactions() {
    return Object.keys(localStorage).filter(key => key.startsWith(TRANSACTION))
      .map(key => read(key, null)).filter(Boolean);
  }
  function track(id, kind, delta, payload) {
    if (!id || !Number.isFinite(delta)) throw new Error("Nieprawidłowa transakcja salda.");
    const key = TRANSACTION + id;
    const existing = read(key, null);
    if (existing) return existing;
    const transaction = { id, kind, delta: Math.round(delta * 100) / 100, payload, state: "pending" };
    localStorage.setItem(key, JSON.stringify(transaction));
    return transaction;
  }
  function pending() { return transactions().filter(tx => tx.state !== "done"); }
  function applySnapshot(snapshot) {
    if (!snapshot || snapshot.group !== "GOSIA" || typeof snapshot.balance !== "number"
      || !Number.isFinite(snapshot.balance) || !Number.isFinite(snapshot.observedAt)) {
      throw new Error("Nieprawidłowa odpowiedź salda.");
    }
    const previous = read(CACHE, null);
    if (previous && previous.observedAt > snapshot.observedAt) return false;
    // Persist the authoritative balance and acknowledged IDs together.
    localStorage.setItem(CACHE, JSON.stringify(snapshot));
    Object.keys(snapshot.transactions || {}).forEach(id => {
      if (snapshot.transactions[id] !== "done") return;
      const tx = read(TRANSACTION + id, null);
      if (!tx) return;
      tx.state = "done";
      localStorage.setItem(TRANSACTION + id, JSON.stringify(tx));
    });
    return true;
  }
  function view() {
    const snapshot = read(CACHE, null);
    const unresolved = pending().filter(tx => !snapshot || !snapshot.transactions || snapshot.transactions[tx.id] !== "done");
    return {
      value: snapshot ? snapshot.balance + unresolved.reduce((sum, tx) => sum + tx.delta, 0) : null,
      pending: unresolved.length,
      fetched: !!snapshot
    };
  }
  window.TankowanieBalance = { track, pending, transactions, applySnapshot, view };
})();
