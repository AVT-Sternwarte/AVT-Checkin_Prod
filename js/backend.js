"use strict";

window.AVT_BACKEND = (function () {
  const C = window.AVT_CONFIG;
  const U = window.AVT_UTIL;
  const API_TIMEOUT_MS = Math.max(10000, Number(C.saveFlow?.requestTimeoutSeconds || 30) * 1000);

  function isConfigured() {
    return Boolean(
      C.backend?.enabled &&
      C.backend?.url &&
      !String(C.backend.url).includes("HIER_")
    );
  }

  function callbackName() {
    return "avtCb_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2);
  }

  function apiError(result, fallback = "Backendfehler.") {
    const error = new Error(result?.error || fallback);
    error.code = result?.code || "BACKEND_ERROR";
    return error;
  }

  function rawRequest(action, payload = {}) {
    if (!isConfigured()) {
      const error = new Error("Das Produktivbackend ist noch nicht konfiguriert.");
      error.code = "BACKEND_NOT_CONFIGURED";
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      const callback = callbackName();
      const script = document.createElement("script");
      const url = new URL(C.backend.url);
      url.searchParams.set("callback", callback);
      url.searchParams.set("action", action);
      url.searchParams.set("payload", JSON.stringify(payload || {}));
      url.searchParams.set("_", Date.now().toString());

      const timer = window.setTimeout(() => {
        cleanup();
        const error = new Error("Backend antwortet nicht.");
        error.code = "BACKEND_TIMEOUT";
        reject(error);
      }, API_TIMEOUT_MS);

      function cleanup() {
        window.clearTimeout(timer);
        try { delete window[callback]; } catch { window[callback] = undefined; }
        script.remove();
      }

      window[callback] = result => {
        cleanup();
        if (!result || result.ok === false) {
          reject(apiError(result));
          return;
        }
        resolve(result);
      };

      script.onerror = () => {
        cleanup();
        const error = new Error("Backend konnte nicht erreicht werden.");
        error.code = "BACKEND_UNREACHABLE";
        reject(error);
      };

      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  function request(action, payload = {}) {
    const login = window.AVT_STORE?.getLogin?.();
    return rawRequest(action, {
      ...(payload || {}),
      sessionToken: payload?.sessionToken || login?.sessionToken || ""
    });
  }

  function isAuthError(error) {
    return [
      "AUTH_REQUIRED",
      "LOGIN_EXPIRED",
      "LOGIN_INVALID",
      "LOGIN_FAILED",
      "LOGIN_NOT_CONFIGURED"
    ].includes(String(error?.code || ""));
  }

  async function sha256Hex(text) {
    if (!window.crypto?.subtle || !window.TextEncoder) {
      const error = new Error("Dieser Browser unterstützt die sichere Anmeldung nicht.");
      error.code = "CRYPTO_UNAVAILABLE";
      throw error;
    }
    const bytes = new TextEncoder().encode(String(text || ""));
    const digest = await window.crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest))
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  async function login(password, rememberMode) {
    const challenge = await rawRequest("challenge", {});
    const responseHash = await sha256Hex(String(password || "") + ":" + challenge.nonce);
    return rawRequest("login", {
      challengeId: challenge.challengeId,
      responseHash,
      rememberMode: rememberMode || "day"
    });
  }

  async function logout(sessionToken) {
    if (!isConfigured() || !sessionToken) return { ok: true };
    return rawRequest("logout", { sessionToken });
  }

  function loadCached() {
    try {
      return JSON.parse(localStorage.getItem(C.storageKeys.cachedBackend) || "null");
    } catch {
      return null;
    }
  }

  function saveCached(snapshot) {
    localStorage.setItem(C.storageKeys.cachedBackend, JSON.stringify({
      ...snapshot,
      cachedAt: U.now()
    }));
  }

  function clearCached() {
    localStorage.removeItem(C.storageKeys.cachedBackend);
  }

  function getQueue() {
    try {
      return JSON.parse(localStorage.getItem(C.storageKeys.offlineQueue) || "[]");
    } catch {
      return [];
    }
  }

  function setQueue(queue) {
    localStorage.setItem(C.storageKeys.offlineQueue, JSON.stringify(queue || []));
  }

  function queueCount() {
    return getQueue().length;
  }

  function getDeviceId() {
    let id = localStorage.getItem(C.storageKeys.deviceId);
    if (!id) {
      id = "dev-" + Math.random().toString(36).slice(2, 10) + "-" + Date.now().toString(36);
      localStorage.setItem(C.storageKeys.deviceId, id);
    }
    return id;
  }

  function newOperationId() {
    return getDeviceId() + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
  }

  async function ping() {
    return rawRequest("ping", { deviceId: getDeviceId() });
  }

  async function bootstrap() {
    const result = await request("bootstrap", { deviceId: getDeviceId() });
    saveCached(result.data);
    return result.data;
  }

  async function state() {
    const result = await request("state", { deviceId: getDeviceId() });
    saveCached(result.data);
    return result.data;
  }

  function prepareOperation(action, payload = {}) {
    return {
      operationId: payload.operationId || newOperationId(),
      action,
      payload: {
        ...payload,
        deviceId: getDeviceId()
      },
      createdAt: U.now()
    };
  }

  async function sendPrepared(operation) {
    const result = await request(operation.action, operation);
    if (result.data) saveCached(result.data);
    return { ...result, operation };
  }

  function enqueuePrepared(operation) {
    const queue = getQueue();
    if (!queue.some(item => item.operationId === operation.operationId)) {
      queue.push(operation);
      setQueue(queue);
    }
    return operation;
  }

  function removeQueued(operationId) {
    setQueue(getQueue().filter(item => item.operationId !== operationId));
  }

  function isQueued(operationId) {
    return getQueue().some(item => item.operationId === operationId);
  }

  async function syncQueue() {
    const queue = getQueue();
    if (!queue.length) {
      return { ok: true, synced: 0, failed: 0, errors: [], syncedOperations: [] };
    }

    const remaining = [];
    const errors = [];
    const syncedOperations = [];

    for (const operation of queue) {
      try {
        await request(operation.action, operation);
        syncedOperations.push({
          operationId: operation.operationId,
          action: operation.action
        });
      } catch (error) {
        if (isAuthError(error)) throw error;
        remaining.push(operation);
        errors.push({
          operationId: operation.operationId,
          action: operation.action,
          error: error.message
        });
      }
    }

    setQueue(remaining);
    const fresh = await state().catch(error => {
      if (isAuthError(error)) throw error;
      return null;
    });

    return {
      ok: true,
      synced: syncedOperations.length,
      failed: remaining.length,
      errors,
      syncedOperations,
      data: fresh
    };
  }

  return {
    isConfigured,
    isAuthError,
    login,
    logout,
    request,
    ping,
    bootstrap,
    state,
    prepareOperation,
    sendPrepared,
    enqueuePrepared,
    removeQueued,
    isQueued,
    loadCached,
    saveCached,
    clearCached,
    getQueue,
    setQueue,
    queueCount,
    syncQueue,
    getDeviceId,
    newOperationId
  };
})();
