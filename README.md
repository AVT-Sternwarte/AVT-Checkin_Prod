# AVT Check-in – Produktivkandidat 1.0.0-rc.1

Frontend für GitHub Pages. Die Anwendung wird erst funktionsfähig, nachdem in
`js/config.js` die `/exec`-Adresse des produktiven Check-in-Backends eingetragen
und `enabled: true` gesetzt wurde.

Die Produktivdaten und Voranmeldungen sind nicht in diesem Repository enthalten.
Sie werden nach erfolgreicher Anmeldung aus dem Apps-Script-Backend geladen.

Wichtig: Diese Fassung ist ein Release Candidate. Vor dem echten Einsatz muss
der vollständige Produktivtest gemäß der mitgelieferten Dokumentation erfolgreich
abgeschlossen werden.

## QR-Scanner und Offlinebetrieb

Die QR-Bibliothek wird beim ersten Onlineaufruf versionsfest geladen und durch den Service Worker zwischengespeichert. Die Produktivseite sollte deshalb auf jedem verwendeten Gerät mindestens einmal mit stabiler Internetverbindung vollständig geöffnet werden, bevor ein Offlineeinsatz getestet wird.
