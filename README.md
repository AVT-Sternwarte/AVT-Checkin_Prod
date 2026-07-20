# AVT Check-in Frontend 1.0.0-rc.2

Produktivfrontend für GitHub Pages.

## Vor dem Hochladen

In `js/config.js`:

- die bestehende `/exec`-Adresse des Check-in-Backends eintragen
- `enabled: true` setzen

Danach den **gesamten Inhalt dieses Ordners** in die Wurzel des
Produktivrepositorys hochladen.

## Änderungen in 1.0.0-rc.2

- Login-Blocker behoben: Der Anmeldebutton ist ausdrücklich ein Submit-Button.
- Sichtbare Fehlermeldung bei Frontend- oder Loginfehlern.
- Dauerhafte Anmeldung gegen normale Seitenaktualisierung abgesichert.
- Datum und Uhrzeit in den Veranstaltungsdetails robust deutsch formatiert.
- Integrierte `help.html`.
- Eigener Fragezeichen-SVG-Button in der Kopfzeile.
- Abmelden, Aktualisieren und Hilfe passen auf dem iPhone 12 mini nebeneinander.
