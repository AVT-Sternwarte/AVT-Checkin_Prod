"use strict";
/* Progressive-Web-App Updates ohne neue Start-URL oder Neuinstallation. */
(function () {
  const cfg = window.AVT_CONFIG;
  const localVersion = String(cfg?.version || "");
  const seenKey = "avt-checkin-prod-release-last-seen-v1";
  const $ = id => document.getElementById(id);
  let remote = null;
  let deferred = false;
  let inFlight = false;
  let serviceRegistration = null;
  const fallbackChanges = [
    "Eingecheckte Anmeldungen und unangemeldete Besucher können nachträglich korrigiert werden.",
    "Spenden lassen sich korrigieren oder stornieren.",
    "Bei künftigen Versionen wird automatisch ein Update-Hinweis angezeigt."
  ];

  function cleanVersion(value) { return String(value || "").trim(); }
  // Bei einer gestaffelten GitHub-Veröffentlichung kann version.json noch die
  // vorherige Version melden. Niemals ein Downgrade als Update anbieten.
  function isNewerVersion(candidate, installed) {
    const parts = value => (String(value || "").match(/^(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
    const a = parts(candidate), b = parts(installed);
    if (a.length !== 3 || b.length !== 3) return false;
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return false;
  }
  function validInfo(obj) {
    return obj && typeof obj === "object" && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][a-zA-Z0-9.]+)?$/.test(cleanVersion(obj.version));
  }
  function safeString(value) { return String(value || "").slice(0, 180); }
  function showRelease(info) {
    const dialog = $("avtReleaseDialog");
    if (!dialog) return;
    $("avtReleaseHeading").textContent = "Neu in AVT Check-in " + localVersion;
    $("avtReleaseLead").textContent = safeString(info?.headline || "Die Anwendung wurde aktualisiert.");
    const list = $("avtReleaseNotes");
    list.replaceChildren();
    const changes = Array.isArray(info?.changes) ? info.changes : fallbackChanges;
    changes.slice(0, 8).forEach(item => {
      const li = document.createElement("li");
      li.textContent = safeString(item);
      list.appendChild(li);
    });
    dialog.classList.remove("hidden");
    $("avtReleaseCloseBtn").focus();
  }
  function showUpdate(info) {
    remote = info;
    if (deferred) return;
    const banner = $("avtUpdateBanner");
    if (!banner) return;
    $("avtUpdateBannerVersion").textContent = `Version ${safeString(info.version)} – ${safeString(info.headline || "Aktualisierung")}`;
    banner.classList.remove("hidden");
  }
  async function checkUpdate() {
    if (inFlight || !navigator.onLine) return;
    inFlight = true;
    try {
      const response = await fetch(`version.json?avt_check=${Date.now()}`, { cache:"no-store" });
      if (!response.ok) return;
      const info = await response.json();
      if (!validInfo(info)) return;
      if (isNewerVersion(info.version, localVersion)) showUpdate(info);
      else if (cleanVersion(info.version) === localVersion &&
          (!localStorage.getItem(seenKey) || localStorage.getItem(seenKey) !== localVersion)) {
        showRelease(info);
      }
    } catch (_) { /* Offline/temporärer Fehler: keine Unterbrechung des Einlasses */ }
    finally { inFlight = false; }
  }
  async function applyUpdate() {
    if (window.AVT_BACKEND?.queueCount?.() > 0) {
      alert("Noch nicht synchronisierte Check-ins oder Spenden vorhanden. Bitte zuerst synchronisieren, dann aktualisieren.");
      return;
    }
    if (!navigator.onLine) {
      alert("Zum Aktualisieren wird eine Internetverbindung benötigt.");
      return;
    }
    // Neustart nur nach ausdrücklichem Klick – niemals während eines Vorgangs automatisch.
    $("avtUpdateNowBtn").disabled = true;
    try {
      if (serviceRegistration) await serviceRegistration.update();
      window.location.reload();
    } catch (_) {
      $("avtUpdateNowBtn").disabled = false;
      alert("Die neue Version konnte noch nicht geladen werden. Bitte später erneut versuchen.");
    }
  }
  function init() {
    $("avtUpdateNowBtn")?.addEventListener("click", applyUpdate);
    $("avtUpdateLaterBtn")?.addEventListener("click", () => {
      deferred = true;
      $("avtUpdateBanner")?.classList.add("hidden");
    });
    $("avtReleaseCloseBtn")?.addEventListener("click", () => {
      $("avtReleaseDialog")?.classList.add("hidden");
      try { localStorage.setItem(seenKey, localVersion); } catch (_) {}
    });
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./service-worker.js", {updateViaCache:"none"})
        .then(reg => { serviceRegistration = reg; return reg.update(); })
        .catch(() => {});
    }
    checkUpdate();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { deferred = false; checkUpdate(); } });
    window.addEventListener("pageshow", () => { deferred = false; checkUpdate(); });
    window.addEventListener("online", checkUpdate);
    window.setInterval(() => { if (!document.hidden) checkUpdate(); }, 5 * 60 * 1000);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
