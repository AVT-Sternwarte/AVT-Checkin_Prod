"use strict";
window.AVT_STORE = (function () {
  const C = window.AVT_CONFIG;

  function blank() {
    return { checkins: {}, manual: [], donations: [], sequence: 1 };
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(C.storageKeys.data)) || blank(); }
    catch { return blank(); }
  }

  function save(data) {
    localStorage.setItem(C.storageKeys.data, JSON.stringify(data));
  }

  function reset() {
    const data = blank();
    save(data);
    return data;
  }

  function loginBackupKey() {
    return C.storageKeys.loginBackup || `${C.storageKeys.login}-backup`;
  }

  function setLogin(login) {
    const mode = String(login?.mode || "day");
    const payload = {
      valid: true,
      mode,
      createdAt: Date.now(),
      sessionToken: String(login?.sessionToken || ""),
      expiresAt: mode === "permanent" ? 0 : Number(login?.expiresAt || 0)
    };
    const raw = JSON.stringify(payload);

    clearLogin();

    if (mode === "session") {
      sessionStorage.setItem(C.storageKeys.login, raw);
      return;
    }

    // Für „heute“ und „dauerhaft“ wird der Sitzungstoken in einem
    // versionsunabhängigen lokalen Schlüssel gespeichert. Ein zweiter
    // Schlüssel dient als Rückfallebene, falls ein Browser beim Aktualisieren
    // nur einen einzelnen Eintrag verliert.
    localStorage.setItem(C.storageKeys.login, raw);
    localStorage.setItem(loginBackupKey(), raw);
  }

  function getLogin() {
    let login = null;
    let raw = "";

    try {
      raw =
        sessionStorage.getItem(C.storageKeys.login) ||
        localStorage.getItem(C.storageKeys.login) ||
        localStorage.getItem(loginBackupKey()) ||
        "";

      login = raw ? JSON.parse(raw) : null;
    } catch {}

    if (!login?.valid || !login.sessionToken) return null;

    if (login.expiresAt && Date.now() > Number(login.expiresAt)) {
      clearLogin();
      return null;
    }

    if (login.mode === "day") {
      const created = new Date(login.createdAt);
      const now = new Date();
      if (created.toDateString() !== now.toDateString()) {
        clearLogin();
        return null;
      }
    }

    // Nach einem normalen Seiten-Refresh den primären lokalen Schlüssel
    // gegebenenfalls aus der Rückfallebene wiederherstellen.
    if (
      login.mode !== "session" &&
      !localStorage.getItem(C.storageKeys.login)
    ) {
      localStorage.setItem(C.storageKeys.login, JSON.stringify(login));
    }

    return login;
  }

  function getSessionToken() {
    return getLogin()?.sessionToken || "";
  }

  function clearLogin() {
    sessionStorage.removeItem(C.storageKeys.login);
    localStorage.removeItem(C.storageKeys.login);
    localStorage.removeItem(loginBackupKey());
  }

  return { load, save, reset, setLogin, getLogin, getSessionToken, clearLogin };
})();
