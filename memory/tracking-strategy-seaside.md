---
name: tracking-strategy-seaside
description: Skulpturer vid havet, placerade LÅGT → markör på podiets topplatta (titta ner) → markör-primär, super-stabil tracking
metadata:
  type: project
---

Skulpturerna står **vid havet** OCH **lågt placerade** (man tittar NER på dem).
Plan (per 2026-06-05, omtänkt): **markör (image target) på podiets topplatta**.

## Varför detta är bra (mot tidigare oro)
Tidigare oro: öppet hav/himmel → SLAM opålitlig. MEN med markör på topplattan man
tittar ner på är markören **i bild hela tiden, platt och rakt framifrån** = nästan
idealiskt för image target-tracking. Då behöver vi INTE förlita oss på SLAM.

## Beslutad inriktning: MARKÖR-PRIMÄR tracking (super-stabil)
- Behåll innehållet kopplat till bildmålet kontinuerligt (INGEN scene.attach-frysning).
- Lågpassfiltrera/dämpa markör-posen (one-euro/lerp) → tar bort jitter utan drift.
- INTE samma som den floppade "hybriden" (markör fäktade mot fryst SLAM-pose →
  objektet vandrade; återställd 2026-06-05, commit 75cf69f). Här är markören enda
  referensen.
- Dagens `world-anchor` (SLAM-frys efter scan) ska alltså BYTAS för havs-/topplatte-
  fallet. Bygg markör-primärt läge i `world-anchor.ts` när AR läggs på modellerna.

## Markör-krav (image target på topplattan)
- **Storlek:** fyll minst ~1/3 av kamerabilden vid tittavstånd; ju mer desto stabilare.
  Konkret ~0,6–1 m tittavstånd → min A4 (21 cm), helst A3 (30 cm) eller hela plattan.
  Regel: markörbredd ≳ 1/3 av tittavståndet.
- **Matt yta, ALDRIG blank** (horisontell platta under öppen himmel speglar sol/himmel
  → tracking dör). Matt laminering för väder.
- Högt kontrast, varierad icke-repetitiv detalj (detaljrikt foto/grafik), lite vitt.
- 200–300 DPI, helt platt, stadigt fäst (ingen vind-rörelse).

## Status / nästa steg
- **BYGGT (2026-06-05, commit 3f22653):** markör-primär tracking i `world-anchor.ts`.
  Besökarläge = kontinuerlig markör-tracking + adaptiv dämpning (smoothing,
  responsiveness, snapDist, holdWhenLost). Admin/kalibrering oförändrat (frys+nudga+
  SPARA markör-relativt, samma sparformat). Otestat på enhet → tuna dämpningen på plats.
- vatten-appen är just nu MUSIK-ONLY (AR borttaget ur scenen). När AR läggs på
  modellerna ärver den markör-primära trackingen automatiskt.
- Öppen fråga: topplattans mått + horisontellt tittavstånd → exakt markörstorlek + om
  plattan bör lutas.
