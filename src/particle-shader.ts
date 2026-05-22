export const particleVertexShader = /* glsl */ `
  uniform float time;
  uniform float uSize;
  uniform float uSpeed;
  uniform float uRise;
  uniform float uMaxFrac;

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

    float speedVar = 0.6 + aSeed * 0.8;
    float t = fract(time * speedVar * uSpeed * 0.10 + aOffset);
    vProgress = t;
    vSeed     = aSeed;

    vec3 pos = position;
    pos.y += t * uRise;

    float ag = aSeed * 6.2832;
    pos.x += sin(ag + time * 0.6 * uSpeed) * 0.012 * t;
    pos.z += cos(ag + time * 0.5 * uSpeed) * 0.012 * t;

    vec4 mvPos   = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = uSize * mix(1.0, 0.08, t * t);
    gl_Position  = projectionMatrix * mvPos;
  }
`

export const particleFragmentShader = /* glsl */ `
  varying float vProgress;
  varying float vSeed;

  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d >= 1.0) discard;

    float glow  = 1.0 - smoothstep(0.0, 1.0, d);
    float alpha = glow * pow(1.0 - vProgress, 2.4) * 0.85;

    vec3 col = mix(vec3(1.0, 0.92, 0.45), vec3(0.9, 0.16, 0.0), pow(vProgress, 0.55));

    gl_FragColor = vec4(col, alpha);
  }
`
