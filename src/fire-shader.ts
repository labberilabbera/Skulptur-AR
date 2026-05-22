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
    // Rising animation — faster base so speed changes are clearly audible
    vec2 animated = vec2(
      vUv.x + sin(vUv.y * 5.0 + time * 2.5) * 0.05,
      vUv.y - time * 0.42
    );

    float n1  = fbm(animated * 2.8);
    float n2  = fbm(animated * 5.0 + vec2(8.3, 1.4) - time * 0.14);
    float fire = n1 * 0.62 + n2 * 0.38;

    float heightFade = 1.0 - smoothstep(0.0, 1.2, vUv.y) * 0.5;
    fire *= heightFade;

    // Blue core → red → orange → yellow
    vec3 col = mix(vec3(0.05, 0.0,  0.65), vec3(0.85, 0.06, 0.0 ), smoothstep(0.20, 0.42, fire));
    col       = mix(col,               vec3(1.0,  0.42, 0.01), smoothstep(0.42, 0.58, fire));
    col       = mix(col,               vec3(1.0,  0.80, 0.08), smoothstep(0.58, 0.75, fire));
    col       = mix(col,               vec3(1.0,  0.97, 0.80), smoothstep(0.75, 0.92, fire));

    // density drives alpha directly — no hidden cap so range is fully usable
    float alpha = smoothstep(0.12, 0.44, fire) * density;

    gl_FragColor = vec4(col * 1.3, alpha);
  }
`
