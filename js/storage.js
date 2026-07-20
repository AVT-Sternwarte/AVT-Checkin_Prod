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

  function setLogin(login) {
    const mode = String(login?.mode || "day");
    const payload = {
      valid: true,
      mode,
      createdAt: Date.now(),
      sessionToken: String(login?.sessionToken || ""),
      expiresAt: Number(login?.expiresAt || 0)
    };
    const raw = JSON.stringify(payload);

    clearLogin();
    if (mode === "session") sessionStorage.setItem(C.storageKeys.login, raw);
    else localStorage.setItem(C.storageKeys.login, raw);
  }

  function getLogin() {
    let login = null;
    try {
      login = JSON.parse(
        sessionStorage.getItem(C.storageKeys.login) ||
        localStorage.getItem(C.storageKeys.login) ||
        "null"
      );
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

    return login;
  }

  function getSessionToken() {
    return getLogin()?.sessionToken || "";
  }

  function clearLogin() {
    sessionStorage.removeItem(C.storageKeys.login);
    localStorage.removeItem(C.storageKeys.login);
  }

  return { load, save, reset, setLogin, getLogin, getSessionToken, clearLogin };
})();
