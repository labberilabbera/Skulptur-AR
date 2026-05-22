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
  uniform float uAudioShift;  // 0 = kall lila/blå, 1 = varm orange/gul
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

    // ── Färgpalett som skiftar med audio ─────────────────────────────────
    // Kall palett (tyst): mörk lila → blå → ljusblå → vit
    vec3 coolBase   = vec3(0.30, 0.02, 0.55);
    vec3 coolMid    = vec3(0.10, 0.20, 0.95);
    vec3 coolBright = vec3(0.35, 0.55, 1.00);
    vec3 coolCore   = vec3(0.85, 0.92, 1.00);

    // Varm palett (musik pumpar): mörk röd → orange → gul → vit-gul
    vec3 warmBase   = vec3(0.55, 0.03, 0.0);
    vec3 warmMid    = vec3(1.00, 0.42, 0.01);
    vec3 warmBright = vec3(1.00, 0.85, 0.10);
    vec3 warmCore   = vec3(1.00, 0.97, 0.80);

    // Interpolera hela paletten baserat på audio
    vec3 base   = mix(coolBase,   warmBase,   uAudioShift);
    vec3 mid    = mix(coolMid,    warmMid,    uAudioShift);
    vec3 bright = mix(coolBright, warmBright, uAudioShift);
    vec3 core   = mix(coolCore,   warmCore,   uAudioShift);

    // Gradient baserat på noise-intensitet
    vec3 col = mix(base, mid,    smoothstep(0.20, 0.42, fire));
    col      = mix(col,  bright, smoothstep(0.42, 0.65, fire));
    col      = mix(col,  core,   smoothstep(0.65, 0.92, fire));

    float alpha = smoothstep(0.12, 0.44, fire) * density;

    gl_FragColor = vec4(col * 1.3, alpha);
  }
`
