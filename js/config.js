"use strict";
window.AVT_CONFIG = Object.freeze({
  version: "1.0.0-rc.5",
  qrPrefix: "AVT-CHECKIN-V1:",
  backend: {
    // Hier nach der Apps-Script-Bereitstellung die Produktiv-Web-App-URL mit /exec eintragen.
    // Beispiel: https://script.google.com/macros/s/AKfycb.../exec
    url: "https://script.google.com/macros/s/AKfycbxB_RuOndThOvcWBbDR_GKnI4_s-m1hkSS8JGEyhtsMZcifyMfCqA2Q5Vh_S1RmPMvc_Q/exec",
    enabled: true,
    pollSeconds: 15
  },
  saveFlow: {
    warningSeconds: 10,
    requestTimeoutSeconds: 30,
    verificationSeconds: 3,
    offlineFallbackEnabled: true
  },
  event: {
    id: "",
    title: "Sternführung",
    date: "",
    dateDisplay: "",
    time: "",
    maxPersons: 65,
    registrationEnabled: null,
    registrationDisabledReason: "",
    backendVersion: ""
  },
  prices: {
    adult: 5,
    child: 2,
    youth: 2,
    student: 2,
    family: 10
  },
  familyRule: {
    minAdults: 1,
    minReducedPersons: 1,
    requireRegularPriceAboveFamilyPrice: true
  },
  correctionReasons: [
    {
      id: "member",
      label: "Vereinsmitglied",
      active: true,
      order: 1,
      defaultAmount: 0,
      amountRequired: false
    },
    {
      id: "other",
      label: "Sonstiges",
      active: true,
      order: 99,
      defaultAmount: null,
      amountRequired: true
    }
  ],
  storageKeys: {
    login: "avt-checkin-prod-login-v1",
    loginBackup: "avt-checkin-prod-login-backup-v1",
    data: "avt-checkin-prod-local-data-v1",
    cachedBackend: "avt-checkin-prod-cached-backend-v1",
    offlineQueue: "avt-checkin-prod-offline-queue-v1",
    deviceId: "avt-checkin-prod-device-id-v1"
  }
});
window.AVT_REGISTRATIONS = Object.freeze([]);
window.AVT_UTIL = Object.freeze({
  esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  },
  sumCounts(counts) {
    return Object.values(counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  },
  euro(value) {
    return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(Number(value) || 0);
  },
  date(value) {
    const text = String(value || "").trim();
    if (!text) return "–";

    let match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(text);
    if (match) return `${match[3]}.${match[2]}.${match[1]}`;

    match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    if (match) return text;

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        day: "2-digit",
        month: "2-digit",
        year: "numeric"
      }).format(parsed);
    }

    return text;
  },
  time(value) {
    const text = String(value || "").trim();
    if (!text) return "–";

    let match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text);
    if (match) return `${match[1].padStart(2, "0")}:${match[2]}`;

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat("de-DE", {
        timeZone: "Europe/Berlin",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(parsed);
    }

    return text.length >= 5 ? text.substring(0, 5) : text;
  },
  now() { return new Date().toISOString(); },
  clone(value) { return JSON.parse(JSON.stringify(value)); }
});
