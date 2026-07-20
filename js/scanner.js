"use strict";

window.AVT_SCANNER = (function () {
  let stream = null;
  let frameId = null;
  let scanning = false;
  let onCode = null;
  let lastScanAt = 0;

  const video = () => document.getElementById("cameraVideo");
  const canvas = () => document.getElementById("cameraCanvas");
  const status = () => document.getElementById("cameraStatus");

  function setStatus(message) {
    const target = status();
    if (target) target.textContent = message || "";
  }

  async function start(callback) {
    onCode = callback;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Dieser Browser stellt keinen Kamerazugriff bereit.");
    }
    if (typeof window.jsQR !== "function") {
      throw new Error("Die QR-Erkennung konnte nicht geladen werden. Internetverbindung prüfen.");
    }

    stop();
    setStatus("Kamera wird geöffnet …");
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 960 }
      }
    });

    const v = video();
    v.srcObject = stream;
    v.setAttribute("playsinline", "true");
    await v.play();
    scanning = true;
    setStatus("QR-Code in den Rahmen halten.");
    scanFrame();
  }

  function scanFrame(timestamp = 0) {
    if (!scanning) return;
    const v = video();
    if (v.readyState >= 2 && timestamp - lastScanAt > 90) {
      lastScanAt = timestamp;
      const c = canvas();
      const width = v.videoWidth;
      const height = v.videoHeight;
      if (width && height) {
        const maxWidth = 720;
        const scale = Math.min(1, maxWidth / width);
        c.width = Math.round(width * scale);
        c.height = Math.round(height * scale);
        const ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const image = ctx.getImageData(0, 0, c.width, c.height);
        const code = window.jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
        if (code?.data) {
          const handler = onCode;
          stop();
          if (handler) handler(code.data);
          return;
        }
      }
    }
    frameId = requestAnimationFrame(scanFrame);
  }

  function stop() {
    scanning = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = null;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    const v = video();
    if (v) {
      v.pause();
      v.srcObject = null;
    }
  }

  async function decodeImageFile(file) {
    if (typeof window.jsQR !== "function") {
      throw new Error("Die QR-Erkennung konnte nicht geladen werden.");
    }

    const source = await loadImageSource(file);
    const width = source.width || source.naturalWidth;
    const height = source.height || source.naturalHeight;
    const c = canvas();
    const maxWidth = 1400;
    const scale = Math.min(1, maxWidth / width);
    c.width = Math.max(1, Math.round(width * scale));
    c.height = Math.max(1, Math.round(height * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, c.width, c.height);
    source.close?.();
    if (source.__objectUrl) URL.revokeObjectURL(source.__objectUrl);
    const image = ctx.getImageData(0, 0, c.width, c.height);
    const result = window.jsQR(image.data, image.width, image.height, { inversionAttempts: "attemptBoth" });
    if (!result?.data) throw new Error("Auf dem ausgewählten Bild wurde kein QR-Code erkannt.");
    return result.data;
  }

  async function loadImageSource(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file);
    }
    const objectUrl = URL.createObjectURL(file);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => { image.__objectUrl = objectUrl; resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Das ausgewählte Bild konnte nicht geöffnet werden.")); };
      image.src = objectUrl;
    });
  }

  return { start, stop, decodeImageFile, setStatus };
})();
