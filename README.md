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

Der Integrationstest startet ausschließlich Auth- und Database-Emulatoren mit dem isolierten Projekt `demo-poker-chips`. Er prüft unabhängige Spieler, atomare Sitzwahl, Gastrechte, gefälschte Absender, zwei vollständige Hände, doppelte Anfragen, Chip-Erhaltung, synchronisierte Blind-Level und erneutes Starten des Hosts. Die zusätzlichen Zustands-Tests prüfen Timer-Grenzen, Rundung, abgeschaltete Timer und alte Räume.

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

## Versionen und Updates

Die nummerierte Release-Historie beginnt mit **v0.0.1**. Frühere Veröffentlichungen sind Git-Commits ohne nachträglich erfundene Release-Nummern. `releases.json` enthält die deutschen Versionshinweise; `package.json` und die Lockdatei tragen dieselbe Version. Der Build prüft deren Übereinstimmung und erzeugt eine nicht offline zwischengespeicherte `version.json`.

Für jede weitere sichtbare Veröffentlichung die Version erhöhen:

```sh
npm run release:prepare -- 0.0.2 "Erste Änderung" "Weitere Änderung"
```

Nach erfolgreichem Test, Build und Pages-Deployment legt der Workflow das GitHub-Release samt Tag und Versionshinweisen an. Bestehende Tags werden nicht verändert. Im Einstellungsdialog gibt es die installierte Version, die Versionshistorie, eine manuelle Update-Prüfung und „Aktualisieren & neu starten“. Die App prüft zusätzlich bei Fokus und einmal pro Minute im Vordergrund. Sie lädt während einer Hand niemals eigenständig neu.

„App-Cache leeren & neu starten“ entfernt ausschließlich Poker-Chips-App-Dateien und den Service Worker dieses App-Pfads. Firebase-Daten in IndexedDB und der lokale Name bleiben erhalten. Zum Reparieren wird zuerst geprüft, ob die Website erreichbar ist; offline wird der Cache beibehalten.

## Spiel und Sicherheit

- Räume werden atomar über sechsstellige Codes erstellt. Der Host kann einen Code vorgeben (z. B. `123456`) oder einen automatisch erzeugen lassen. Bereits belegte Codes werden abgewiesen, bestehende Tische niemals überschrieben. Spieler melden sich anonym an und treten per Code bei.
- Spieler bekommen beim Beitritt automatisch einen freien Sitz. In der Lobby können sie auf einen freien Platz am runden Tisch wechseln. Die gleiche Sitzordnung bleibt im Spiel erhalten; Dealer, Small Blind, Big Blind und der aktive Spieler sind markiert.
- Die Daten liegen unter `poker/v2`. Nur Mitglieder lesen den vollständigen Raum. Nur der ursprüngliche Host schreibt Mitgliedschaft, Einstellungen und Spielstand; Gäste schreiben eigene Anfragen und Presence.
- Jede verarbeitete Anfrage hat eine `actionId`; Spielbefehle prüfen zusätzlich `expectedVersion`. Wiederholungen werden erkannt, konkurrierende Änderungen abgewiesen.
- Jeder Zug hat 30 Sekunden Bedenkzeit. Die Frist liegt im gemeinsamen Spielstand und bleibt beim Neuladen erhalten. Der aktive Host verarbeitet abgelaufene Züge atomar als Fold; mehrere Host-Tabs können dieselbe Frist nicht doppelt ausführen. Bei einem pausierten Host erfolgt die Verarbeitung nach seiner Rückkehr. Gewinnerbestätigung und Kartenaufdecken haben keinen Zug-Timer.
- Der Host darf Stack und Blinds in der Lobby ändern. Alle Spieler brauchen einen Sitz und müssen bereit sein.
- Neue Tische starten mit einem einstellbaren Blind-Timer (Standard: 20 Minuten, Verdopplung). Möglich sind 1–180 Minuten, +50 % oder Verdopplung sowie feste Blinds ohne Timer. Bestehende Räume ohne Timer-Felder behalten ihre festen Blinds.
- Der Countdown beginnt beim ersten Austeilen und verwendet die Firebase-Serverzeit. Ein abgelaufenes Level wird erst beim Vorbereiten bzw. Austeilen der nächsten Hand übernommen. Eine lange Hand überspringt keine Level; nach einer Erhöhung startet beim Austeilen wieder das volle Intervall. Neuladen oder Host-Wiederverbindung setzt den laufenden Countdown nicht zurück. Bruchteile von Chips werden bei +50 % aufgerundet; Blinds sind auf eine Milliarde Chips begrenzt.
- Karten bleiben real. Dealer oder Host bestätigen Austeilen, Flop, Turn und River. Die Engine verarbeitet Check, Call, Bet, Raise, Fold und All-in sowie Side Pots und Split Pots.
- Jede Auszahlung braucht die Bestätigung des Hosts. Ein Dialog öffnet sich automatisch am Ende der Hand, auch wenn alle bis auf einen Spieler gepasst haben. Der Host bestimmt die berechtigten Gewinner je Pot; mehrere Gewinner teilen ihn. Bereits abgezogene Einsätze werden dabei nicht doppelt belastet. Erst nach der Auszahlung ist die nächste Hand möglich; sie verschiebt den Dealer zum nächsten Spieler mit Chips.
- Direkte Änderungen der Stacks, Übernahme der Hostrolle und gefälschte Anfragen durch Gäste sind durch Firebase Rules gesperrt. Bei Verbindungsverlust oder abwesendem Host pausiert die Oberfläche Aktionen.
