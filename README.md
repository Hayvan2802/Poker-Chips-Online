# Poker Chips Online

Mobile Begleit-App für echte Karten und digitale Chips, für 2–9 Personen. Vue 3, TypeScript, Firebase Authentication und Realtime Database. Die Website läuft auf GitHub Pages.

## Kostenlos ohne Zahlungsmittel

Die App verwendet den **Firebase-Spark-Tarif**. Sie benötigt weder Cloud Functions noch ein Blaze-Upgrade oder ein hinterlegtes Zahlungsmittel. Die kostenlosen Kontingente von Firebase gelten weiterhin.

Der Browser des Hosts leitet den Tisch: Gäste senden Aktionen an eine geschützte Warteschlange; der Host prüft sie mit der gemeinsamen Poker-Engine und schreibt den Spielstand in einer Datenbanktransaktion. **Der Host muss den Tisch geöffnet und sein Gerät wach halten.** Nach dem erneuten Öffnen desselben Tisches im selben Browser wird die Verarbeitung fortgesetzt. Abgelaufene Anfragen werden abgewiesen.

Das ist eine Vertrauensrunde: Der Host ist Spielleiter und bestätigt auch die Gewinner der echten Karten. Die Regeln schützen gegen direkte Spielstand-Änderungen durch Gäste; sie schützen nicht gegen einen absichtlich manipulierten Host-Client. Die anonyme Identität bleibt im Browser gespeichert. Werden dessen Websitedaten gelöscht, geht die Host-Identität verloren.

## Lokale Entwicklung

Voraussetzungen: Node.js 22 und Java 21 für die Firebase-Emulatoren.

```sh
npm ci
npm test
npm run test:multiplayer
```

Der Integrationstest startet ausschließlich Auth- und Database-Emulatoren mit dem isolierten Projekt `demo-poker-chips`. Er prüft unabhängige Spieler, atomare Sitzwahl, Gastrechte, gefälschte Absender, zwei vollständige Hände, doppelte Anfragen, Chip-Erhaltung und erneutes Starten des Hosts.

Für eine lokale Oberfläche mit Emulatoren `.env.local` anlegen:

```dotenv
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-poker-chips.firebaseapp.com
VITE_FIREBASE_DATABASE_URL=https://demo-poker-chips-default-rtdb.firebaseio.com
VITE_FIREBASE_PROJECT_ID=demo-poker-chips
VITE_FIREBASE_APP_ID=demo-app
VITE_USE_EMULATORS=true
```

Dann in zwei Terminals:

```sh
npx firebase emulators:start --project demo-poker-chips --only auth,database
npm run dev
```

## Firebase und Veröffentlichung

Projekt: `poker-chips-28`. Realtime Database: `poker-chips-28-default-rtdb` in `europe-west1`. **Authentication → Anonym** muss aktiviert sein. Die konkrete Web-App-Konfiguration steht in `.env.production`. Das sind öffentliche Firebase-Webkennungen, keine Admin-Zugangsdaten; die Zugriffskontrolle übernehmen Authentication und `database.rules.json` ([Firebase-Dokumentation](https://firebase.google.com/docs/projects/api-keys)).

```sh
npx firebase login
npx firebase deploy --only database --project poker-chips-28
npm run build:pages
```

`build:pages` baut für `/Poker-Chips-Online/`, erzwingt deaktivierte Emulatoren und erzeugt `404.html` für direkte Raum- und Einladungslinks. Fehlende Firebase-Werte brechen den Build ab. Eine lokale `.env.local` mit Emulatorwerten vor einem Produktionsbuild entfernen oder umbenennen.

Der Workflow `.github/workflows/pages.yml` prüft Engine und Multiplayer, baut die Website und veröffentlicht das geprüfte Build-Artefakt direkt mit `actions/deploy-pages`. Unter **Settings → Pages → Source** muss **GitHub Actions** ausgewählt sein. Jeder Push auf `main` veröffentlicht nach bestandenen Tests die neue Version; der bisherige `gh-pages`-Branch wird nicht mehr benötigt. Es sind keine GitHub-Secrets für die öffentlichen Firebase-Webkennungen erforderlich.

Die Datenbankregeln werden separat mit dem oben genannten Firebase-Befehl veröffentlicht. `firebase.json` enthält bewusst keine Functions-Konfiguration.

## Spiel und Sicherheit

- Räume werden atomar über sechsstellige Codes erstellt. Spieler melden sich anonym an und treten per Code bei.
- Die Daten liegen unter `poker/v2`. Nur Mitglieder lesen den vollständigen Raum. Nur der ursprüngliche Host schreibt Mitgliedschaft, Einstellungen und Spielstand; Gäste schreiben eigene Anfragen und Presence.
- Jede verarbeitete Anfrage hat eine `actionId`; Spielbefehle prüfen zusätzlich `expectedVersion`. Wiederholungen werden erkannt, konkurrierende Änderungen abgewiesen.
- Der Host darf Stack und Blinds in der Lobby ändern. Alle Spieler brauchen einen Sitz und müssen bereit sein.
- Karten bleiben real. Dealer oder Host bestätigen Austeilen, Flop, Turn und River. Die Engine verarbeitet Check, Call, Bet, Raise, Fold und All-in sowie Side Pots und Split Pots.
- Ein alleiniger Fold-Gewinner wird automatisch ausgezahlt. Im Showdown bestimmt der Host die Gewinner je Pot. Die nächste Hand verschiebt den Dealer zum nächsten Spieler mit Chips.
- Direkte Änderungen der Stacks, Übernahme der Hostrolle und gefälschte Anfragen durch Gäste sind durch Firebase Rules gesperrt. Bei Verbindungsverlust oder abwesendem Host pausiert die Oberfläche Aktionen.
