# Architektur

## Bausteine

`src/game/engine.ts` ist die reine Chip- und Handlogik: Dealer/Blinds, Zugreihenfolge, Einsätze, Side Pots, Auszahlung und Chip-Erhaltung. `blinds.ts` berechnet Level und Pausen. `roomCore.ts` ist der deterministische Zustandsübergang für Tischbefehle; UI und Firebase benutzen dieselbe Logik. `settlement.ts` berechnet die Cash-Abrechnung. Änderungen an diesen Modulen brauchen gezielte Unit- und Mehrspieler-Tests.

Bei zwei Spielern trägt der Dealer zugleich den Small Blind und handelt vor dem Flop zuerst, danach zuletzt ([Poker TDA, „Button in Heads-up“](https://www.pokertda.com/view-poker-tda-rules/)). `engine.ts` speichert die tatsächlich gebuchten Blind-Plätze der aktuellen Hand; die Anzeige berechnet sie nach einer Auszahlung nicht aus den verbliebenen Stacks neu. Wenn eine Runde von mindestens drei auf zwei aktive Spieler schrumpft, erhält der vorherige Big Blind den Button, falls er noch mitspielt. So muss niemand den Big Blind zweimal hintereinander zahlen. Eine vollständig ausgezahlte Hand mit allen Chips bei einer Person löst auf Online-Tisch, TV-Ansicht und lokalem Tisch dieselbe Gewinneranzeige aus.

`src/online/firebase.ts` stellt Auth, Realtime Database, Listener und Presence bereit. `roomService.ts` legt Codes atomar an, verarbeitet Gästeanfragen als Host und schreibt Versionen transaktional. `firebaseConfig.ts` liest die öffentlichen Webwerte. Der Datenpfad ist `poker/v2`; die [Rules](../database.rules.json) erlauben Gästen keine direkten Änderungen am Tischzustand. `onDisconnect` entfernt Presence. Der Host ist deshalb während des Spiels ein benötigter Browser-Client; weder Cloud Functions noch Billing sind erforderlich.

`src/device/` enthält geschützte Browser-Speicherzugriffe, den Namen (`name`, mit Migration von `poker-chips-name`), letzten Tisch, Einstellungen, Vorlagen und den unabhängigen Ein-Gerät-Modus. Diese Daten bleiben beim Service-Worker-Update erhalten. Das Löschen der Websitedaten kann auch Firebase Anonymous Auth zurücksetzen.

`src/views/` enthält Startseite, Online-Tisch, TV-Ansicht und lokalen Tisch. `src/components/` enthält Einstellungen und Tischgrafik; `src/styles/` das Layout. Die Vue-Router-Basis folgt `import.meta.env.BASE_URL`. Firebase wird für die Startseite erst bei einer Online-Aktion geladen, damit ein Auth- oder Speicherfehler die App-Shell nicht ausblendet.

## Aktualisierung und Pages

`releases.json` ist die Quelle für die öffentliche Versionsnummer und sichtbare Änderungen. `shared/versioning.mjs` versteht öffentliche `0.N`, interne npm-`0.N.0` und alte `0.0.N`-Werte. `src/updates/` vergleicht die Versionen und steuert das Update-Popup. Vite schreibt `version.json` mit interner Version und sichtbarem Label, weil ältere installierte Builds einen dreiteiligen Wert erwarten. Der Service Worker wartet, bis Nutzer im Hauptmenü ausdrücklich aktualisieren. Sein Cache ist an die öffentliche Version gebunden; Nutzerdaten werden nicht geleert.

`npm run build:pages` setzt die Basis `/Poker-Chips-Online/`, baut mit ES2018-Ziel und kopiert `index.html` zu `404.html`. Das deckt direkte Raumlinks auf GitHub Pages ab. Die PWA-Start-URL, der Scope, Icons und gecachte App-Shell liegen unter derselben Basis. [Tests](TESTING.md) prüfen den ausgelieferten Build in Chromium, WebKit und iPhone-Viewport.

## Grenzen

Die App verwaltet Chips, keine echten Karten und keine Zahlungen. Der Host bestätigt Kartenphasen und Gewinner. Rules begrenzen Gastaktionen, aber eine absichtlich veränderte Host-App könnte einen falschen Spielstand schreiben. Timeouts werden vom aktiven Host verarbeitet; ist er offline, werden sie nach seiner Rückkehr aufgeholt. Vor einem produktiven Rules-Deploy immer den Emulator-Mehrspielertest ausführen.
