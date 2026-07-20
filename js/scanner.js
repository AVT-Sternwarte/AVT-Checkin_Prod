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

  return { start, stop, setStatus };
})();
