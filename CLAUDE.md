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
- **`world-anchor`** (`world-anchor.ts`) Fryser innehållet i world space efter att
  markören scannats (scene.attach) → står kvar när markören lämnar bilden. Innehåller
  även **kalibrerings-API** (`window._anchorApi`) som driver admin-UI:t. Reglage:
  `targetName` ("fram"), `framesToLock`, `relock`.

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

## Skapa en ny skulptur (t.ex. Vind)
1. Kopiera detta repo → ny mapp/repo/Vercel.
2. Byt modeller (förkolnad + glöd), `assets/music.mp3`, markör (8th Wall Targets,
   döp den `fram` så slipper du ändra sökvägar).
3. Ändra `SCULPTURE_ID`, `SCULPTURE_NAME`, ev. `hue`/färger i `index.html`.
4. Lägg komponenterna på modellerna (world-anchor + sculpture-fire på modellen som
   exponerar vertexdata; ember-glow på glöd-modellen).
5. Sätt samma Upstash-env-variabler på Vercel. Kalibrera via `?admin=KOD`.

## Meny-app (separat, planerad)
1 QR → meny-webapp med stora ikoner per skulptur → tryck → går till respektive
skulptur-deploy. Skulptur-appen ska gå **tillbaka till menyn** vid ✕ och när
upplevelsen är slut (`MENU_URL`).
