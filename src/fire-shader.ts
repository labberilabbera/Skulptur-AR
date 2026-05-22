// ── Organisk, andande eld som följer skulpturens form ──────────────────────
// Designad för att kännas som mjuk levande energi, inte aggressiv brand.
// Justera känslan via uniforms i sculpture-ar.ts.

export const fireVertexShader = /* glsl */ `
  uniform float time;
  uniform float uSurfaceOffset;  // hur långt ut från ytan (0.005-0.05)

  varying vec3  vWorldPos;
  varying vec3  vViewNormal;
  varying float vBreath;

  void main() {
    // Andningspuls — långsam sinusvåg som ger eldlagret liv
    float breath = sin(time * 0.35) * 0.5 + 0.5;
    vBreath = breath;

    // Offset längs normal så lagret hugs över ytan
    vec3 n = normalize(normal);
    vec3 offsetPos = position + n * (uSurfaceOffset + breath * 0.004);

    // World position används för stabil noise oavsett kamerarörelse
    vec4 worldPos = modelMatrix * vec4(offsetPos, 1.0);
    vWorldPos    = worldPos.xyz;
    vViewNormal  = normalize(normalMatrix * n);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`

export const fireFragmentShader = /* glsl */ `
  uniform float time;
  uniform float uIntensity;      // huvudregler för synlighet (0-2)
  uniform float uNoiseScale;     // hur tät noise-strukturen är (1-5)
  uniform float uGlowStrength;   // styrka på kant-glöden/auran (0-2)
  uniform float uFlameHeight;    // hur långt uppåt elden flödar (0.5-3)

  varying vec3  vWorldPos;
  varying vec3  vViewNormal;
  varying float vBreath;

  // ── 3D noise — ger curl-känsla utan dyr beräkning ─────────────────────────
  vec3 hash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453) * 2.0 - 1.0;
  }
  float gradNoise3(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash3(i + vec3(0,0,0)), f - vec3(0,0,0)),
                       dot(hash3(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash3(i + vec3(0,1,0)), f - vec3(0,1,0)),
                       dot(hash3(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash3(i + vec3(0,0,1)), f - vec3(0,0,1)),
                       dot(hash3(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash3(i + vec3(0,1,1)), f - vec3(0,1,1)),
                       dot(hash3(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
  }
  float fbm3(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * gradNoise3(p);
      p *= 2.05;
      a *= 0.5;
    }
    return v * 0.5 + 0.5;
  }

  void main() {
    // ── Organic flow ──────────────────────────────────────────────────────
    // Mjuk uppåtdrift modulerad av tid — långsam rörelse, inte snabb
    vec3 flowPos = vWorldPos * uNoiseScale;
    flowPos.y   -= time * 0.18 * uFlameHeight;

    // Två noise-lager i olika hastigheter ger curl-känsla utan curl-beräkning
    float n1 = fbm3(flowPos);
    float n2 = fbm3(flowPos * 1.7 + vec3(time * 0.04, 0.0, -time * 0.03));
    float fire = n1 * 0.6 + n2 * 0.4;

    // Andningspulsen modulerar intensiteten — ger levande, ej maskinell rörelse
    fire *= 0.82 + vBreath * 0.28;

    // ── Färgpalett: varm, gyllene — inte hård röd brand ────────────────────
    vec3 deepAmber  = vec3(0.55, 0.14, 0.02);   // mörk botten
    vec3 warmOrange = vec3(1.0,  0.42, 0.06);   // mellan
    vec3 gold       = vec3(1.0,  0.78, 0.25);   // ljus mellan
    vec3 softCore   = vec3(1.0,  0.95, 0.72);   // mjuk gulvit kärna

    vec3 col = mix(deepAmber,  warmOrange, smoothstep(0.18, 0.45, fire));
    col      = mix(col,        gold,       smoothstep(0.45, 0.68, fire));
    col      = mix(col,        softCore,   smoothstep(0.68, 0.88, fire));

    // ── Rim/aura-glöd ──────────────────────────────────────────────────────
    // Kantljus där normalen pekar bort från kameran — ger aurakänsla runt formen
    float rim  = 1.0 - abs(dot(normalize(vViewNormal), vec3(0.0, 0.0, 1.0)));
    float aura = pow(rim, 1.4) * uGlowStrength;

    // ── Alpha ──────────────────────────────────────────────────────────────
    // Mjuk start och slut så elden tonar in/ut istället för att klippas hårt
    float baseAlpha = smoothstep(0.22, 0.62, fire);
    float alpha     = (baseAlpha * 0.85 + aura * 0.4) * uIntensity;

    gl_FragColor = vec4(col, alpha);
  }
`
