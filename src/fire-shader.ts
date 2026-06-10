export const fireVertexShader = /* glsl */ `
  uniform float uWorldYMin;   // modellens lägsta/högsta Y i VÄRLDEN (sätts i JS)
  uniform float uWorldYMax;
  uniform float uInflate;     // hur långt eldskalet blåses ut längs normalen (modell-enheter)

  // ── Tung-vajning (för flam-modeller) ─────────────────────────────────────
  uniform float time;
  uniform float uSway;        // amplitud (modell-enheter, höjd-skalad i JS). 0 = av
  uniform float uSwaySpeed;   // hur snabbt tungorna vajar
  uniform float uSwayBase;    // var vajningen börjar (0–1 av höjden): under = stilla
  uniform float uLocalYMin;   // modellens lokala Y-min/max (objektrymd, konstant)
  uniform float uLocalYMax;   // → masken följer höjd oavsett UV-layout

  varying vec2  vUv;
  varying float vYNorm;       // 0 = ben (lägst i världen), 1 = huvud (högst)
  varying float vFresnel;     // 0 = ytan mot kameran, 1 = silhuettkant

  void main() {
    vUv = uv;

    // ── Tungorna vajar: mask från UV.y (stilla vid bas, fladdrar mot spets),
    //    per-tunga fas härledd ur vertexens xz-läge → varje tunga i egen takt.
    vec3 base = position + normal * uInflate;
    if (uSway > 0.0) {
      float hNorm = clamp((position.y - uLocalYMin) / max(uLocalYMax - uLocalYMin, 0.001), 0.0, 1.0);
      float hMask = smoothstep(uSwayBase, 1.0, hNorm);
      float ph    = dot(position.xz, vec2(12.9, 7.3));
      vec3  off   = vec3(
        sin(time * uSwaySpeed + ph),
        0.0,
        cos(time * uSwaySpeed * 1.3 + ph * 1.7)
      ) * (uSway * hMask);
      base += off;
    }

    // ── Blås ut skalet längs normalen → elden blir större än skulpturen ──────
    vec3 inflated = base;
    vec4 wpos     = modelMatrix * vec4(inflated, 1.0);

    // VU-bar mappas mot VÄRLDENS upp-riktning, så den reser sig rakt upp oavsett
    // hur modellen är roterad/skalad.
    vYNorm = clamp((wpos.y - uWorldYMin) / max(uWorldYMax - uWorldYMin, 0.001), 0.0, 1.0);

    vec4 mvPos = viewMatrix * wpos;

    // ── Fresnel: ytor som pekar bort från kameran (silhuetten) får mjuk glöd ─
    vec3 viewNormal = normalize(normalMatrix * normal);
    vec3 viewDir    = normalize(-mvPos.xyz);
    vFresnel = 1.0 - abs(dot(viewNormal, viewDir));

    gl_Position = projectionMatrix * mvPos;
  }
`

export const fireFragmentShader = /* glsl */ `
  uniform float time;
  uniform float density;
  uniform float uAudioLevel;  // 0 = tyst, 1 = maxpeak (glödhett vid huvudet)
  uniform float uSoftness;    // 0 = skarpa inre lågor, 1 = mjuka inre lågor
  uniform float uFeather;     // 0 = skarp kontur, 1 = mjuk urtonad kant (feather)
  uniform vec3  uColor;       // eldens grundfärg (hex i Studio)
  uniform float uOpacity;     // 0 = osynlig, 1 = full opacitet
  uniform float uIdleGlow;    // 0 = mörk i tystnad (skulptur), 1 = full eld även utan ljud (låga)

  varying vec2  vUv;
  varying float vYNorm;
  varying float vFresnel;

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float gradNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(hash2(i           ) * 2.0 - 1.0, f           );
    float b = dot(hash2(i + vec2(1,0)) * 2.0 - 1.0, f - vec2(1,0));
    float c = dot(hash2(i + vec2(0,1)) * 2.0 - 1.0, f - vec2(0,1));
    float d = dot(hash2(i + vec2(1,1)) * 2.0 - 1.0, f - vec2(1,1));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5; vec2 s = vec2(1.0);
    for (int i = 0; i < 4; i++) { v += a * gradNoise(p * s); s *= 2.07; a *= 0.5; }
    return v * 0.5 + 0.5;
  }

  void main() {
    // ── Noise-rörelsen är samma som tidigare ───────────────────────────────
    vec2 animated = vec2(
      vUv.x + sin(vUv.y * 5.0 + time * 2.5) * 0.05,
      vUv.y - time * 0.42
    );
    float n1   = fbm(animated * 2.8);
    float n2   = fbm(animated * 5.0 + vec2(8.3, 1.4) - time * 0.14);
    float fire = n1 * 0.62 + n2 * 0.38;

    float heightFade = 1.0 - smoothstep(0.0, 1.2, vUv.y) * 0.5;
    fire *= heightFade;

    // ── Höjd-låst eldgradient (absolut höjd, vYNorm: 0 = botten, 1 = topp) ──
    // Färgen sitter LÅST vid höjden, inte vid barens topp: röd nederst, orange
    // i mitten, ljus orange/gul i toppen. Ljud-baren ändrar bara HUR HÖGT glöden
    // tänds — aldrig hue:n. Därför förblir den röda botten röd när baren reser
    // sig, mitten orange, toppen gul. (Redigera dessa tre färger för att tona om.)
    vec3 cBottom = vec3(1.00, 0.06, 0.00);   // röd  (botten)
    vec3 cMid    = vec3(1.00, 0.42, 0.04);   // orange (mitten)
    vec3 cTop    = vec3(1.00, 0.78, 0.28);   // ljus orange/gul (toppen)
    vec3 heightCol = mix(cBottom, cMid, smoothstep(0.0, 0.5, vYNorm));
    heightCol      = mix(heightCol, cTop, smoothstep(0.5, 1.0, vYNorm));

    // ── Ljud-bar: hur högt upp glöden tänds (mjuk kant, ingen skarp linje) ──
    float barHeight = uAudioLevel;
    float litFactor = smoothstep(barHeight + 0.12, barHeight - 0.04, vYNorm);
    // litFactor = 1.0 under baren, 0.0 över baren

    // Tänd = full höjdfärg. Släckt = mörk vilo-ton i SAMMA hue (ingen vit).
    vec3 litCol  = heightCol;
    vec3 darkCol = heightCol * 0.12;

    // idleGlow: hur mycket gradienten lyser UTAN ljud (0 = mörk, 1 = full glöd).
    vec3 restCol = mix(darkCol, heightCol * 0.65, clamp(uIdleGlow, 0.0, 1.0));

    vec3 col = mix(restCol, litCol, litFactor);

    // ── Inre flamm-mjukhet (uSoftness) ─────────────────────────────────────
    // Breddar alfa-övergången i noise-texturen så de inre lågorna blir mjukare.
    float edge0 = mix(0.18, 0.00, uSoftness);
    float edge1 = mix(0.42, 0.90, uSoftness);
    float baseAlpha = smoothstep(edge0, edge1, fire);

    // ── Feather på konturen (uFeather) ─────────────────────────────────────
    // Ytor i betraktningsvinkel (silhuetten) tonas mjukt ut mot transparent —
    // precis som feather-verktyget i Photoshop. Bredare band = mjukare kant.
    // uFeather 0 = skarp kontur, 1 = hela kanten urtonad.
    float edgeFade = 1.0 - smoothstep(1.0 - clamp(uFeather, 0.001, 1.0), 1.0, vFresnel);

    float alpha = baseAlpha * edgeFade * density * uOpacity;

    gl_FragColor = vec4(col * 1.05, alpha);
  }
`
