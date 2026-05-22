// ── Subtila ember/glöd-partiklar som accent ───────────────────────────────
// Inte huvudeffekt — bara små gnistor som driver upp och tonar bort.

export const particleVertexShader = /* glsl */ `
  uniform float time;
  uniform float uSize;     // basstorlek i pixlar
  uniform float uSpeed;    // hastighetsmultiplier
  uniform float uRise;     // höjd partikeln stiger
  uniform float uMaxFrac;  // andel partiklar aktiva (0-1)

  attribute float aOffset;
  attribute float aSeed;
  attribute float aIndex;

  varying float vProgress;
  varying float vSeed;

  void main() {
    if (aIndex > uMaxFrac) {
      gl_PointSize = 0.0;
      gl_Position  = vec4(-9999.0, -9999.0, -9999.0, 1.0);
      return;
    }

    // Långsammare basfart för mjukare ember-känsla
    float speedVar = 0.5 + aSeed * 0.6;
    float t = fract(time * speedVar * uSpeed * 0.07 + aOffset);
    vProgress = t;
    vSeed     = aSeed;

    vec3 pos = position;
    pos.y += t * uRise;

    // Mjuk lateral drift — som värmedrag, inte snabba gnistor
    float ag = aSeed * 6.2832;
    pos.x += sin(ag + time * 0.4 * uSpeed) * 0.008 * t;
    pos.z += cos(ag + time * 0.35 * uSpeed) * 0.008 * t;

    vec4 mvPos   = modelViewMatrix * vec4(pos, 1.0);
    // Krymper mjukt, försvinner inte tvärt vid toppen
    gl_PointSize = uSize * (1.0 - t * 0.85);
    gl_Position  = projectionMatrix * mvPos;
  }
`

export const particleFragmentShader = /* glsl */ `
  varying float vProgress;
  varying float vSeed;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d >= 1.0) discard;

    // Mjuk glow med extra kärnglöd
    float glow  = 1.0 - smoothstep(0.0, 1.0, d);
    float core  = 1.0 - smoothstep(0.0, 0.3, d);
    float alpha = (glow * 0.7 + core * 0.3) * pow(1.0 - vProgress, 2.2) * 0.75;

    // Gyllene start → varm orange slut (ingen hård röd)
    vec3 startCol = vec3(1.0,  0.92, 0.6);
    vec3 endCol   = vec3(0.95, 0.38, 0.05);
    vec3 col      = mix(startCol, endCol, pow(vProgress, 0.7));

    gl_FragColor = vec4(col, alpha);
  }
`
