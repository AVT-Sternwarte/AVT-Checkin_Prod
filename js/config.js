"use strict";
window.AVT_CONFIG = Object.freeze({
  version: "1.0.0-rc.1",
  qrPrefix: "AVT-CHECKIN-V1:",
  backend: {
    // Hier nach der Apps-Script-Bereitstellung die Produktiv-Web-App-URL mit /exec eintragen.
    // Beispiel: https://script.google.com/macros/s/AKfycb.../exec
    url: "https://script.google.com/macros/s/AKfycbxB_RuOndThOvcWBbDR_GKnI4_s-m1hkSS8JGEyhtsMZcifyMfCqA2Q5Vh_S1RmPMvc_Q/exec",
    enabled: true,
    pollSeconds: 15
  },
  saveFlow: {
    warningSeconds: 8,
    requestTimeoutSeconds: 30,
    verificationSeconds: 3,
    offlineFallbackEnabled: true
  },
  event: {
    id: "",
    title: "Sternführung",
    date: "",
    time: "",
    maxPersons: 65
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
    const parts = String(value || "").split("-");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return "–";
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
  },
  now() { return new Date().toISOString(); },
  clone(value) { return JSON.parse(JSON.stringify(value)); }
});
