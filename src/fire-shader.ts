export const fireVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

export const fireFragmentShader = /* glsl */ `
  uniform float time;
  uniform float density;
  uniform float uAudioShift;  // 0=blålila, 0.33=gul, 0.66=orange, 1=röd
  varying vec2 vUv;

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
    vec2 animated = vec2(
      vUv.x + sin(vUv.y * 5.0 + time * 2.5) * 0.05,
      vUv.y - time * 0.42
    );

    float n1   = fbm(animated * 2.8);
    float n2   = fbm(animated * 5.0 + vec2(8.3, 1.4) - time * 0.14);
    float fire = n1 * 0.62 + n2 * 0.38;

    float heightFade = 1.0 - smoothstep(0.0, 1.2, vUv.y) * 0.5;
    fire *= heightFade;

    // ── 4 paletter — kroppen skiftar tydligt mellan dem baserat på musik ──
    //
    // PALETT 1 (vila, tystare): BLÅLILA
    vec3 p1Base   = vec3(0.25, 0.02, 0.50);  // mörk lila
    vec3 p1Mid    = vec3(0.15, 0.20, 0.95);  // klar blå
    vec3 p1Bright = vec3(0.40, 0.60, 1.00);  // ljusblå
    vec3 p1Core   = vec3(0.85, 0.92, 1.00);  // vit-blå
    //
    // PALETT 2: GUL (mid-höga ljud)
    vec3 p2Base   = vec3(0.55, 0.30, 0.0);   // mörk amber
    vec3 p2Mid    = vec3(1.00, 0.75, 0.05);  // varm gul
    vec3 p2Bright = vec3(1.00, 0.95, 0.20);  // klar gul
    vec3 p2Core   = vec3(1.00, 1.00, 0.80);  // vit-gul
    //
    // PALETT 3: ORANGE (höjningar)
    vec3 p3Base   = vec3(0.55, 0.10, 0.0);   // mörk orange
    vec3 p3Mid    = vec3(1.00, 0.40, 0.02);  // klar orange
    vec3 p3Bright = vec3(1.00, 0.65, 0.10);  // ljus orange
    vec3 p3Core   = vec3(1.00, 0.88, 0.55);  // vit-orange
    //
    // PALETT 4: RÖD (höga toppar/sax-toppar)
    vec3 p4Base   = vec3(0.40, 0.0, 0.05);   // djupröd
    vec3 p4Mid    = vec3(0.95, 0.08, 0.05);  // klar röd
    vec3 p4Bright = vec3(1.00, 0.30, 0.20);  // ljusare röd
    vec3 p4Core   = vec3(1.00, 0.70, 0.55);  // vit-röd

    // Smidig interpolation mellan paletterna
    float toYellow = smoothstep(0.0,  0.33, uAudioShift);
    float toOrange = smoothstep(0.33, 0.66, uAudioShift);
    float toRed    = smoothstep(0.66, 1.0,  uAudioShift);

    vec3 base   = p1Base;
    base = mix(base, p2Base, toYellow);
    base = mix(base, p3Base, toOrange);
    base = mix(base, p4Base, toRed);

    vec3 mid    = p1Mid;
    mid = mix(mid, p2Mid, toYellow);
    mid = mix(mid, p3Mid, toOrange);
    mid = mix(mid, p4Mid, toRed);

    vec3 bright = p1Bright;
    bright = mix(bright, p2Bright, toYellow);
    bright = mix(bright, p3Bright, toOrange);
    bright = mix(bright, p4Bright, toRed);

    vec3 core   = p1Core;
    core = mix(core, p2Core, toYellow);
    core = mix(core, p3Core, toOrange);
    core = mix(core, p4Core, toRed);

    // Gradient i ytan baserat på noise
    vec3 col = mix(base, mid,    smoothstep(0.20, 0.42, fire));
    col      = mix(col,  bright, smoothstep(0.42, 0.65, fire));
    col      = mix(col,  core,   smoothstep(0.65, 0.92, fire));

    float alpha = smoothstep(0.12, 0.44, fire) * density;

    gl_FragColor = vec4(col * 1.3, alpha);
  }
`
