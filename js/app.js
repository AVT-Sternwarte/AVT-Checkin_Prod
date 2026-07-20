"use strict";
(function () {
  const C = window.AVT_CONFIG;
  const U = window.AVT_UTIL;
  const S = window.AVT_STORE;
  const SC = window.AVT_SCANNER;
  const $ = id => document.getElementById(id);

  const panels = ["homePanel", "scanPanel", "searchPanel", "manualPanel", "donationPanel", "resultPanel", "overviewPanel"];
  const navigablePanels = new Set(["scan", "search", "manual", "donation", "overview"]);
  const categories = {
    adult: { label: "Erwachsene", price: C.prices.adult },
    child: { label: "Kinder unter 6", price: C.prices.child },
    youth: { label: "Jugendliche / Schüler:innen", price: C.prices.youth },
    student: { label: "Studierende", price: C.prices.student }
  };
  const correctionReasons = (C.correctionReasons || [])
    .filter(reason => reason.active !== false)
    .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));

  let data = S.load();
  let current = null;
  let counts = null;
  let tariffMode = "regular";
  let correctedEntry = "";
  let correctionReason = "";
  let showAllCategories = false;
  let searchFilter = "open";
  let activeNav = "";
  let modalResolve = null;
  let backendReady = false;
  let onlineState = "local";
  let pollTimer = null;
  let refreshPromise = null;
  let lastSyncAt = null;
  let saveDelayResolve = null;
  let lastSuccessCheckin = null;
  let donationNotice = null;

  function eventDateText() {
    return C.event.dateDisplay || U.date(C.event.date);
  }

  function eventTimeText() {
    return U.time(C.event.time);
  }

  function showVisibleClientError(message) {
    const text = String(message || "Ein unerwarteter Fehler ist aufgetreten.");
    const loginError = $("loginError");

    if (loginError && !$("loginView")?.classList.contains("hidden")) {
      loginError.textContent = text;
      return;
    }

    const toastTarget = $("toast");
    if (toastTarget) toast(text);
  }

  window.addEventListener("error", event => {
    showVisibleClientError(
      event?.error?.message ||
      event?.message ||
      "Die Anwendung konnte nicht vollständig gestartet werden."
    );
  });

  window.addEventListener("unhandledrejection", event => {
    showVisibleClientError(
      event?.reason?.message ||
      "Eine Serveranfrage konnte nicht verarbeitet werden."
    );
  });

  function init() {
    // Die Veranstaltungsdetails werden seit test.9 nur noch im Info-Dialog
    // angezeigt. Optionale Elemente werden nur befüllt, wenn sie existieren.
    const eventTitleElement = $("eventTitle");
    const eventTimeElement = $("eventTime");
    if (eventTitleElement) eventTitleElement.textContent = C.event.title;
    if (eventTimeElement) eventTimeElement.textContent = `${eventDateText()} · ${eventTimeText()} Uhr`;

    document.querySelectorAll("[data-nav]").forEach(button => {
      button.addEventListener("click", () => nav(button.dataset.nav));
    });
    document.querySelectorAll("[data-search-filter]").forEach(button => {
      button.addEventListener("click", () => {
        searchFilter = button.dataset.searchFilter;
        renderSearch();
      });
    });

    $("loginForm").addEventListener("submit", login);
    $("passwordToggle").addEventListener("click", togglePasswordVisibility);
    $("eventInfoTopBtn").addEventListener("click", showEventDetails);
    $("refreshBtn").addEventListener("click", refreshLocalData);
    $("helpBtn").addEventListener("click", openHelp);
    $("logoutTopBtn").addEventListener("click", logout);
    $("saveDonationBtn").addEventListener("click", saveDonation);
    $("searchInput").addEventListener("input", renderSearch);
    $("cameraPlaceholder").addEventListener("click", startCamera);
    $("startCameraButton").addEventListener("click", startCamera);
    $("stopCameraButton").addEventListener("click", () => SC.stop());
    $("modalCancel").addEventListener("click", () => closeModal(false));
    $("modalConfirm").addEventListener("click", () => closeModal(true));
    $("saveDelayContinue").addEventListener("click", () => closeSaveDelayChoice("continue"));
    $("saveDelayOffline").addEventListener("click", () => closeSaveDelayChoice("offline"));
    $("saveDelayCancel").addEventListener("click", () => closeSaveDelayChoice("cancel"));

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && S.getLogin()) {
        refreshSharedState({ quiet: true, reason: "sichtbar" });
        restartPolling();
      }
    });
    window.addEventListener("pageshow", () => {
      if (S.getLogin()) {
        refreshSharedState({ quiet: true, reason: "pageshow" });
        restartPolling();
      }
    });
    window.addEventListener("focus", () => {
      if (S.getLogin()) {
        refreshSharedState({ quiet: true, reason: "focus" });
        restartPolling();
      }
    });
    window.addEventListener("online", () => {
      if (S.getLogin()) {
        refreshSharedState({ quiet: true, reason: "online" });
        restartPolling();
      }
    });

    if (S.getLogin()) showMain();
    else showLogin();
  }


  function setBackendStatus(kind, text) {
    const target = $("backendStatus");
    if (!target) return;
    target.className = `backend-status ${kind || "local"}`;
    target.textContent = text;
  }

  function applySnapshot(snapshot) {
    if (!snapshot) return;
    if (snapshot.event) {
      C.event.id = snapshot.event.id;
      C.event.title = snapshot.event.title;
      C.event.date = snapshot.event.date;
      C.event.dateDisplay = snapshot.event.dateDisplay || "";
      C.event.time = snapshot.event.time;
      C.event.maxPersons = snapshot.event.maxPersons;
      C.event.registrationEnabled =
        snapshot.event.registrationEnabled === undefined
          ? true
          : snapshot.event.registrationEnabled === true;
      C.event.registrationDisabledReason =
        String(snapshot.event.registrationDisabledReason || "");
    }
    if (snapshot.prices) Object.assign(C.prices, snapshot.prices);
    if (snapshot.familyRule) Object.assign(C.familyRule, snapshot.familyRule);
    if (Array.isArray(snapshot.correctionReasons)) {
      correctionReasons.splice(0, correctionReasons.length, ...snapshot.correctionReasons
        .filter(reason => reason.active !== false)
        .sort((left, right) => Number(left.order || 0) - Number(right.order || 0)));
    }
    if (Array.isArray(snapshot.registrations)) {
      window.AVT_REGISTRATIONS = Object.freeze(snapshot.registrations);
    }
    if (snapshot.data) {
      data = {
        checkins: snapshot.data.checkins || {},
        manual: snapshot.data.manual || [],
        donations: snapshot.data.donations || [],
        sequence: Number(snapshot.data.sequence || 1)
      };
      S.save(data);

      if (lastSuccessCheckin?.operationId) {
        const serverCheckin = [
          ...Object.values(data.checkins || {}),
          ...(data.manual || [])
        ].find(item => item.operationId === lastSuccessCheckin.operationId);
        if (serverCheckin) {
          lastSuccessCheckin = {
            ...lastSuccessCheckin,
            ...serverCheckin,
            offline: true
          };
        }
      }
    }
  }

  function syncTimeLabel() {
    if (!lastSyncAt) return "";
    return new Intl.DateTimeFormat("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    }).format(lastSyncAt);
  }

  function queueBreakdown(operations = AVT_BACKEND.getQueue()) {
    return (operations || []).reduce((result, operation) => {
      if (operation.action === "donation") result.donations += 1;
      else if (operation.action === "checkin" || operation.action === "manualCheckin") result.checkins += 1;
      else result.other += 1;
      return result;
    }, { checkins: 0, donations: 0, other: 0 });
  }

  function outstandingText(operations = AVT_BACKEND.getQueue()) {
    const counts = queueBreakdown(operations);
    const parts = [];

    if (counts.checkins) {
      parts.push(`${counts.checkins} ${counts.checkins === 1 ? "Check-in" : "Check-ins"}`);
    }
    if (counts.donations) {
      parts.push(`${counts.donations} ${counts.donations === 1 ? "Spende" : "Spenden"}`);
    }
    if (counts.other) {
      parts.push(`${counts.other} ${counts.other === 1 ? "Vorgang" : "Vorgänge"}`);
    }

    return parts.length ? `${parts.join(" und ")} ausstehend` : "0 ausstehend";
  }

  function showOnlineStatus(text = "Online · Produktivbetrieb") {
    const time = syncTimeLabel();
    setBackendStatus(
      "online",
      `${text}${time ? ` · ${time}` : ""} · ${outstandingText()}`
    );
  }

  function showOfflineStatus(text = "Offline · lokaler Stand") {
    setBackendStatus("offline", `${text} · ${outstandingText()}`);
  }

  function registrationAvailabilityKnown() {
    return C.event.registrationEnabled === true || C.event.registrationEnabled === false;
  }

  function registrationAllowed() {
    return C.event.registrationEnabled === true;
  }

  function renderRegistrationAvailability() {
    const known = registrationAvailabilityKnown();
    const allowed = registrationAllowed();
    const blockedPanel = $("registrationBlockedPanel");
    const eventCard = $("eventSummaryCard");
    const actionRow = $("mainActionRow");

    if (allowed) {
      blockedPanel.classList.add("hidden");
      eventCard.classList.remove("hidden");
      actionRow.classList.remove("hidden");

      if (panels.every(panelId => $(panelId).classList.contains("hidden"))) {
        $("homePanel").classList.remove("hidden");
      }
      return;
    }

    SC.stop();
    panels.forEach(panelId => $(panelId).classList.add("hidden"));
    eventCard.classList.add("hidden");
    actionRow.classList.add("hidden");
    $("operationNotice").classList.add("hidden");
    blockedPanel.classList.remove("hidden");

    $("registrationBlockedTitle").textContent = known
      ? "Check-in derzeit nicht verfügbar"
      : "Veranstaltung wird geprüft …";

    $("registrationBlockedText").textContent = known
      ? (
          C.event.registrationDisabledReason ||
          `Für die Veranstaltungsart „${C.event.title || "–"}“ ist keine Voranmeldung und kein Check-in vorgesehen.`
        )
      : "Die Freigabe für Voranmeldung und Check-in wird aus der bestehenden Veranstaltungskonfiguration geladen.";

    $("registrationBlockedEvent").textContent = C.event.title || "–";
    $("registrationBlockedTime").textContent =
      `${eventDateText()} · ${eventTimeText()} Uhr`;
  }

  function renderSharedState() {
    renderRegistrationAvailability();
    if (!registrationAllowed()) return;

    renderAll();

    if (!$("searchPanel").classList.contains("hidden")) {
      renderSearch();
    }
    if (!$("donationPanel").classList.contains("hidden")) {
      renderDonationPanel(true);
    }
    if (!$("overviewPanel").classList.contains("hidden")) {
      renderOverview();
    }

    const currentStand = $("currentStandCard");
    if (currentStand) {
      currentStand.outerHTML = currentStandHtml();
    }

    updateSuccessSyncBanner();
    updateDonationSyncBanner();

    if (
      !$("resultPanel").classList.contains("hidden") &&
      current?.token &&
      data.checkins[current.token] &&
      !$("successDetailsBtn")
    ) {
      const existing = data.checkins[current.token];
      showMessage(
        "Bereits eingecheckt",
        `${current.number} wurde inzwischen auf einem anderen Gerät mit ${U.sumCounts(existing.counts)} Personen eingecheckt.`,
        "warning",
        true
      );
    }
  }

  function handleAuthenticationFailure(message = "Die Anmeldung ist abgelaufen. Bitte erneut anmelden.") {
    S.clearLogin();
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
    backendReady = false;
    onlineState = "local";
    showLogin();
    $("loginError").textContent = message;
  }

  async function initializeBackend() {
    if (!window.AVT_BACKEND?.isConfigured()) {
      backendReady = false;
      setBackendStatus("local", "Produktivbackend noch nicht konfiguriert");
      applySnapshot(window.AVT_BACKEND?.loadCached?.());
      renderSharedState();
      return;
    }

    try {
      const snapshot = await AVT_BACKEND.bootstrap();
      applySnapshot(snapshot);
      backendReady = true;
      onlineState = "online";
      lastSyncAt = new Date();
      showOnlineStatus();
      if (AVT_BACKEND.queueCount()) await syncOfflineQueue({ quiet: true });
      renderSharedState();
      restartPolling();
    } catch (error) {
      if (AVT_BACKEND.isAuthError(error)) {
        handleAuthenticationFailure(error.message);
        return;
      }
      backendReady = false;
      onlineState = "offline";
      const cached = AVT_BACKEND.loadCached();
      if (cached) applySnapshot(cached);
      showOfflineStatus();
      renderSharedState();
      restartPolling();
    }
  }

  function pollingDelayMs() {
    return Math.max(5, Number(C.backend?.pollSeconds || 15)) * 1000;
  }

  function scheduleNextPoll(delay = pollingDelayMs()) {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(async () => {
      pollTimer = null;
      await runPollCycle();
    }, delay);
  }

  function restartPolling() {
    scheduleNextPoll(pollingDelayMs());
  }

  async function runPollCycle() {
    try {
      if (
        S.getLogin() &&
        !$("mainView")?.classList.contains("hidden") &&
        !document.hidden
      ) {
        await refreshSharedState({ quiet: true, reason: "timer" });
      }
    } finally {
      scheduleNextPoll(pollingDelayMs());
    }
  }

  async function refreshSharedState({ quiet = false, reason = "manual" } = {}) {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      if (!window.AVT_BACKEND?.isConfigured()) {
        data = S.load();
        renderSharedState();
        if (!quiet) toast("Lokale Statistik aktualisiert.");
        return;
      }

      try {
        if (AVT_BACKEND.queueCount()) {
          await syncOfflineQueue({ quiet: true });
        }

        const snapshot = await AVT_BACKEND.state();
        applySnapshot(snapshot);
        backendReady = true;
        onlineState = "online";
        lastSyncAt = new Date();
        showOnlineStatus();
        renderSharedState();

        if (!quiet) toast("Gemeinsamer Stand aktualisiert.");
      } catch (error) {
        if (AVT_BACKEND.isAuthError(error)) {
          handleAuthenticationFailure(error.message);
          return;
        }
        onlineState = "offline";
        showOfflineStatus();
        data = S.load();
        renderSharedState();
        if (!quiet) toast("Offline: lokaler Stand angezeigt.");
      }
    })();

    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function synchronizedOperationsMessage(operations) {
    const counts = queueBreakdown(operations);

    if (counts.checkins && counts.donations) {
      return "Die offline zwischengespeicherten Check-ins und Spenden wurden erfolgreich synchronisiert.";
    }
    if (counts.donations) {
      return counts.donations === 1
        ? "Die offline zwischengespeicherte Spende wurde erfolgreich synchronisiert."
        : "Die offline zwischengespeicherten Spenden wurden erfolgreich synchronisiert.";
    }
    if (counts.checkins) {
      return counts.checkins === 1
        ? "Der offline zwischengespeicherte Check-in wurde erfolgreich synchronisiert."
        : "Die offline zwischengespeicherten Check-ins wurden erfolgreich synchronisiert.";
    }
    return "Die offline zwischengespeicherten Vorgänge wurden erfolgreich synchronisiert.";
  }

  async function syncOfflineQueue({ quiet = false } = {}) {
    if (!window.AVT_BACKEND?.isConfigured() || !AVT_BACKEND.queueCount()) return;

    try {
      const result = await AVT_BACKEND.syncQueue();
      if (result.data) applySnapshot(result.data);

      if (result.failed) {
        showOfflineStatus("Synchronisierung offen");
        if (!quiet) toast(`${outstandingText()} – Synchronisierung noch offen.`);
        return;
      }

      lastSyncAt = new Date();
      showOnlineStatus("Online · Offline-Vorgänge synchronisiert");

      const syncedOperations = result.syncedOperations || [];
      const donationOperations = syncedOperations.filter(operation => operation.action === "donation");

      if (donationOperations.length) {
        donationNotice = {
          state: "synced",
          count: donationOperations.length,
          operationId: donationOperations[donationOperations.length - 1].operationId
        };
      }

      renderSharedState();
      updateSuccessSyncBanner();
      updateDonationSyncBanner();

      if (result.synced) {
        toast(synchronizedOperationsMessage(syncedOperations));
      }
    } catch (error) {
      if (AVT_BACKEND.isAuthError(error)) {
        handleAuthenticationFailure(error.message);
        return;
      }
      showOfflineStatus("Offline");
      if (!quiet) toast("Synchronisierung derzeit nicht möglich.");
    }
  }

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function savingWarningMilliseconds() {
    return Math.max(1, Number(C.saveFlow?.warningSeconds || 8)) * 1000;
  }

  function verificationMilliseconds() {
    return Math.max(1, Number(C.saveFlow?.verificationSeconds || 3)) * 1000;
  }

  function showSavingOverlay(text = "Check-in wird gespeichert …") {
    $("savingText").textContent = text;
    document.querySelector(".app-shell")?.setAttribute("inert", "");
    $("savingOverlay").classList.remove("hidden");
  }

  function hideSavingOverlay() {
    $("savingOverlay").classList.add("hidden");
    document.querySelector(".app-shell")?.removeAttribute("inert");
  }

  function isTerminalOperationError(error) {
    return [
      "CHECKIN_NOT_AVAILABLE",
      "REGISTRATION_NOT_AVAILABLE"
    ].includes(String(error?.code || ""));
  }

  async function handleRejectedOperation(result) {
    const message =
      result?.error?.message ||
      "Für die aktuelle Veranstaltungsart ist kein Check-in vorgesehen.";

    try {
      await refreshSharedState({ quiet: true, reason: "server-sperre" });
    } catch {}

    toast(message);
  }

  function operationText(action) {
    if (action === "donation") {
      return {
        saving: "Spende wird gespeichert …",
        subject: "Die Spende",
        queuedSynced: "Die offline zwischengespeicherte Spende wurde erfolgreich synchronisiert.",
        savedLater: "Die Spende wurde inzwischen doch gespeichert."
      };
    }

    return {
      saving: "Check-in wird gespeichert …",
      subject: "Der Check-in",
      queuedSynced: "Der offline zwischengespeicherte Check-in wurde erfolgreich synchronisiert.",
      savedLater: "Der Check-in wurde inzwischen doch gespeichert."
    };
  }

  function showSaveDelayChoice(action, requestFailed = false, requestErrorMessage = "") {
    const text = operationText(action);
    const duplicateHint = /bereits\s+eingecheckt/i.test(requestErrorMessage)
      ? " Der gemeinsame Stand wird geprüft."
      : "";

    $("saveDelayBody").textContent = requestFailed
      ? `${text.subject} wurde bisher nicht bestätigt.${duplicateHint} Du kannst weiter warten, offline zwischenspeichern oder abbrechen.`
      : `${text.subject} wurde vom Server noch nicht bestätigt. Du kannst weiter warten, offline zwischenspeichern oder abbrechen.`;

    $("saveDelayOffline").classList.toggle(
      "hidden",
      C.saveFlow?.offlineFallbackEnabled === false
    );
    $("saveDelayModal").classList.remove("hidden");

    return new Promise(resolve => {
      saveDelayResolve = resolve;
    });
  }

  function closeSaveDelayChoice(value) {
    if ($("saveDelayModal").classList.contains("hidden")) return;
    $("saveDelayModal").classList.add("hidden");
    const resolve = saveDelayResolve;
    saveDelayResolve = null;
    if (resolve) resolve(value);
  }

  function inspectSavedOperation(snapshot, operation) {
    const snapshotData = snapshot?.data;
    if (!snapshotData) return { state: "unknown", record: null };

    if (operation.action === "checkin") {
      const token = operation.payload?.checkin?.token;
      const existing = token ? snapshotData.checkins?.[token] || null : null;

      if (!existing) return { state: "missing", record: null };

      return existing.operationId === operation.operationId
        ? { state: "saved", record: existing }
        : { state: "duplicate", record: existing };
    }

    if (operation.action === "manualCheckin") {
      const checkin = operation.payload?.checkin || {};
      const existing = (snapshotData.manual || []).find(item =>
        item.operationId === operation.operationId ||
        (checkin.id && item.id === checkin.id)
      ) || null;

      return existing
        ? { state: "saved", record: existing }
        : { state: "missing", record: null };
    }

    if (operation.action === "donation") {
      const existing = (snapshotData.donations || []).find(item =>
        item.operationId === operation.operationId
      ) || null;

      return existing
        ? { state: "saved", record: existing }
        : { state: "missing", record: null };
    }

    return { state: "unknown", record: null };
  }

  function acceptManagedSaveResult(result, operation, uiMode) {
    const text = operationText(operation.action);

    if (result?.data) applySnapshot(result.data);
    AVT_BACKEND.removeQueued(operation.operationId);
    lastSyncAt = new Date();
    showOnlineStatus();

    if (operation.action === "donation" && uiMode === "queued") {
      donationNotice = {
        state: "synced",
        count: 1,
        operationId: operation.operationId
      };
    }

    if (uiMode === "queued") {
      renderSharedState();
      updateSuccessSyncBanner();
      updateDonationSyncBanner();
      toast(text.queuedSynced);
    } else if (uiMode === "cancelled") {
      renderSharedState();
      toast(text.savedLater);
    }
  }

  async function saveOperationWithProgress(action, payload) {
    const operation = AVT_BACKEND.prepareOperation(action, payload);
    if (operation.payload?.checkin) {
      operation.payload.checkin.operationId = operation.operationId;
    }
    if (operation.payload?.donation) {
      operation.payload.donation.operationId = operation.operationId;
    }

    let completed = false;
    let requestFinished = false;
    let requestFailed = false;
    let requestError = null;
    let uiMode = "waiting";
    let verificationRunning = false;
    let completeResolve = null;

    const completion = new Promise(resolve => {
      completeResolve = resolve;
    });

    function markSaved(result) {
      if (completed) return;
      completed = true;
      acceptManagedSaveResult(result, operation, uiMode);
      closeSaveDelayChoice("saved");
      completeResolve({ status: "saved", result, operation });
    }

    function markRejected(error) {
      if (completed) return;
      completed = true;
      closeSaveDelayChoice("rejected");
      completeResolve({ status: "rejected", error, operation });
    }

    function markDuplicate(snapshot, existing) {
      if (completed) return;
      completed = true;

      if (snapshot) applySnapshot(snapshot);
      AVT_BACKEND.removeQueued(operation.operationId);
      lastSyncAt = new Date();
      showOnlineStatus();
      closeSaveDelayChoice("duplicate");

      completeResolve({
        status: "duplicate",
        operation,
        existing,
        data: snapshot
      });
    }

    async function verifyOnce() {
      try {
        const snapshot = await AVT_BACKEND.state();
        const inspection = inspectSavedOperation(snapshot, operation);

        if (inspection.state === "saved") {
          markSaved({
            ok: true,
            data: snapshot,
            verified: true,
            saved: inspection.record
          });
          return { checked: true, saved: true, duplicate: false };
        }

        if (inspection.state === "duplicate") {
          markDuplicate(snapshot, inspection.record);
          return { checked: true, saved: false, duplicate: true };
        }

        return { checked: true, saved: false, duplicate: false };
      } catch {
        return { checked: false, saved: false, duplicate: false };
      }
    }

    async function startVerificationLoop() {
      if (verificationRunning) return;
      verificationRunning = true;
      const deadline = Date.now() + 60000;

      while (!completed && Date.now() < deadline) {
        await wait(verificationMilliseconds());
        if (completed) break;
        await verifyOnce();
      }

      verificationRunning = false;
    }

    showSavingOverlay(operationText(action).saving);

    AVT_BACKEND.sendPrepared(operation)
      .then(result => {
        requestFinished = true;
        markSaved(result);
      })
      .catch(error => {
        requestFinished = true;
        requestFailed = true;
        requestError = error;

        if (isTerminalOperationError(error)) {
          markRejected(error);
          return;
        }

        // Bei einem konkurrierenden Check-in liefert das Backend bereits
        // "Diese Anmeldung wurde bereits eingecheckt". Der gemeinsame Stand
        // wird sofort geprüft, ohne den Check-in erneut zu senden.
        if (
          action === "checkin" &&
          /bereits\s+eingecheckt/i.test(String(error?.message || ""))
        ) {
          verifyOnce();
        }

        startVerificationLoop();
      });

    while (!completed) {
      const outcome = await Promise.race([
        completion,
        wait(savingWarningMilliseconds()).then(() => ({ status: "warning" }))
      ]);

      if (
        outcome.status === "saved" ||
        outcome.status === "duplicate" ||
        outcome.status === "rejected"
      ) {
        hideSavingOverlay();
        return outcome;
      }

      const choice = await showSaveDelayChoice(
        action,
        requestFailed,
        requestError?.message || ""
      );

      if (choice === "saved" || choice === "duplicate" || choice === "rejected") {
        const finishedOutcome = await completion;
        hideSavingOverlay();
        return finishedOutcome;
      }

      if (choice === "continue") {
        // Der bereits gestartete Schreibvorgang bleibt unverändert aktiv.
        // Es wird ausdrücklich kein zweiter Check-in gesendet.
        continue;
      }

      if (choice === "offline") {
        uiMode = "queued";
        AVT_BACKEND.enqueuePrepared(operation);
        startVerificationLoop();
        hideSavingOverlay();
        return { status: "queued", operation };
      }

      if (choice === "cancel") {
        const verification = await verifyOnce();

        if (completed || verification.saved || verification.duplicate) {
          const finishedOutcome = await completion;
          hideSavingOverlay();
          return finishedOutcome;
        }

        if (requestFinished && verification.checked) {
          uiMode = "cancelled";
          startVerificationLoop();
          hideSavingOverlay();
          return { status: "cancelled", operation };
        }

        toast("Der Speicherstatus ist noch nicht eindeutig. Bitte weiter warten oder offline speichern.");
      }
    }

    hideSavingOverlay();
    return await completion;
  }

  function prepareOfflineOperation(action, record) {
    const payload = action === "donation"
      ? { donation: record }
      : { checkin: record };

    const operation = AVT_BACKEND.prepareOperation(action, payload);
    record.operationId = operation.operationId;

    if (operation.payload.checkin) {
      operation.payload.checkin.operationId = operation.operationId;
    }
    if (operation.payload.donation) {
      operation.payload.donation.operationId = operation.operationId;
    }

    AVT_BACKEND.enqueuePrepared(operation);
    return operation;
  }

  function isCheckinStillQueued(checkin) {
    return Boolean(
      checkin?.operationId &&
      window.AVT_BACKEND?.isQueued?.(checkin.operationId)
    );
  }

  function syncStateBannerHtml(checkin) {
    if (!checkin?.offline || !checkin?.operationId) return "";

    if (isCheckinStillQueued(checkin)) {
      return '<div id="syncStateBanner" class="offline-indicator">Offline gespeichert – noch nicht synchronisiert</div>';
    }

    return '<div id="syncStateBanner" class="offline-synced-indicator">Die offline zwischengespeicherten Check-ins wurden erfolgreich synchronisiert.</div>';
  }

  function updateSuccessSyncBanner() {
    if (!lastSuccessCheckin || $("resultPanel")?.classList.contains("hidden")) return;

    const html = syncStateBannerHtml(lastSuccessCheckin);
    const existing = $("syncStateBanner");

    if (!html) {
      existing?.remove();
      return;
    }

    if (existing) {
      existing.outerHTML = html;
    } else {
      $("resultContent")?.insertAdjacentHTML("afterbegin", html);
    }
  }

  function donationNoticeHtml() {
    if (!donationNotice) return "";

    if (donationNotice.state === "pending") {
      return '<div class="offline-indicator">Spende offline gespeichert – noch nicht synchronisiert</div>';
    }

    const text = donationNotice.count === 1
      ? "Die offline zwischengespeicherte Spende wurde erfolgreich synchronisiert."
      : "Die offline zwischengespeicherten Spenden wurden erfolgreich synchronisiert.";

    return `<div class="offline-synced-indicator">${text}</div>`;
  }

  function updateDonationSyncBanner() {
    const target = $("operationNotice");
    if (!target) return;

    const html = donationNoticeHtml();
    target.innerHTML = html;
    target.classList.toggle("hidden", !html);
  }

  function togglePasswordVisibility() {
    const input = $("password");
    const toggle = $("passwordToggle");
    const showPassword = input.type === "password";

    input.type = showPassword ? "text" : "password";
    toggle.setAttribute("aria-pressed", showPassword ? "true" : "false");
    toggle.setAttribute("aria-label", showPassword ? "Passwort ausblenden" : "Passwort anzeigen");
    toggle.setAttribute("title", showPassword ? "Passwort ausblenden" : "Passwort anzeigen");

    toggle.querySelector(".password-eye-open").classList.toggle("hidden", showPassword);
    toggle.querySelector(".password-eye-closed").classList.toggle("hidden", !showPassword);

    input.focus({ preventScroll: true });
    const valueLength = input.value.length;
    try {
      input.setSelectionRange(valueLength, valueLength);
    } catch {}
  }

  function scrollContainer() {
    return document.querySelector("main");
  }

  function setScrollTopZero() {
    const container = scrollContainer();
    if (container) container.scrollTop = 0;
  }

  function forcePageTop() {
    document.activeElement?.blur();
    const container = scrollContainer();
    if (!container) return;

    container.scrollTop = 0;
    requestAnimationFrame(() => {
      container.scrollTop = 0;
      requestAnimationFrame(() => {
        container.scrollTop = 0;
      });
    });

    [50, 150, 350, 700].forEach(delay => {
      window.setTimeout(() => {
        container.scrollTop = 0;
      }, delay);
    });
  }

  async function login(event) {
    event.preventDefault();

    const form = event.currentTarget;
    const button =
      $("loginSubmitBtn") ||
      form.querySelector('button[type="submit"]') ||
      form.querySelector("button.primary");
    const errorTarget = $("loginError");

    try {
      if (!button) {
        throw new Error("Der Anmeldebutton konnte nicht initialisiert werden. Bitte die Seite einmal vollständig neu laden.");
      }

      const password = String($("password")?.value || "");
      const mode = new FormData(form).get("mode") || "day";

      if (!password) {
        throw new Error("Bitte geben Sie das Check-in-Passwort ein.");
      }

      errorTarget.textContent = "";
      button.disabled = true;
      button.textContent = "Anmeldung wird geprüft …";

      const result = await AVT_BACKEND.login(password, mode);

      if (!result?.sessionToken) {
        throw new Error("Das Backend hat keinen gültigen Sitzungstoken zurückgegeben.");
      }

      S.setLogin({
        mode,
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt
      });

      $("password").value = "";
      $("password").type = "password";
      $("passwordToggle").setAttribute("aria-pressed", "false");
      $("passwordToggle").setAttribute("aria-label", "Passwort anzeigen");
      $("passwordToggle").setAttribute("title", "Passwort anzeigen");
      $("passwordToggle").querySelector(".password-eye-open").classList.remove("hidden");
      $("passwordToggle").querySelector(".password-eye-closed").classList.add("hidden");
      document.activeElement?.blur();

      showMain();
      forcePageTop();
    } catch (error) {
      if (errorTarget) {
        errorTarget.textContent = error?.message || "Anmeldung fehlgeschlagen.";
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Anmelden";
      }
    }
  }

  async function logout() {
    if (AVT_BACKEND.queueCount()) {
      toast(`${outstandingText()} – bitte vor der Abmeldung synchronisieren.`);
      return;
    }

    const login = S.getLogin();
    try {
      await AVT_BACKEND.logout(login?.sessionToken || "");
    } catch {}

    S.clearLogin();
    data = S.reset();
    AVT_BACKEND.clearCached();
    current = null;
    counts = null;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
    showLogin();
  }

  function showLogin() {
    $("loginView").classList.remove("hidden");
    $("mainView").classList.add("hidden");
    $("headActions").classList.add("hidden");
    forcePageTop();
  }

  function showMain() {
    $("loginView").classList.add("hidden");
    $("mainView").classList.remove("hidden");
    $("headActions").classList.remove("hidden");
    C.event.registrationEnabled = null;
    renderRegistrationAvailability();
    updateHeaderStats();
    initializeBackend();
    forcePageTop();
  }

  function nav(name, options = {}) {
    SC.stop();

    if (!registrationAllowed()) {
      renderRegistrationAvailability();
      if (options.forceTop) forcePageTop();
      return;
    }
    panels.forEach(panel => $(panel).classList.add("hidden"));
    const panel = $(name + "Panel") || $("homePanel");
    panel.classList.remove("hidden");

    if (navigablePanels.has(name)) activeNav = name;
    else if (name === "home") activeNav = "";
    updateActiveNavigation();

    if (name === "home") renderHome();
    if (name === "overview") renderOverview();
    if (name === "donation") renderDonationPanel();
    if (name === "search") {
      if (!options.keepSearch) {
        $("searchInput").value = "";
        searchFilter = "open";
      }
      renderSearch();
      if (!options.noFocus) setTimeout(() => $("searchInput").focus(), 30);
    }
    if (name === "manual") {
      current = null;
      counts = { adult: 0, child: 0, youth: 0, student: 0 };
      resetPriceState();
      renderManual();
    }
    if (name === "scan") { resetCamera(); startCamera(); }

    if (name === "home" || name === "donation" || options.forceTop) {
      forcePageTop();
    } else if (name !== "result") {
      scrollContainer()?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function updateActiveNavigation() {
    document.querySelectorAll(".nav-icon[data-nav]").forEach(button => {
      const isActive = button.dataset.nav === activeNav;
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-current", isActive ? "page" : "false");
    });
  }

  function openHelp() {
    SC.stop();
    window.location.assign("help.html");
  }

  async function refreshLocalData() {
    await refreshSharedState({ quiet: false, reason: "button" });
    restartPolling();
  }

  function bookedConfirmed() {
    return window.AVT_REGISTRATIONS
      .filter(registration => registration.status === "confirmed" && registration.eventId === C.event.id)
      .reduce((sum, registration) => sum + U.sumCounts(registration.booked), 0);
  }

  function stats() {
    let regular = 0;
    let wait = 0;
    let exceptions = 0;
    let manual = 0;
    let entry = 0;

    Object.values(data.checkins).forEach(checkin => {
      const persons = U.sumCounts(checkin.counts);
      entry += Number(checkin.paid) || 0;
      if (checkin.kind === "regular") regular += persons;
      else if (checkin.kind === "waitlist") wait += persons;
      else exceptions += persons;
    });

    data.manual.forEach(checkin => {
      manual += U.sumCounts(checkin.counts);
      entry += Number(checkin.paid) || 0;
    });

    const donations = data.donations.reduce((sum, donation) => sum + (Number(donation.amount) || 0), 0);
    const present = regular + wait + exceptions + manual;
    const confirmed = bookedConfirmed();
    const initially = Math.max(0, C.event.maxPersons - confirmed);

    let expected = 0;
    window.AVT_REGISTRATIONS
      .filter(registration => registration.status === "confirmed" && registration.eventId === C.event.id)
      .forEach(registration => {
        if (!data.checkins[registration.token]) expected += U.sumCounts(registration.booked);
      });

    const regularOpen = expected;
    const waitOpen = window.AVT_REGISTRATIONS
      .filter(registration =>
        registration.eventId === C.event.id &&
        registration.status === "waitlist" &&
        !data.checkins[registration.token]
      )
      .reduce((sum, registration) => sum + U.sumCounts(registration.booked), 0);

    const safe = Math.max(0, C.event.maxPersons - present - regularOpen);

    return {
      regular,
      wait,
      exceptions,
      manual,
      present,
      confirmed,
      initially,
      expected: regularOpen,
      regularOpen,
      waitOpen,
      safe,
      entry,
      donations,
      total: entry + donations
    };
  }

  function updateHeaderStats() {
    const currentStats = stats();
    $("presentTop").textContent = currentStats.present;
    $("safeFreeTop").textContent = currentStats.safe;
  }

  function showEventDetails() {
    const currentStats = stats();
    $("modalTitle").textContent = "Veranstaltungsdetails";
    $("modalBody").innerHTML = `
      <div class="card" style="margin:0;padding:12px;">
        <p><strong>${U.esc(C.event.title)}</strong></p>
        <p>${U.esc(eventDateText())} · ${U.esc(eventTimeText())} Uhr</p>
        <p>Produktiver Mehrgerätebetrieb</p>
      </div>
      <div class="card" style="margin:12px 0 0 0;padding:12px;">
        <dl class="detail-grid">
          <dt>Eingecheckt</dt><dd>${currentStats.present} / ${C.event.maxPersons}</dd>
          <dt>Sicher freie Plätze</dt><dd>${currentStats.safe}</dd>
        </dl>
      </div>`;
    $("modalConfirm").textContent = "Schließen";
    $("modalCancel").classList.add("hidden");
    $("modal").classList.remove("hidden");
    modalResolve = () => {
      $("modalCancel").classList.remove("hidden");
    };
  }

  function renderAll() {
    renderHome();
    renderOverview();
    updateHeaderStats();
  }

  function renderHome() {
    const currentStats = stats();
    $("presentTop").textContent = currentStats.present;
    $("summary").innerHTML = [
      summaryCard("Anwesend", currentStats.present, `von ${C.event.maxPersons}`),
      summaryCard("Sicher frei", currentStats.safe, `${currentStats.expected} regulär erwartet`),
      summaryCard("Eintritt", U.euro(currentStats.entry), "erfasst"),
      summaryCard("Spenden", U.euro(currentStats.donations), "separat")
    ].join("");

  }

  function summaryCard(label, value, note) {
    return `<div class="summary-card"><small>${U.esc(label)}</small><strong>${U.esc(value)}</strong><small>${U.esc(note)}</small></div>`;
  }

  function resetCamera() {
    $("cameraVideo").classList.add("hidden");
    $("cameraPlaceholder").classList.remove("hidden");
    $("startCameraButton").classList.remove("hidden");
    $("stopCameraButton").classList.add("hidden");
    $("scanLine").classList.add("hidden");
    $("cameraStatus").textContent = "Kamera wird automatisch gestartet …";
  }

  async function startCamera() {
    try {
      await SC.start(value => handlePayload(value));
      $("cameraVideo").classList.remove("hidden");
      $("cameraPlaceholder").classList.add("hidden");
      $("startCameraButton").classList.add("hidden");
      $("stopCameraButton").classList.remove("hidden");
      $("scanLine").classList.remove("hidden");
    } catch (error) {
      $("cameraStatus").textContent = error.message || "Kamera konnte nicht gestartet werden.";
    }
  }

  function handlePayload(rawValue) {
    SC.stop();
    let token = String(rawValue || "").trim();
    if (token.startsWith(C.qrPrefix)) token = token.slice(C.qrPrefix.length);
    processToken(token);
  }

  function resetPriceState() {
    tariffMode = "regular";
    correctedEntry = "";
    correctionReason = "";
  }

  function selectRegistration(registration) {
    current = registration;
    counts = U.clone(registration.booked);
    showAllCategories = false;
    resetPriceState();
    renderResult();
  }

  function showSplitRegistrationSelection(matches) {
    panels.forEach(panel => $(panel).classList.add("hidden"));
    $("resultPanel").classList.remove("hidden");

    $("resultContent").innerHTML = `
      <div class="card warning">
        <h2>Geteilte Anmeldung</h2>
        <p>Diese Buchung enthält reguläre Anmeldeplätze und Wartelistenplätze. Bitte wählen Sie den Teil aus, der jetzt eingecheckt werden soll.</p>
      </div>
      <div class="registration-list">
        ${matches.map(registration => {
          const existing = data.checkins[registration.token];
          const state = existing
            ? `Bereits eingecheckt · ${U.sumCounts(existing.counts)} Personen`
            : labelStatus(registration.status);
          return `<button class="registration-entry" data-split-token="${U.esc(registration.token)}">
            <span class="registration-entry-main">
              <strong>${U.esc((registration.ids || [registration.number]).join(", "))}</strong>
              <small>${U.sumCounts(registration.booked)} Personen</small>
            </span>
            <span class="registration-state ${existing ? "checked" : registration.status === "waitlist" ? "wait" : ""}">${U.esc(state)}</span>
          </button>`;
        }).join("")}
      </div>`;

    $("resultContent").querySelectorAll("[data-split-token]").forEach(button => {
      button.onclick = () => {
        const selected = matches.find(item => item.token === button.dataset.splitToken);
        if (selected) selectRegistration(selected);
      };
    });
  }

  function processToken(token) {
    const cleanToken = String(token || "").trim();
    const matches = window.AVT_REGISTRATIONS.filter(item =>
      item.token === cleanToken || item.qrToken === cleanToken
    );

    if (!matches.length) {
      showMessage(
        "Unbekannter QR-Code",
        "Dieser QR-Code gehört nicht zu einer Anmeldung der aktiven Veranstaltung.",
        "dangerbox"
      );
      return;
    }

    if (matches.length > 1) {
      showSplitRegistrationSelection(matches);
      return;
    }

    selectRegistration(matches[0]);
  }

  function activeEventRegistrations() {
    return window.AVT_REGISTRATIONS.filter(registration => registration.eventId === C.event.id);
  }

  function renderSearch() {
    document.querySelectorAll("[data-search-filter]").forEach(button => {
      button.classList.toggle("active", button.dataset.searchFilter === searchFilter);
    });

    const query = $("searchInput").value.trim().toLowerCase();
    const list = activeEventRegistrations().filter(registration => {
      const checked = Boolean(data.checkins[registration.token]);
      if (searchFilter === "open" && checked) return false;
      if (searchFilter === "checked" && !checked) return false;
      const searchableIds = (registration.ids || [registration.number]).join(" ").toLowerCase();
      if (query &&
          !registration.number.toLowerCase().includes(query) &&
          !registration.name.toLowerCase().includes(query) &&
          !searchableIds.includes(query)) return false;
      return true;
    });

    $("searchResults").innerHTML = list.length
      ? list.map(searchResultHtml).join("")
      : `<p class="muted">Für diesen Filter wurde keine Anmeldung gefunden.</p>`;

    $("searchResults").querySelectorAll("[data-token]").forEach(button => {
      button.onclick = () => processToken(button.dataset.token);
    });
  }

  function searchResultHtml(registration) {
    const checkin = data.checkins[registration.token];
    let stateClass = "";
    let stateText = labelStatus(registration.status);

    if (checkin) {
      stateClass = "checked";
      stateText = `Eingecheckt · ${U.sumCounts(checkin.counts)}`;
    } else if (registration.status === "waitlist") {
      stateClass = "wait";
    } else if (registration.status === "cancelled") {
      stateClass = "cancelled";
    }

    const idCount = (registration.ids || [registration.number]).length;
    return `<button class="registration-entry" data-token="${registration.token}">
      <span class="registration-entry-main"><strong>${U.esc(registration.name)}</strong><small>${U.sumCounts(registration.booked)} Personen · ${idCount} IDs</small></span>
      <span class="registration-state ${stateClass}">${U.esc(stateText)}</span>
    </button>`;
  }

  function renderResult() {
    panels.forEach(panel => $(panel).classList.add("hidden"));
    $("resultPanel").classList.remove("hidden");
    updateActiveNavigation();

    if (current.eventId !== C.event.id) {
      showMessage("Falsche Veranstaltung", `${current.number} gehört nicht zur aktiven Veranstaltung.`, "dangerbox");
      return;
    }

    const existing = data.checkins[current.token];
    if (existing) {
      showMessage("Bereits eingecheckt", `${current.number} wurde bereits mit ${U.sumCounts(existing.counts)} Personen eingecheckt.`, "warning", true);
      return;
    }

    const waitBlock = current.status === "waitlist" ? earlierWaitIds() : [];
    const tone = current.status === "cancelled" ? "dangerbox" : current.status === "waitlist" ? "warning" : "";
    let warning = "";

    if (current.status === "cancelled") {
      warning = '<div class="card dangerbox"><strong>Stornierte Anmeldung</strong><p>Ein Check-in ist nur als ausdrückliche Ausnahme möglich.</p></div>';
    }
    if (waitBlock.length) {
      warning = `<div class="card warning"><strong>Diese Wartelistenanmeldung ist noch nicht an der Reihe.</strong><p>Vorher sind noch folgende Wartelisten-IDs offen:</p><ul class="wait-warning-list">${waitBlock.map(id => `<li>${U.esc(id)}</li>`).join("")}</ul><p>Ein Check-in ist nach zusätzlicher Bestätigung trotzdem möglich.</p></div>`;
    }

    $("resultContent").innerHTML = `
      <div class="card ${tone}">
        <div class="result-head result-head-compact">
          <div><h2>${U.esc(current.name)}</h2></div>
          <div class="result-actions">
            <span class="badge">${labelStatus(current.status)}</span>
            <button id="showIdsButton" class="ids-button secondary" type="button">IDs (${(current.ids || [current.number]).length})</button>
          </div>
        </div>
      </div>
      ${warning}
      ${counterHtml(false)}
      ${priceHtml(`<button id="completeBtn" class="primary checkin-side-button" type="button">${
        current.status === "cancelled"
          ? "Ausnahme einchecken"
          : current.status === "waitlist"
            ? "Warteliste einchecken"
            : "Check-in abschließen"
      }</button>`)}`;

    bindCounters(false);
    bindPrice();
    $("showIdsButton").onclick = showCurrentIds;
    $("completeBtn").onclick = completeExisting;
  }

  function showCurrentIds() {
    const ids = current?.ids || [current?.number].filter(Boolean);
    $("modalTitle").textContent = `Check-in-IDs (${ids.length})`;
    $("modalBody").innerHTML = `<div class="ids-list">${ids.map(id => `<span>${U.esc(id)}</span>`).join("")}</div>`;
    $("modalConfirm").textContent = "Schließen";
    $("modalCancel").classList.add("hidden");
    $("modal").classList.remove("hidden");

    modalResolve = () => {
      $("modalCancel").classList.remove("hidden");
    };
  }

  function labelStatus(status) {
    if (status === "confirmed") return "Reguläre Anmeldung";
    if (status === "waitlist") return "Warteliste";
    return "Storniert";
  }

  function waitIdNumber(id) {
    const match = String(id || "").match(/^W-(\d+)$/i);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  }

  function earlierWaitIds() {
    const currentIds = current?.ids || [current?.number].filter(Boolean);
    const currentMinimum = Math.min(...currentIds.map(waitIdNumber));

    return window.AVT_REGISTRATIONS
      .filter(registration =>
        registration.eventId === C.event.id &&
        registration.status === "waitlist" &&
        registration.token !== current?.token &&
        !data.checkins[registration.token]
      )
      .flatMap(registration => registration.ids || [registration.number])
      .filter(id => waitIdNumber(id) < currentMinimum)
      .sort((left, right) => waitIdNumber(left) - waitIdNumber(right));
  }

  function counterHtml(isManual) {
    const visibleKeys = Object.keys(categories).filter(key => isManual || showAllCategories || Number(counts[key] || 0) > 0);
    const toggle = isManual ? "" : `<button id="categoryToggle" class="category-toggle secondary" type="button">${showAllCategories ? "- weniger" : "+ alle"}</button>`;

    return `<div class="card">
      <div class="counter-heading"><h3>Personenzahl anpassen</h3>${toggle}</div>
      ${visibleKeys.map(key => `
        <div class="counter-row">
          <span>${categories[key].label}</span>
          <button data-category="${key}" data-delta="-1" type="button">−</button>
          <div class="counter-value">${counts[key] || 0}</div>
          <button data-category="${key}" data-delta="1" type="button">+</button>
        </div>`).join("")}
      <p><strong>Gesamt: ${U.sumCounts(counts)} Personen</strong></p>
    </div>`;
  }

  function bindCounters(isManual) {
    document.querySelectorAll("[data-category]").forEach(button => {
      button.onclick = () => {
        const key = button.dataset.category;
        counts[key] = Math.max(0, Number(counts[key] || 0) + Number(button.dataset.delta));
        if (tariffMode === "family" && !familyEligible()) tariffMode = "regular";
        if (isManual) renderManual();
        else renderResult();
      };
    });

    if (!isManual && $("categoryToggle")) {
      $("categoryToggle").onclick = () => {
        showAllCategories = !showAllCategories;
        renderResult();
      };
    }
  }

  function regularPrice() {
    return Object.keys(categories).reduce((sum, key) => sum + Number(counts[key] || 0) * categories[key].price, 0);
  }

  function familyEligible() {
    const reducedPersons =
      Number(counts.child || 0) +
      Number(counts.youth || 0) +
      Number(counts.student || 0);

    const personRuleIsMet =
      Number(counts.adult || 0) >= Number(C.familyRule.minAdults || 1) &&
      reducedPersons >= Number(C.familyRule.minReducedPersons || 1);

    const priceRuleIsMet =
      C.familyRule.requireRegularPriceAboveFamilyPrice === false ||
      regularPrice() > Number(C.prices.family || 0);

    return personRuleIsMet && priceRuleIsMet;
  }

  function basePrice() {
    return tariffMode === "family" && familyEligible() ? C.prices.family : regularPrice();
  }

  function hasCorrectedEntry() {
    return String(correctedEntry).trim() !== "" && Number.isFinite(Number(correctedEntry));
  }

  function chosenPrice() {
    return hasCorrectedEntry() ? Math.max(0, Number(correctedEntry)) : basePrice();
  }

  function selectedCorrectionReason() {
    return correctionReasons.find(reason => reason.id === correctionReason) || null;
  }

  function reasonLabel() {
    return selectedCorrectionReason()?.label || "";
  }

  function correctionReasonOptionsHtml() {
    const options = [
      `<option value="" ${correctionReason === "" ? "selected" : ""}>Kein Grund</option>`
    ];

    correctionReasons.forEach(reason => {
      options.push(
        `<option value="${U.esc(reason.id)}" ${correctionReason === reason.id ? "selected" : ""}>${U.esc(reason.label)}</option>`
      );
    });

    return options.join("");
  }

  function priceHintText() {
    if (hasCorrectedEntry()) {
      return `Korrigierter Eintritt${reasonLabel() ? ` · ${reasonLabel()}` : ""}`;
    }
    return tariffMode === "family" ? "Familientarif" : "Regulärer Tarif";
  }

  function priceHtml(actionButtonHtml = "") {
    const familyPossible = familyEligible();
    const priceSummary = `<div class="price-box">
      <div>Zu zahlen</div>
      <div class="price-total" data-price-total>${U.euro(chosenPrice())}</div>
      <div data-price-hint>${U.esc(priceHintText())}</div>
    </div>`;

    return `<div class="price-editor">
      ${actionButtonHtml
        ? `<div class="price-action-row">${priceSummary}${actionButtonHtml}</div>`
        : priceSummary}
      <div class="card">
        <div class="tariff-row">
          <button data-tariff="regular" class="${tariffMode === "regular" ? "active-tariff" : ""}" type="button">Regulär ${U.euro(regularPrice())}</button>
          <button data-tariff="family" class="${tariffMode === "family" ? "active-tariff" : ""}" type="button" ${familyPossible ? "" : "disabled"}>Familientarif ${U.euro(C.prices.family)}</button>
        </div>
        <div class="correction-grid">
          <label>Korrigierter Eintritt
            <input data-corrected-entry type="number" min="0" step="0.50" inputmode="decimal" value="${U.esc(correctedEntry)}" placeholder="Euro">
          </label>
          <label>Grund
            <select data-correction-reason>
              ${correctionReasonOptionsHtml()}
            </select>
          </label>
        </div>
      </div>
    </div>`;
  }

  function visiblePriceEditor() {
    return document.querySelector(".panel:not(.hidden) .price-editor");
  }

  function bindPrice() {
    const editor = visiblePriceEditor();
    if (!editor) return;

    editor.querySelector('[data-tariff="regular"]').onclick = () => {
      tariffMode = "regular";
      renderCurrentEditor();
    };

    const familyButton = editor.querySelector('[data-tariff="family"]');
    familyButton.onclick = () => {
      if (!familyEligible()) return;
      tariffMode = "family";
      renderCurrentEditor();
    };

    const correctedInput = editor.querySelector("[data-corrected-entry]");
    correctedInput.addEventListener("input", event => {
      correctedEntry = event.target.value;
      updateVisiblePriceEditor();
    });

    const reasonSelect = editor.querySelector("[data-correction-reason]");
    reasonSelect.addEventListener("change", event => {
      correctionReason = event.target.value;
      const reason = selectedCorrectionReason();

      if (!reason) {
        correctedEntry = "";
      } else if (
        String(correctedEntry).trim() === "" &&
        reason.defaultAmount !== null &&
        reason.defaultAmount !== undefined
      ) {
        correctedEntry = String(reason.defaultAmount);
      } else if (reason.amountRequired && String(correctedEntry).trim() === "") {
        correctedEntry = "";
      }

      renderCurrentEditor();

      if (reason?.amountRequired && !hasCorrectedEntry()) {
        setTimeout(() => visiblePriceEditor()?.querySelector("[data-corrected-entry]")?.focus(), 20);
      }
    });
  }

  function updateVisiblePriceEditor() {
    const editor = visiblePriceEditor();
    if (!editor) return;

    const total = editor.querySelector("[data-price-total]");
    if (total) total.textContent = U.euro(chosenPrice());

    const hint = editor.querySelector("[data-price-hint]");
    if (hint) hint.textContent = priceHintText();
  }

  function renderCurrentEditor() {
    if (!$("manualPanel").classList.contains("hidden")) renderManual();
    else renderResult();
  }

  function validateCorrection() {
    const reason = selectedCorrectionReason();

    if (hasCorrectedEntry() && !reason) {
      toast("Bitte einen Grund für den korrigierten Eintritt auswählen.");
      return false;
    }

    if (reason?.amountRequired && !hasCorrectedEntry()) {
      toast(`Bei „${reason.label}“ muss ein korrigierter Eintritt eingetragen werden.`);
      return false;
    }

    return true;
  }


  async function confirmOfflineOperation(type = "checkin") {
    if (navigator.onLine && onlineState !== "offline") return true;

    if (type === "donation") {
      return await confirmBox(
        "Offline-Spende",
        "Spende trotz fehlender Verbindung erfassen? Es muss sichergestellt sein, dass während des Offlinebetriebs nur mit diesem einen Device Check-ins und Spenden erfasst werden.",
        "Offline erfassen"
      );
    }

    return await confirmBox(
      "Offline-Check-in",
      "Check-in trotz fehlender Verbindung durchführen? Es muss sichergestellt sein, dass während des Offlinebetriebs nur mit diesem einen Device die Check-ins durchgeführt werden.",
      "Offline einchecken"
    );
  }

  function successScrollPosition() {
    const actionRow = $("mainActionRow");
    const container = scrollContainer();
    if (!actionRow || !container) return 0;

    const containerRect = container.getBoundingClientRect();
    const actionRect = actionRow.getBoundingClientRect();

    return Math.max(
      0,
      container.scrollTop + actionRect.top - containerRect.top - 4
    );
  }

  async function completeExisting() {
    if (U.sumCounts(counts) < 1) {
      toast("Mindestens eine Person erforderlich.");
      return;
    }
    if (!validateCorrection()) return;

    let message = `${current.number} mit ${U.sumCounts(counts)} Personen und ${U.euro(chosenPrice())} Eintritt einchecken?`;
    if (current.status === "cancelled") message = "Stornierte Anmeldung als Ausnahme: " + message;
    if (current.status === "waitlist" && earlierWaitIds().length) {
      message = `Frühere Wartelistenanmeldungen sind noch offen. Trotzdem fortfahren? ${message}`;
    }

    if (!(await confirmBox("Check-in bestätigen", message, "Einchecken"))) return;
    if (!(await confirmOfflineOperation("checkin"))) return;

    const checkin = {
      token: current.token,
      number: current.number,
      name: current.name,
      counts: U.clone(counts),
      paid: chosenPrice(),
      basePrice: basePrice(),
      tariff: tariffMode,
      correctionReason,
      kind: current.status === "confirmed" ? "regular" : current.status === "waitlist" ? "waitlist" : "exception",
      offline: !navigator.onLine || onlineState === "offline",
      time: U.now()
    };

    if (window.AVT_BACKEND?.isConfigured()) {
      if (checkin.offline) {
        prepareOfflineOperation("checkin", checkin);
        data.checkins[current.token] = checkin;
        S.save(data);
      } else {
        const result = await saveOperationWithProgress("checkin", { checkin });
        checkin.operationId = result.operation.operationId;

        if (result.status === "cancelled") {
          return;
        }

        if (result.status === "rejected") {
          await handleRejectedOperation(result);
          return;
        }

        if (result.status === "duplicate") {
          renderSharedState();
          restartPolling();
          showMessage(
            "Bereits eingecheckt",
            "Diese Anmeldung wurde inzwischen auf einem anderen Gerät eingecheckt. Es wurde kein zweiter Check-in gespeichert. Der gemeinsame Gesamtstand wurde aktualisiert.",
            "warning",
            true
          );
          return;
        }

        checkin.offline = result.status === "queued";

        if (result.status === "queued") {
          data.checkins[current.token] = checkin;
          S.save(data);
        }
      }
    } else {
      data.checkins[current.token] = checkin;
      S.save(data);
    }

    restartPolling();
    renderSuccess(checkin);
  }

  function renderManual() {
    $("manualContent").innerHTML = `
      ${counterHtml(true)}
      ${priceHtml('<button id="manualComplete" class="primary checkin-side-button" type="button">Check-in abschließen</button>')}`;

    bindCounters(true);
    bindPrice();
    $("manualComplete").onclick = completeManual;
  }

  async function completeManual() {
    if (U.sumCounts(counts) < 1) {
      toast("Mindestens eine Person erforderlich.");
      return;
    }
    if (!validateCorrection()) return;

    if (!(await confirmBox("Unangemeldeten Check-in bestätigen", `${U.sumCounts(counts)} Personen mit ${U.euro(chosenPrice())} Eintritt erfassen?`, "Erfassen"))) return;
    if (!(await confirmOfflineOperation("checkin"))) return;

    const id = `M-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const checkin = {
      id,
      number: id,
      name: "Unangemeldeter Check-in",
      counts: U.clone(counts),
      paid: chosenPrice(),
      basePrice: basePrice(),
      tariff: tariffMode,
      correctionReason,
      kind: "manual",
      offline: !navigator.onLine || onlineState === "offline",
      time: U.now()
    };

    if (window.AVT_BACKEND?.isConfigured()) {
      if (checkin.offline) {
        prepareOfflineOperation("manualCheckin", checkin);
        data.sequence += 1;
        data.manual.push(checkin);
        S.save(data);
      } else {
        const result = await saveOperationWithProgress("manualCheckin", { checkin });
        checkin.operationId = result.operation.operationId;

        if (result.status === "cancelled") {
          return;
        }

        if (result.status === "rejected") {
          await handleRejectedOperation(result);
          return;
        }

        checkin.offline = result.status === "queued";

        if (result.status === "queued") {
          data.sequence += 1;
          data.manual.push(checkin);
          S.save(data);
        }
      }
    } else {
      data.sequence += 1;
      data.manual.push(checkin);
      S.save(data);
    }

    restartPolling();
    renderSuccess(checkin);
  }

  function renderSuccess(checkin) {
    lastSuccessCheckin = U.clone(checkin);
    panels.forEach(panel => $(panel).classList.add("hidden"));
    $("resultPanel").classList.remove("hidden");

    const detailPayload = {
      name: checkin.name,
      number: checkin.number,
      ids: current?.ids || [checkin.number],
      counts: checkin.counts,
      paid: checkin.paid,
      correctionReason: checkin.correctionReason || "",
      tariff: checkin.tariff || "regular",
      offline: !!checkin.offline,
      operationId: checkin.operationId || ""
    };

    $("resultContent").innerHTML = `
      ${syncStateBannerHtml(checkin)}
      <div class="card success success-compact">
        <div class="success-head">
          <h2>Check-in erfolgreich</h2>
          <button id="successDetailsBtn" class="secondary success-detail-button" type="button">Details</button>
        </div>
      </div>
      <button class="primary full summary-follow-button" data-nav="scan">Nächsten QR-Code scannen</button>
      ${currentStandHtml()}`;

    $("resultContent").querySelectorAll("[data-nav]").forEach(button => {
      button.onclick = () => nav(button.dataset.nav);
    });

    $("successDetailsBtn").onclick = () => showSuccessDetails(detailPayload);

    renderAll();
    updateHeaderStats();
    requestAnimationFrame(() => {
      scrollContainer()?.scrollTo({
        top: successScrollPosition(),
        behavior: "auto"
      });
    });
  }

  function showSuccessDetails(detailPayload) {
    const ids = detailPayload.ids || [detailPayload.number];
    const tariffLabel =
      detailPayload.tariff === "family"
        ? "Familientarif"
        : "Regulärer Tarif";

    const correctionLine = detailPayload.correctionReason
      ? `<p><strong>Korrekturgrund:</strong> ${U.esc(reasonLabelFromId(detailPayload.correctionReason) || detailPayload.correctionReason)}</p>`
      : "";
    const offlineLine = detailPayload.offline
      ? isCheckinStillQueued(detailPayload)
        ? `<p><strong>Speicherung:</strong> Offline zwischengespeichert, noch nicht synchronisiert</p>`
        : `<p><strong>Speicherung:</strong> Offline zwischengespeichert und erfolgreich synchronisiert</p>`
      : "";

    $("modalTitle").textContent = "Details zum Check-in";
    $("modalBody").innerHTML = `
      <p><strong>${U.esc(detailPayload.name)}</strong></p>
      <p><strong>IDs:</strong> ${ids.map(id => U.esc(id)).join(", ")}</p>
      <div class="ids-list">${ids.map(id => `<span>${U.esc(id)}</span>`).join("")}</div>
      <div class="card" style="margin:12px 0 0 0;padding:12px;">
        <h3 style="margin:0 0 8px 0;">Personenzahl</h3>
        <dl class="detail-grid">
          ${Object.keys(categories).filter(key => detailPayload.counts[key]).map(key => `<dt>${categories[key].label}</dt><dd>${detailPayload.counts[key]}</dd>`).join("")}
          <dt>Gesamt</dt><dd>${U.sumCounts(detailPayload.counts)}</dd>
        </dl>
      </div>
      <div class="card" style="margin:12px 0 0 0;padding:12px;">
        <h3 style="margin:0 0 8px 0;">Eintritt</h3>
        <p><strong>Tarif:</strong> ${U.esc(tariffLabel)}</p>
        <p><strong>Gezahlt:</strong> ${U.euro(detailPayload.paid)}</p>
        ${correctionLine}
        ${offlineLine}
      </div>`;
    $("modalTitle").textContent = "Details zum Check-in";
    $("modalConfirm").textContent = "Schließen";
    $("modalCancel").classList.add("hidden");
    $("modal").classList.remove("hidden");
    modalResolve = () => {
      $("modalCancel").classList.remove("hidden");
    };
  }

  function reasonLabelFromId(reasonId) {
    return correctionReasons.find(reason => reason.id === reasonId)?.label || "";
  }

  function actualPersonsHtml(personCounts) {
    return `<div class="card">
      <h3>Tatsächliche Personenzahl</h3>
      <dl class="detail-grid">
        ${Object.keys(categories).filter(key => personCounts[key]).map(key => `<dt>${categories[key].label}</dt><dd>${personCounts[key]}</dd>`).join("")}
        <dt>Gesamt</dt><dd>${U.sumCounts(personCounts)}</dd>
      </dl>
    </div>`;
  }

  function currentStandHtml() {
    const currentStats = stats();
    return `<div id="currentStandCard" class="card">
      <h3>Aktueller Gesamtstand</h3>
      <dl class="detail-grid">
        <dt>Regulär</dt><dd>${currentStats.regular}</dd>
        <dt>Warteliste</dt><dd>${currentStats.wait}</dd>
        <dt>Stornierte Ausnahmen</dt><dd>${currentStats.exceptions}</dd>
        <dt>Unangemeldet</dt><dd>${currentStats.manual}</dd>
        <dt>Gesamt anwesend</dt><dd>${currentStats.present} / ${C.event.maxPersons}</dd>
        <dt>Sicher freie Plätze</dt><dd>${currentStats.safe}</dd>
        <dt>Eintritt</dt><dd>${U.euro(currentStats.entry)}</dd>
        <dt>Spenden</dt><dd>${U.euro(currentStats.donations)}</dd>
        <dt>Offen – regulär</dt><dd>${currentStats.regularOpen}</dd>
        <dt>Offen – Warteliste</dt><dd>${currentStats.waitOpen}</dd>
      </dl>
    </div>`;
  }

  function renderDonationPanel(preserveInput = false) {
    if (!preserveInput) $("donationAmount").value = "";
    const currentStats = stats();
    $("donationSummary").innerHTML = `<div class="card">
      <h3>Bisher erfasste Spenden</h3>
      <dl class="detail-grid">
        <dt>Anzahl</dt><dd>${data.donations.length}</dd>
        <dt>Summe</dt><dd>${U.euro(currentStats.donations)}</dd>
      </dl>
    </div>`;
  }

  async function saveDonation() {
    const rawValue = $("donationAmount").value;
    const amount = Number(String(rawValue).replace(",", "."));

    if (!Number.isFinite(amount) || amount <= 0) {
      toast("Bitte einen gültigen Spendenbetrag eingeben.");
      return;
    }

    if (!(await confirmBox(
      "Spende bestätigen",
      `Spende von ${U.euro(amount)} erfassen?`,
      "Spende erfassen"
    ))) return;

    if (!(await confirmOfflineOperation("donation"))) return;

    const donation = {
      amount,
      time: U.now(),
      offline: !navigator.onLine || onlineState === "offline"
    };

    if (window.AVT_BACKEND?.isConfigured()) {
      if (donation.offline) {
        prepareOfflineOperation("donation", donation);
        donationNotice = {
          state: "pending",
          count: 1,
          operationId: donation.operationId
        };
        data.donations.push(donation);
        S.save(data);
      } else {
        const result = await saveOperationWithProgress("donation", { donation });
        donation.operationId = result.operation.operationId;

        if (result.status === "cancelled") {
          return;
        }

        if (result.status === "rejected") {
          await handleRejectedOperation(result);
          return;
        }

        donation.offline = result.status === "queued";

        if (result.status === "queued") {
          donationNotice = {
            state: "pending",
            count: 1,
            operationId: donation.operationId
          };
          data.donations.push(donation);
          S.save(data);
        } else {
          donationNotice = null;
        }
      }
    } else {
      data.donations.push(donation);
      S.save(data);
    }

    nav("home", { forceTop: true });
    renderSharedState();
    updateDonationSyncBanner();
    restartPolling();
    forcePageTop();

    toast(
      donation.offline
        ? "Spende offline gespeichert – noch nicht synchronisiert."
        : "Spende wurde erfasst."
    );
  }

  function renderOverview() {
    const currentStats = stats();
    $("presentTop").textContent = currentStats.present;
    const checkins = [
      ...Object.values(data.checkins),
      ...data.manual.map(item => ({ ...item, number: item.id, kind: "manual" }))
    ];

    $("overviewContent").innerHTML = `
      ${currentStandHtml()}
      <div class="card">
        <h3>Einnahmen</h3>
        <dl class="detail-grid">
          <dt>Eintritt</dt><dd>${U.euro(currentStats.entry)}</dd>
          <dt>Spenden</dt><dd>${U.euro(currentStats.donations)}</dd>
          <dt>Gesamteinnahmen</dt><dd>${U.euro(currentStats.total)}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>Erfasste Check-ins</h3>
        ${checkins.length
          ? checkins.map(item => `<p><strong>${U.esc(item.number)}</strong> · ${U.sumCounts(item.counts)} Personen · ${U.euro(item.paid)}</p>`).join("")
          : '<p class="muted">Noch keine Check-ins.</p>'}
      </div>`;
  }


  function showMessage(title, text, tone, withOverview = false) {
    panels.forEach(panel => $(panel).classList.add("hidden"));
    $("resultPanel").classList.remove("hidden");
    $("resultContent").innerHTML = `
      <div class="card ${tone || ""}"><h2>${U.esc(title)}</h2><p>${U.esc(text)}</p></div>
      ${withOverview ? '<button class="secondary full" data-nav="overview">Übersicht öffnen</button>' : ""}`;

    $("resultContent").querySelectorAll("[data-nav]").forEach(button => {
      button.onclick = () => nav(button.dataset.nav);
    });
  }

  function confirmBox(title, body, confirmText) {
    $("modalTitle").textContent = title;
    $("modalBody").textContent = body;
    $("modalConfirm").textContent = confirmText;
    $("modal").classList.remove("hidden");
    return new Promise(resolve => { modalResolve = resolve; });
  }

  function closeModal(value) {
    $("modal").classList.add("hidden");
    $("modalCancel").classList.remove("hidden");
    if (modalResolve) modalResolve(value);
    modalResolve = null;
  }

  function toast(message) {
    $("toast").textContent = message;
    $("toast").classList.remove("hidden");
    setTimeout(() => $("toast").classList.add("hidden"), 2200);
  }

  document.addEventListener("DOMContentLoaded", init);
})();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}
