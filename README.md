# AVT Check-in – Produktiv 1.1.1

**Das ist die Produktivfassung, KEINE GitHub-Demo.** Die Dateien dieses Ordners gehören ausschließlich in das *bestehende GitHub-Repository der produktiven Check-in-App*. Nicht in `AVT-Checkin_Test` hochladen.

- Bestehende GitHub-Pages-URL, Repo-Pfad, `manifest.webmanifest` mit `start_url: ./` und `id: ./` bleiben unverändert. Installierte iPhone-/Android-/Desktop-Symbole müssen nicht entfernt werden.
- `js/config.js` nutzt unverändert die bisherige produktive Apps-Script `/exec`-URL und dieselben produktiven `avt-checkin-prod-*`-Schlüssel für Sitzung, Gerät und Offlinewarteschlange.
- `version.json` meldet die aktuelle Version an vorhandene App-Installationen; `js/updater.js` prüft beim Start, beim erneuten Anzeigen und alle 5 Minuten bei sichtbarer App. Ein Banner bietet die Aktualisierung an. Nach dem Laden werden einmalig die Neuerungen gezeigt.
- Benutzer:innen müssen **nicht** über eine neue URL installieren. Bei länger geöffneter App ist für die Aktualisierung eine Bestätigung erforderlich, damit keine Eingaben oder Offline-Daten verloren gehen.
- `service-worker.js` darf nicht ausgelassen werden; `version.json` und alle Dateien zusammen übertragen. `version.json` möglichst zum Schluss hochladen.
- **Backend bleibt 1.1.0:** Die neue Frontend-Version 1.1.1 erwartet das bestehende, bereits bereitgestellte Check-in-Backend 1.1.0. Kein Apps-Script-Update nötig.
- Korrekturen sind nur online und bei synchronisierten Daten möglich. Nach „durchgeführt“ werden sie automatisch gesperrt: Das Backend liest den endgültigen Status aus `Archiv_Veranstaltungen` bzw. `Archiv_Summen` des bestehenden AVT-Veranstaltungskalenders. Es gibt keinen manuellen Sperrschalter.
