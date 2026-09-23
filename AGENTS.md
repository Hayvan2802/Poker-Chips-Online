# Poker Chips: Arbeitsanleitung für Agents

Diese Datei gilt für das ganze Repository. Vor Änderungen [README.md](README.md), [Architektur](docs/ARCHITECTURE.md), [Tests](docs/TESTING.md) und [Release-Ablauf](docs/RELEASING.md) lesen. Bei Änderungen an Befehlen, Struktur oder Veröffentlichung diese Dokumentation im selben PR aktualisieren.

## Grenzen

- Poker Chips muss mit Firebase **Spark ohne Zahlungsmittel** funktionieren. Keine Cloud Functions, Firebase Hosting oder andere Billing-Pflicht einführen. Pages liefert die App aus; Firebase liefert Auth und Realtime Database.
- Räume unter `poker/v2`, laufende Chipstände, lokale Runden, Spielernamen und anonyme Firebase-Identitäten bei Updates erhalten. Keine Migration, die Websitedaten/IndexedDB pauschal leert.
- Gäste dürfen Tischzustand nicht direkt schreiben. Den Host-Befehlspfad, `actionId`, `expectedVersion`, Transaktionen, Presence und Rules gemeinsam betrachten. Niemals mit produktiven Räumen testen.
- Karten sind echt; der Host bestätigt Gewinner und Auszahlungen. Jede Änderung an Blinds, Dealer, Zugreihenfolge, Side Pots oder Timern braucht passende Tests für zwei und mehrere Spieler.

## Zuständigkeiten im Code

- `src/game/`: reine Poker- und Raumlogik. Keine DOM- oder Firebase-Abhängigkeiten.
- `src/online/`: Firebase Auth, Database, Presence und Host-Verarbeitung.
- `src/device/`: geschützter Gerätespeicher und lokale Runden.
- `src/updates/`, `shared/versioning.mjs`, `releases.json`: Update-Pfad und **eine** redaktionelle Versionsquelle.
- `src/views/`, `src/components/`, `src/styles/`: mobile Oberfläche und App-Shell.
- `scripts/`, `tests/`, `.github/workflows/pages.yml`: Release-Vertrag, Browser-/Emulator-Tests, Deploy.

## Reihenfolge für eine Änderung

1. Aktuellen Branch, `git status`, relevante Dateien und offene CI-Fehler prüfen. Arbeit isoliert in einem Feature-Branch/Worktree; fremde uncommitted Änderungen erhalten.
2. Änderung mit passenden Tests umsetzen. Browser-Fallbacks müssen die Grundoberfläche weiter rendern lassen. Auf iPhone-Touchflächen, Safe Area und Pages-Basis `/Poker-Chips-Online/` achten.
3. Für einen sichtbaren Release `npm run release:prepare -- 0.N "Deutscher Hinweis"` mit **nächster** Nummer ausführen. Öffentlich wird v0.N angezeigt, npm verwendet 0.N.0. Alte v0.0.x-Werte bei gespeicherten Update-Markern weiter lesen. Vorhandene Tags nie verschieben oder löschen.
4. Pflicht: `npm ci`, `npm run release:check`, `npm test`, `npm run test:multiplayer`, `npm run build:pages`, `npm run test:e2e` sowie `git diff --check`. `dist`-Pfade und `version.json` prüfen. WebKit und iPhone-Projekt sind Teil der E2E-Suite.
5. Commit, Branch pushen, PR gegen `main` erstellen und CI auswerten. Fehler selbst reproduzieren, korrigieren und erneut prüfen. **Erst grünen PR mergen.** Main-Workflow prüft erneut, deployt Pages und erzeugt danach den passenden GitHub Release/Tag. Die Live-URL und Versionsantwort verifizieren.

Nur `npm run deploy:rules` veröffentlicht Datenbankregeln, nach erfolgreichem Emulator-Test und bei beabsichtigter Rules-Änderung. Der alte pauschale Firebase-Deploy-Befehl darf nicht verwendet werden. Produktive Webwerte nicht in Logs, PR-Beschreibungen oder Antworten kopieren. Der Firebase-Web-API-Key ist öffentlich sichtbar und kein Ersatz für Regeln.
