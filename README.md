# Poker Chips Online

Pokerabend mit echten Karten und digitalen Chips für 2–9 Personen. Die mobile Vue-App läuft auf [GitHub Pages](https://hayvan2802.github.io/Poker-Chips-Online/) und synchronisiert Tische über Firebase Realtime Database im kostenlosen Spark-Tarif. Für eine Runde an einem Gerät gibt es einen lokalen Modus.

## Starten

Node.js 22 und für die Firebase-Emulatoren Java 21 installieren. Dann:

```sh
npm ci
npm run dev
```

Für den lokalen Mehrspieler-Modus die fünf Firebase-Webwerte in `.env.local` eintragen und `VITE_USE_EMULATORS=true` setzen. Die Vorlage steht in [.env.example](.env.example). Die Emulatoren starten mit:

```sh
npx firebase emulators:start --project demo-poker-chips --only auth,database
```

`npm run build:pages` erzeugt die veröffentlichbare App unter `/Poker-Chips-Online/` mit `404.html` für direkte Raumlinks. Dafür werden die Produktionswerte aus `.env.production` benötigt. `npm run deploy:rules` veröffentlicht **nur** die Datenbankregeln ins Firebase-Projekt `poker-chips-28`; die Website wird ausschließlich durch GitHub Actions veröffentlicht.

## So funktioniert ein Tisch

Spieler melden sich anonym bei Firebase an. Ein Host erstellt einen automatisch erzeugten oder eigenen sechsstelligen Code und leitet die Runde, solange sein Browser geöffnet ist. Andere Spieler treten bei, erhalten einen Sitz und senden Befehle an eine geschützte Warteschlange. Der Host verarbeitet sie mit der gemeinsamen Engine in Datenbanktransaktionen. Er bestätigt die Gewinner der echten Karten und die Pot-Auszahlung. Blind-, Zug- und Präsenzdaten liegen im Raum; Wiederholungen und veraltete Befehle werden abgefangen.

Das ist eine Vertrauensrunde: Die [Datenbankregeln](database.rules.json) sperren direkte Spielstandänderungen von Gästen, können aber einen absichtlich manipulierten Host-Client nicht neutralisieren. Ohne aktiven Host pausiert die Verarbeitung. Die anonyme Firebase-Identität bleibt in den Websitedaten des Geräts. Das Löschen dieser Daten kann die Host-Identität und lokale Runden entfernen.

## Projektübersicht

| Ort | Inhalt |
| --- | --- |
| `src/game/` | Poker-Engine, Blinds, Raumzustand und Abrechnung ohne Browser/Firebase |
| `src/online/` | Firebase-Initialisierung, Auth, Presence und transaktionale Raumverarbeitung |
| `src/device/` | Gerätespeicher, Profil, Einstellungen, Vorlagen und lokaler Tisch |
| `src/updates/` | Versionsvergleich und kontrollierte PWA-Aktualisierung |
| `src/views/`, `src/components/`, `src/styles/` | Seiten, wiederverwendbare Oberfläche und Design |
| `shared/`, `releases.json` | gemeinsamer Versionsparser und deutsche Versionshistorie |
| `scripts/`, `tests/`, `.github/workflows/` | Build-/Release-Prüfungen, Tests und Pages-Veröffentlichung |

Details: [Architektur](docs/ARCHITECTURE.md) · [Tests](docs/TESTING.md) · [Veröffentlichung und Versionen](docs/RELEASING.md) · [Anleitung für Coding Agents](AGENTS.md).

## Versionen

Die sichtbaren Versionen zählen fortlaufend **v0.1, v0.2, … v0.10, v0.11**. `releases.json` ist die Quelle für Versionsnummer, Datum und deutsche Hinweise. npm verlangt drei Zahlenteile, deshalb entspricht v0.11 intern `0.11.0`; `version.json` enthält beide Formen, damit ältere Installationen das Update erkennen. Der Service-Worker-Cache und das GitHub Release verwenden v0.11. Bereits vorhandene v0.0.x-Tags werden nicht verschoben. Einzelheiten und die Zuordnung der historischen Commits stehen in [RELEASING.md](docs/RELEASING.md).

Die App prüft im Hintergrund alle 15 Sekunden auf neue Versionen und zeigt den Hinweis nur außerhalb laufender Tische. Aktualisiert wird erst nach Tippen auf **Aktualisieren & neu starten**. Die Versionshistorie steht unter **Einstellungen → Daten & App**. Spielername, Einstellungen, Firebase Auth und lokale Runden werden bei einem App-Update nicht gelöscht.

## Sicherheit und Betrieb

Die Firebase-Webkonfiguration in `.env.production` ist im Browser-Bundle sichtbar. Ihr API-Key ist kein Admin-Schlüssel; Auth und [Rules](database.rules.json) schützen die Daten. Der Schlüssel ist im Google-Cloud-Projekt auf Firebase-bezogene APIs eingeschränkt, ohne aktive Cloud-Abrechnung. HTTP-Referrer-Beschränkungen sind derzeit nicht gesetzt; Missbrauch des kostenlosen Kontingents bleibt möglich. Das Verschieben in ein GitHub Secret würde den Schlüssel **nicht** aus dem ausgelieferten JavaScript entfernen. Änderungen an API-Beschränkungen, App Check oder Schlüsselrotation müssen mit iPhone/Safari und dem Pages-Build geprüft werden.

Firebase Authentication → **Anonym** und die aktuellen Realtime-Database-Rules müssen im Projekt `poker-chips-28` aktiv sein. Die Website benötigt kein Billing, keine Cloud Functions und kein Firebase Hosting. Automatisierte Tests benutzen ausschließlich `demo-poker-chips` in Emulatoren und verändern keine produktiven Räume.
