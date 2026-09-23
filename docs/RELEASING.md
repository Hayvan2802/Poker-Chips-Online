# Versionen und Veröffentlichung

## Zählung und historische Zuordnung

Die öffentliche Folge ist **v0.1, v0.2, … v0.10, v0.11, … v0.100**. `releases.json` enthält Version, Datum und verständliche deutsche Änderungen in absteigender Reihenfolge. Es ist die einzige redaktionelle Versionsquelle. npm benötigt dreiteilige SemVer: öffentliches **v0.11** entspricht technisch `package.json`/Lock **0.11.0**. `version.json` liefert `{version:"0.11.0",label:"0.11"}`; alte v0.0.x-Installationen können den dreiteiligen Wert noch erkennen. App, Cache und neues GitHub Release zeigen v0.11. `release:check` und der Pages-Build sperren Abweichungen.

| Öffentliche Version | Commit des damaligen Stands | Datum | Inhalt |
| --- | --- | --- | --- |
| v0.1 | `7d80e0a` | 21.09.2026 | Projektstart |
| v0.2 | `484f7df` | 21.09.2026 | mobile App und Firebase |
| v0.3 | `fc11620` | 21.09.2026 | Pages-Deployment |
| v0.4 | `86e922a` | 21.09.2026 | Startseite ohne Firebase-Konfiguration |
| v0.5 | `b2328bd` | 22.09.2026 | Multiplayer auf Spark |
| v0.6 | `937ff56` | 22.09.2026 | reproduzierbarer CI-Build |
| v0.7 | `8e55fcc` | 22.09.2026 | runder Tisch und Spieltimer |
| v0.8 | `fb0e15a` | 23.09.2026 | Safari-App-Shell und Updates; PR #4 |
| v0.9 | `63b9b1c` | 23.09.2026 | drei Phasen Tischkomfort; PR #5 |
| v0.10 | `b35831a` | 23.09.2026 | automatische Update-Hinweise; PR #6 |

Die früheren Tags/Releases `v0.0.x` bleiben unverändert. Besonders `v0.0.1` zeigt auf den damaligen v0.7-Stand; ein Umhängen würde die Git-Historie verfälschen. Historische `v0.x`-Tags dürfen nur zusätzlich auf die in der Tabelle geprüften Commits gesetzt werden. Die in der App rückwirkend berichtigte Historie schreibt keine Commits um.

## Jeden Release vorbereiten

1. Von aktuellem `main` einen Arbeitsbranch erstellen. Architektur, Regeln und [Tests](TESTING.md) lesen. Nur Änderungen für diesen Release aufnehmen.
2. Deutsche Hinweise mit **der nächsten freien** öffentlichen Nummer vorbereiten, zum Beispiel:

   ```sh
   npm run release:prepare -- 0.12 "Änderung für Spieler" "Weitere Änderung"
   ```

   Das Skript schreibt `releases.json`, `package.json` und `package-lock.json`. Datum und Texte prüfen. Tags niemals verschieben oder wiederverwenden.
3. Pflichtprüfungen aus [TESTING.md](TESTING.md) ausführen, besonders `npm ci`, `npm test`, `npm run test:multiplayer`, `npm run build:pages`, `npm run test:e2e`. `git diff --check` und den gebauten `dist/version.json` prüfen. `dist/` bleibt unversioniert.
4. Commit erstellen und Branch pushen. PR gegen `main` mit Verhalten, Risiken und Testergebnissen erstellen. Den CI-Lauf vollständig abwarten; roten Lauf beheben und erneut prüfen. Erst den grünen PR mergen.
5. Ein Push auf `main` baut und testet erneut, deployt das geprüfte `dist` via GitHub Actions nach Pages und legt **erst nach erfolgreichem Deploy** GitHub Release/Tag `v0.N` mit den Texten aus `releases.json` an. Nicht vorab einen gleichnamigen Tag setzen. Nach dem Lauf Root-URL, Raumlink und `version.json` live prüfen.

GitHub **Settings → Pages → Source** muss auf **GitHub Actions** stehen. Produktionswerte müssen für den Build verfügbar sein; aktuell liegen die öffentlichen Firebase-Webwerte in `.env.production`. Werden sie aus dem Repository entfernt, müssen zuvor fünf `VITE_FIREBASE_*`-Werte reproduzierbar als Repository Variables/Secrets in den Workflow eingespeist werden. Die ausgelieferte Web-App enthält sie weiterhin. Datenbankregeln werden separat nach Emulatorprüfung mit `npm run deploy:rules` veröffentlicht; Pages übernimmt keine Rules.

Falls Deployment oder Release-Erstellung nach einem grünen Build scheitert, denselben Workflow/Commit erneut starten und den Fehler im betroffenen Schritt beheben. Die Release-Aktion prüft vorhandene Tags und erzeugt keine neue Version für einen fehlgeschlagenen Deploy. Einen existierenden Tag nicht löschen oder verschieben, um den Job zu übergehen.
