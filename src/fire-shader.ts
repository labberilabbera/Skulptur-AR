export const fireVertexShader = /* glsl */ `
  uniform float uModelYMin;
  uniform float uModelYMax;

  varying vec2  vUv;
  varying float vYNorm;   // 0 = ben, 1 = huvud

  void main() {
    vUv = uv;
    vYNorm = clamp((position.y - uModelYMin) / max(uModelYMax - uModelYMin, 0.001), 0.0, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const fireFragmentShader = /* glsl */ `
  uniform float time;
  uniform float density;
  uniform float uAudioLevel;  // 0 = tyst (helt lila), 1 = maxpeak (glödröd vid huvudet)

  varying vec2  vUv;
  varying float vYNorm;

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

    // ── VU-bar logik ──────────────────────────────────────────────────────
    // Audio-nivå styr hur högt upp på kroppen "baren" når.
    // Mjuk kant så det inte ser ut som en skarp linje.
    float barHeight = uAudioLevel;
    float litFactor = smoothstep(barHeight + 0.12, barHeight - 0.04, vYNorm);
    // litFactor = 1.0 under baren, 0.0 över baren, mjuk övergång

    // Position inom baren (0 vid benen, 1 vid barens topp)
    float posInBar = clamp(vYNorm / max(barHeight, 0.001), 0.0, 1.0);

    // ── Färggradient inom baren: lila → blå → gul → orange → röd → glödröd ──
    vec3 colPurple  = vec3(0.45, 0.05, 0.80);   // ben (basen)
    vec3 colBlue    = vec3(0.15, 0.30, 1.00);
    vec3 colYellow  = vec3(1.00, 0.85, 0.10);
    vec3 colOrange  = vec3(1.00, 0.40, 0.02);
    vec3 colRed     = vec3(1.00, 0.05, 0.05);
    vec3 colGlowRed = vec3(1.00, 0.45, 0.30);   // toppen — glödhett

    vec3 barCol = colPurple;
    barCol = mix(barCol, colBlue,    smoothstep(0.05, 0.25, posInBar));
    barCol = mix(barCol, colYellow,  smoothstep(0.25, 0.45, posInBar));
    barCol = mix(barCol, colOrange,  smoothstep(0.45, 0.65, posInBar));
    barCol = mix(barCol, colRed,     smoothstep(0.65, 0.85, posInBar));
    barCol = mix(barCol, colGlowRed, smoothstep(0.85, 1.00, posInBar));

    // Området ovanför baren = dämpad lila (vila)
    vec3 restCol = colPurple * 0.55;

    vec3 col = mix(restCol, barCol, litFactor);

    // ── Overdrive: vid de högsta tonerna flammar HELA kroppen glödröd ──────
    // När baren når nära huvudet (audioLevel > 0.78) börjar hela skulpturen
    // bli glödröd, oavsett vertikal position. Full overdrive vid 1.0.
    float overdrive = smoothstep(0.78, 1.0, uAudioLevel);
    col = mix(col, colGlowRed * 1.15, overdrive);

    float alpha = smoothstep(0.12, 0.44, fire) * density;

    gl_FragColor = vec4(col * 1.25, alpha);
  }
`
