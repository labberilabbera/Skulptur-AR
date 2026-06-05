# Skulptur-AR — projektöversikt (läs detta först)

AR-upplevelse byggd i **8th Wall Studio** (ECS) + webpack, deployad på **Vercel**.
En förkolnad kvinno-skulptur som glöder/brinner i AR, ankrad mot ett bildmål.
Detta repo är **en** skulptur ("Eld"). Varje skulptur = eget repo/Vercel-projekt,
kopierat från detta och med utbytta modeller/musik/markör.

## Arkitektur
- **8th Wall-scen** (`src/.expanse.json`) med ett **ImageTarget** ("fram") +
  modeller som barn.
- **Två modeller** (samma form):
  - **Förkolnad** (`sculpture.glb`) — mörk kol-textur, world-anchor här.
  - **Glöd** (`eld-textur.glb`) — glödtextur som baseColor, barn till förkolnade.
- Bildmåls-tracking är instabil på böjd/glansig yta → markören placeras **bredvid**
  på en platt utskrift, och `world-anchor` fryser innehållet i world space.

## Egna komponenter (src/)
- **`sculpture-fire`** (`sculpture-ar.ts` + `fire-shader.ts` + `particle-shader.ts`)
  Yt-eld (shader) + två partikellager (gnistor). Reglage: `enabled`, `showModel`,
  `inflate`, `softness`, `feather`, `hue` (0–1 färg), `opacity`, `density`, `speed`,
  `audioReact`, `p1*`/`p2*` (partiklar). Ljud-reaktiv "VU-bar" reser sig i
  **världens** upp-riktning. Partiklar och VU-bar är world-up-baserade (ej lokal Y).
- **`ember-glow`** (`ember-glow.ts`) Lägg på glöd-modellen. Gör materialet additivt
  och animerar glöden (andning + flöde + ljud-puls). Växer utåt på musikens toppar
  (`expand`). Reglage: `enabled`, `speed`, `boost`, `audioReact`, `expand`.
- **`world-anchor`** (`world-anchor.ts`) **MARKÖR-PRIMÄR tracking** (för markör på
  podiets topplatta man tittar ner på). Två lägen:
  - **Besökare:** innehållet följer bildmålet KONTINUERLIGT, men posen **adaptivt
    dämpas** (one-euro-liknande: mest dämpning vid små jitter, följsam vid verklig
    rörelse) → stabilt utan att drifta. Markören är enda referensen; SLAM-drift spelar
    ingen roll. Tappas markören kort hålls senaste pose. Reglage: `smoothing` (bas-
    dämpning, lägre = mjukare/mer lag), `responsiveness` (hur snabbt den hänger med),
    `snapDist` (snäpp direkt om målet hoppar längre än detta; 0 = aldrig), `holdWhenLost`.
  - **Admin/kalibrering** (`?admin`/`?calibrate`): OFÖRÄNDRAT — fryser mot markören
    (scene.attach), nudga fritt, SPARA räknar om till **markör-relativ offset**.
    Sparformatet (pos/rot/scale relativt markören) är identiskt → gamla kalibreringar
    och admin-UI:t (`window._anchorApi`) funkar som förut.
  - Gemensamma reglage: `targetName` ("fram"), `framesToLock` (stabila träffar innan
    första placering), `relock` (endast calibrate).
  - **Historik/varför:** tidig "frys till ren SLAM efter scan" driver iväg där SLAM är
    svag (öppet hav/himmel). En "hybrid" som korrigerade en FRYST pose mot markören
    floppade (objektet vandrade). Markör-primärt (markören = enda sanning, kontinuerligt
    + dämpat) är rätt när markören syns hela tiden (topplatta, titta ner). Markör-krav:
    stor (≥A3, fyll plattan), **matt** (ej blank → speglar himmel/sol), högkontrast,
    icke-repetitiv; gärna lätt lutad mot betraktaren om man tittar snett.

## VIKTIGT: 8th Wall exponerar inte alltid vertex-data
Modeller exporterade med `FB_ngon_encoding` (Polycam/Remesh m.fl.) får **tom**
`geometry.attributes` på CPU-sidan i 8th Wall → yt-eld och ytbaserade partiklar
funkar inte på dem. Lösning: lägg `sculpture-fire` på den modell som DÅ exponerar
data (här `eld-textur.glb`), eller exportera om triangulerat utan ngon. Det finns en
**bounding-box-fallback** för partiklar om vertexdata saknas.

## UI / flöde (src/index.html)
- Startskärm ("Tryck för att starta") visas först när kameran är redo
  (`onCameraStatusChange` = hasVideo), så den aldrig täcker tillåt-dialogen.
- STARTA låser upp ljudet (play+pause) men **musiken startar vid scan**
  (`reality.imagefound` → `window._startMusic()`).
- Scan-overlay visar **markörbilden + "Scanna <SCULPTURE_NAME>"**.
- Avsluta-knapp (✕) + slutskärm. (Ska ändras till att gå tillbaka till meny-appen.)
- **Konstanter att byta per skulptur:** `SCULPTURE_ID`, `SCULPTURE_NAME` (överst i
  `<script>`), samt `MENU_URL` (om meny-app finns).

## Kalibrering / Admin (placera AR rätt på fysiska skulpturen)
- `?calibrate=1` = nudge-läge (lokalt). `?admin=KOD` = nudge + **SPARA** till servern.
- **Admin-meny-loop:** öppna **meny-appen** med `?admin=KOD` → välj skulptur (koden
  skickas vidare som `?admin=KOD`) → placera → SPARA → appen åker automatiskt tillbaka
  till admin-menyn för nästa skulptur (✕ gör detsamma). Besökare utan `?admin` ser
  vanliga menyn. Styrs av `MENU_URL` + `adminCode` i `src/index.html`.
- Verktyg: Flytta (dra), Rotera (gizmo-ringar X/Y/Z), Skala (dra/nyp). Rörelser
  kamera-relativa. Låser först mot markören, sedan nudgar man fritt.
- Placeringen sparas i **Upstash Redis (KV)** via `api/calibration.js` och hämtas av
  besökare vid start (`window._savedCalibration`).
- **Env-variabler på Vercel:** `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`,
  `ADMIN_PASSCODE`. Samma KV kan delas av alla skulpturer (nyckel = `calib:<id>`).
- Debug-HUD: `?debug=1`.

## Bygg / deploy
- Bygg: `npm run build` (webpack → `dist/`). Dev: `npm run serve`.
- Komponenter i `src/*.ts` auto-importeras (config/entry-plugin.js).
- Pusha till GitHub → Vercel bygger om (~1–2 min). `dist/` är gitignored.
- Commit-meddelanden avslutas med `Co-Authored-By: Claude ...`.
- **Modeller/musik/markör ligger i `src/assets/`** (inte root-`assets/`). `app.js`
  pekar på `./assets/music.mp3` → krympta filer läggs i `src/assets/`. (En gammal
  `assets/music.mp3` i root kan ligga kvar oanvänd; den bundlas inte.)
- **Håll `src/assets/` rent:** bara de GLB:er som faktiskt används ska ligga kvar —
  allt i mappen bundlas in i `dist/` och tynger nedladdningen även om det inte används.

### Nytt Vercel-projekt (import från GitHub)
- **Framework Preset:** Other. **Root Directory:** `./`.
- **Build Command:** `npm run build`  ·  **Output Directory:** `dist`  ·  Install: default.
- **Environment Variables** (annars funkar inte kalibrering): `UPSTASH_REDIS_REST_URL`,
  `UPSTASH_REDIS_REST_TOKEN`, `ADMIN_PASSCODE` — sätt samma värden som övriga skulpturer
  för delad KV. `ADMIN_PASSCODE` är inte lagrat i repot (läses från env); hämta värdet
  från ett befintligt projekts Vercel-inställningar.

## Skapa en ny skulptur (t.ex. Vind)
1. Kopiera detta repo → ny mapp/repo/Vercel.
2. Byt modeller (förkolnad + glöd) och `src/assets/music.mp3` i **`src/assets/`**,
   markör (8th Wall Targets, döp den `fram` så slipper du ändra sökvägar). Ta bort
   gamla/oanvända GLB:er ur `src/assets/` så de inte bundlas i onödan.
3. Ändra `SCULPTURE_ID`, `SCULPTURE_NAME`, ev. `hue`/färger i `src/index.html`.
4. Lägg komponenterna på modellerna (world-anchor + sculpture-fire på modellen som
   exponerar vertexdata; ember-glow på glöd-modellen).
5. Vercel-projekt enligt **Nytt Vercel-projekt** ovan (Build Command/Output Directory +
   samma Upstash-env-variabler). Kalibrera via `?admin=KOD`.

## Meny-app (separat — BYGGD)
Ligger i **systermappen `../Meny/`** (eget repo/Vercel, statisk sida, ingen 8th
Wall). 1 QR → meny med stora ikoner per skulptur → tryck → "Scanna X" → går till
respektive skulptur-deploy. Config-listan `SCULPTURES` i `Meny/index.html` styr
namn/ikon/markör/url per skulptur. Se `../Meny/CLAUDE.md`.

Denna skulptur-app går **tillbaka till menyn** vid ✕ och när musiken tar slut —
styrs av konstanten **`MENU_URL`** överst i `src/index.html` (sätt den till
menyns URL när menyn är deployad; tom = nuvarande slutskärm istället).
