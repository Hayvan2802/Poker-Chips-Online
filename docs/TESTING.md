# Testen

Voraussetzungen: Node.js ab 22.16, Java 21 für Firebase-Emulatoren und Playwright-Browser. Alle Befehle im Repository-Root ausführen:

```sh
npm ci
npm run release:check
npm test
npm run test:multiplayer
npm run build:pages
npx playwright install chromium webkit
npm run test:e2e
```

`npm test` prüft Engine, Raumzustände, Timer, Abrechnung, Browser-Fallbacks und Versionsmigration. `test:multiplayer` startet Auth- und Database-Emulatoren unter `demo-poker-chips` und prüft unter anderem unabhängige Clients, Security Rules, doppelte Befehle, Hostwechsel, Reconnect, Blinds und Auszahlung. Java wird nur für diesen Test benötigt. Der Test berührt keine produktiven Räume.

Die Audit-Regressionsprüfungen decken zusätzlich kurze All-ins, Big-Blind-Antes, tote Blind-/Button-Positionen, Pot-Zusammenführung und 240 deterministisch erzeugte Hände mit Chip-Erhaltung ab. `localRoomSafety` prüft gültige alte und beschädigte Speicherstände. `updateSafety` prüft Tischrouten und Grenzen der Cache-Bereinigung; `onlineTimeout` prüft hängende Lesezugriffe und verspätete Antworten. Die drei Emulator-Suites prüfen auch dieselbe UID in getrennten Firebase-Clients, veränderte Wiederholungsanfragen, begrenzte Nutzdaten und Presence nach Reconnect.

`build:pages` führt TypeScript, Vite und Release-Konsistenzprüfung aus. Die Nachprüfung verlangt `dist/index.html`, `404.html`, die korrekten Pages-Assetpfade, `version.json` mit beiden Versionsformen und den passenden Service-Worker-Cache. `test:e2e` startet einen lokalen Server für **dist** unter `/Poker-Chips-Online/` und testet Chromium, WebKit und iPhone-ähnliches WebKit: Start, Reload, Deep Links, Einstellungen, Updates, Offline-Shell und lokalen Tisch.

`local-save-recovery.spec.ts` prüft Sicherung, Erhalt und bewusstes Löschen beschädigter Daten; `table-safety.spec.ts` das Einfrieren und Fortsetzen beider lokalen Timer. `update-activation.spec.ts` liefert zwei echte gebaute Deployments über einen isolierten lokalen Server aus: neues Menü, alter pausierter Spieltab, Offline-Navigation mit altem Lazy-Chunk und anschließende gezielte Cache-Bereinigung. Dieser zusätzliche Mehrtab-Offline-Worker-Test läuft in Chromium; in den beiden WebKit-Projekten wird er ausdrücklich übersprungen, weil Playwrights WebKit-Port Offline-Worker-Anfragen nicht zuverlässig über `setOffline` steuert. Die übrigen Browserfälle laufen in allen drei Projekten.

Playwright verwendet vier lokale beziehungsweise zwei CI-Worker, um die parallele Last auf Browser- und Netzwerkprozesse zu begrenzen. Testartefakte liegen unter ignorierten `test-results*`-Verzeichnissen und gehören nicht in den Commit.

Vor Änderungen an `src/game/engine.ts` zusätzlich Heads-up und Mehrspieler-Zugreihenfolge, Side Pots und Chip-Erhaltung prüfen. Vor Änderungen an `src/online/` ebenso Raumcode-Kollision, Gastrechte, konkurrierende Sitzwahl und erneute Hostverbindung prüfen. Bei einem fehlgeschlagenen CI-Lauf zuerst den konkreten Job/Schritt lesen, lokal reproduzieren und nur den betroffenen Fehler beheben; nach jeder Korrektur die betroffenen Tests und den vollständigen Pflichtsatz erneut ausführen.

Browser-E2E kann iOS-Safari annähern, ersetzt aber keinen Test auf dem betroffenen iPhone. Für eine Geräteprüfung die veröffentlichte Root-URL und einen direkten Raumlink in Safari sowie als Home-Bildschirm-App öffnen, schließen und neu starten. Beim Update während einer Hand darf kein automatischer Reload stattfinden.
