# Poker Chips Online

Mobile Begleit-App für einen echten No-Limit-Texas-Hold'em-Abend. Karten bleiben am Tisch; Mitglieder, Sitze, Bereitschaft und Chips werden über Firebase synchronisiert. Das Projekt ist eine eigenständige Vue-3-/TypeScript-Implementierung.

## Lokal starten

Voraussetzungen: Node.js 20+, Java 11+ für die Emulatoren und ein Firebase-Projekt.

```bash
cp .env.example .env
npm install
npm run emulators
# in einem zweiten Terminal
npm run dev
```

Trage für Produktion die fünf `VITE_FIREBASE_*`-Werte der Firebase-Web-App ein. Aktiviere **Authentication → Anonymous**, Realtime Database, Functions und Hosting. Benenne `.firebaserc.example` in `.firebaserc` um und setze ausschließlich die eigene Project-ID. Ein eindeutig zugeordnetes Projekt „gruppenspiele“ war in diesem Arbeitsbereich nicht vorhanden; deshalb wurden keine fremden Ressourcen verändert und kein Deployment vorgenommen.

## Architektur und Sicherheit

* `src/engine.ts` enthält die deterministische Zustandsmaschine inklusive Heads-up-Blinds, Zugfolge, All-ins, Side Pots, Split Pots und Chip-Erhaltungsprüfung.
* Callable Functions reservieren sechsstellige Codes und führen Lobby-Befehle in RTDB-Transaktionen aus. Jeder Befehl trägt `actionId` und `expectedVersion`; UID und Hostrolle kommen ausschließlich aus dem Auth-Kontext.
* Clients haben nur Lesezugriff auf Räume, in denen ihre UID unter `members` geführt wird. Direkte Schreibzugriffe sind vollständig gesperrt; nur der eigene kurzlebige Presence-Pfad ist beschreibbar. Dauerhafte Spieler- und Chipdaten werden beim Disconnect nicht gelöscht.
* Der dokumentierte Button wandert im Uhrzeigersinn zum nächsten Sitz mit positivem Stack. Beim Heads-up ist der Dealer Small Blind und handelt preflop zuerst; postflop handelt der andere Spieler zuerst. Restchips eines Split Pots gehen, beginnend links vom Dealer, im Uhrzeigersinn an Gewinner.

> Die vorhandenen Functions decken sichere Raumerstellung, Beitritt, Sitzwahl, Ready, Einstellungen und Sitzungsstart ab. Die State Machine deckt die Pokerbuchhaltung ab; vor einem Echtgeld- oder öffentlichen Produktionseinsatz müssen die verbleibenden Spielbefehle an die Functions angebunden und die Emulator-/Browser-Abnahmetests vollständig durchgeführt werden.

## Tests, Build und Deployment

```bash
npm test
npm run build
npm run test:rules
npm run deploy
```

`test:rules` erwartet installierte Emulatoren. Hosting rewritet alle Routen (`/invite/:code`, `/room/:id`) auf die SPA. Das PWA-Update wird als Prompt angeboten statt eine laufende Hand automatisch neu zu laden. Functions benötigen für Produktion üblicherweise den Firebase-Blaze-Tarif. Live-Spielzustand wird nie offline als authoritative State behandelt.
