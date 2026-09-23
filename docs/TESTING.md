# Testen

Voraussetzungen: Node.js 22, Java 21 für Firebase-Emulatoren und Playwright-Browser. Alle Befehle im Repository-Root ausführen:

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

`build:pages` führt TypeScript, Vite und Release-Konsistenzprüfung aus. Die Nachprüfung verlangt `dist/index.html`, `404.html`, die korrekten Pages-Assetpfade, `version.json` mit beiden Versionsformen und den passenden Service-Worker-Cache. `test:e2e` startet einen lokalen Server für **dist** unter `/Poker-Chips-Online/` und testet Chromium, WebKit und iPhone-ähnliches WebKit: Start, Reload, Deep Links, Einstellungen, Updates, Offline-Shell und lokalen Tisch.

Vor Änderungen an `src/game/engine.ts` zusätzlich Heads-up und Mehrspieler-Zugreihenfolge, Side Pots und Chip-Erhaltung prüfen. Vor Änderungen an `src/online/` ebenso Raumcode-Kollision, Gastrechte, konkurrierende Sitzwahl und erneute Hostverbindung prüfen. Bei einem fehlgeschlagenen CI-Lauf zuerst den konkreten Job/Schritt lesen, lokal reproduzieren und nur den betroffenen Fehler beheben; nach jeder Korrektur die betroffenen Tests und den vollständigen Pflichtsatz erneut ausführen.

Browser-E2E kann iOS-Safari annähern, ersetzt aber keinen Test auf dem betroffenen iPhone. Für eine Geräteprüfung die veröffentlichte Root-URL und einen direkten Raumlink in Safari sowie als Home-Bildschirm-App öffnen, schließen und neu starten. Beim Update während einer Hand darf kein automatischer Reload stattfinden.
