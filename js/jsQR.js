/* jsQR 1.4.0 loader.
   Die Bibliothek wird beim ersten Onlineaufruf versionsfest geladen.
   Danach kann der Browser-/Service-Worker-Cache sie für den Offlinebetrieb verwenden.
   jsQR: Apache License 2.0.
*/
(function(){
  if (typeof window.jsQR === "function") return;
  var script = document.createElement("script");
  script.src = "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js";
  script.async = false;
  script.crossOrigin = "anonymous";
  document.head.appendChild(script);
})();
