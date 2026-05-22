const FIRE_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const FIRE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uIntensity;
  uniform float uSpeed;
  varying vec2 vUv;

  vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1,311.7)), dot(p, vec2(269.5,183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float gradNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    float a = dot(hash2(i           )*2.0-1.0, f           );
    float b = dot(hash2(i+vec2(1,0))*2.0-1.0, f-vec2(1,0));
    float c = dot(hash2(i+vec2(0,1))*2.0-1.0, f-vec2(0,1));
    float d = dot(hash2(i+vec2(1,1))*2.0-1.0, f-vec2(1,1));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
  }
  float fbm(vec2 p) {
    float v=0.0, a=0.5; vec2 s=vec2(1.0);
    for(int i=0;i<4;i++){v+=a*gradNoise(p*s); s*=2.07; a*=0.5;}
    return v*0.5+0.5;
  }

  void main() {
    // Flame silhouette: Gaussian radial + taper + vertical fade
    float cx     = vUv.x - 0.5;
    float radial = exp(-6.5 * cx * cx);
    float taper  = exp(-5.0 * cx * cx / max(1.0 - vUv.y, 0.05));
    float vFade  = pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.4)
                 * smoothstep(0.0, 0.06, vUv.y);
    float shape  = radial * taper * vFade;

    // Domain-warped rising FBM
    vec2 st   = vec2(vUv.x, vUv.y - uTime * uSpeed * 0.28);
    vec2 warp = vec2(fbm(st*2.4 + vec2(0.0, uTime*uSpeed*0.10)),
                     fbm(st*2.4 + vec2(4.8, 1.7) - uTime*uSpeed*0.08));
    float n   = fbm(st*3.0 + warp*1.5);
    n        += (fbm(vec2(uTime*2.5, vUv.y*1.8))*0.12 - 0.06);  // flicker

    float fire = smoothstep(0.30, 0.56, n) * shape;

    // Color: blue → red → orange → yellow → white
    vec3 col = mix(vec3(0.05,0.0, 0.6 ), vec3(0.85,0.06,0.0 ), smoothstep(0.28,0.46,n));
    col       = mix(col, vec3(1.0, 0.42,0.01), smoothstep(0.46,0.60,n));
    col       = mix(col, vec3(1.0, 0.80,0.08), smoothstep(0.60,0.75,n));
    col       = mix(col, vec3(1.0, 0.97,0.78), smoothstep(0.75,0.91,n));
    col       = mix(col, vec3(0.25,0.4, 1.0 ), smoothstep(0.20,0.0,vUv.y)*radial*0.6);

    gl_FragColor = vec4(col * 1.35, smoothstep(0.0, 0.18, fire) * uIntensity);
  }
`

const SPARK_VERT = /* glsl */ `
  uniform float uTime;
  attribute float aOffset;
  attribute float aSpeed;
  attribute float aSeed;
  varying float vLife;
  void main() {
    float t = fract(uTime * aSpeed * 0.09 + aOffset);
    vLife   = t;
    vec3 pos = position;
    pos.y   += t * 1.1;
    float ag = aSeed * 6.2832;
    float d  = t * t * 0.13;
    pos.x   += cos(ag)*d + sin(ag*2.0+uTime*0.6)*0.015*t;
    pos.z   += sin(ag)*d + cos(ag*3.1+uTime*0.5)*0.015*t;
    vec4 mvPos   = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = mix(5.5, 0.5, t*t);
    gl_Position  = projectionMatrix * mvPos;
  }
`

const SPARK_FRAG = /* glsl */ `
  varying float vLife;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float glow  = 1.0 - smoothstep(0.0, 1.0, d);
    float alpha = glow * pow(1.0 - vLife, 2.5) * 0.85;
    vec3  col   = mix(vec3(1.0,0.95,0.55), vec3(0.9,0.15,0.0), pow(vLife, 0.6));
    gl_FragColor = vec4(col, alpha);
  }
`

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FireOptions {
  position?:   any
  height?:     number
  width?:      number
  intensity?:  number
  speed?:      number
  sparkCount?: number
}

export interface FireEffect {
  group:        any
  update:       (t: number) => void
  setIntensity: (v: number) => void
  setSpeed:     (v: number) => void
  dispose:      () => void
}

// ── createFireEffect ──────────────────────────────────────────────────────────

export function createFireEffect(parent: any, THREE: any, options: FireOptions = {}): FireEffect {
  const {
    height     = 0.9,
    width      = 0.4,
    intensity  = 1.0,
    speed      = 1.0,
    sparkCount = 150,
  } = options
  const position = options.position ?? new THREE.Vector3(0, 0, 0)

  const group = new THREE.Group()
  group.position.copy(position)
  parent.add(group)

  // ── Fire plane (regular vertex shader — billboard done in JS tick) ─────────
  const fireMat = new THREE.ShaderMaterial({
    vertexShader:   FIRE_VERT,
    fragmentShader: FIRE_FRAG,
    uniforms: {
      uTime:      {value: 0},
      uIntensity: {value: intensity},
      uSpeed:     {value: speed},
    },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    depthTest:   false,
    side:        THREE.DoubleSide,
  })

  const planeGeo = new THREE.PlaneGeometry(width, height, 1, 1)
  const plane    = new THREE.Mesh(planeGeo, fireMat)
  plane.position.y  = height / 2
  plane.renderOrder = 999
  group.add(plane)

  // ── Sparks ────────────────────────────────────────────────────────────────
  const count     = Math.min(sparkCount, 200)
  const positions = new Float32Array(count * 3)
  const offsets   = new Float32Array(count)
  const speeds    = new Float32Array(count)
  const seeds     = new Float32Array(count)

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.random() * (width / 2) * 0.8
    positions[i*3]   = Math.cos(a) * r
    positions[i*3+1] = Math.random() * height * 0.6
    positions[i*3+2] = Math.sin(a) * r
    offsets[i] = Math.random()
    speeds[i]  = 0.6 + Math.random() * 0.8
    seeds[i]   = Math.random()
  }

  const sparkGeo = new THREE.BufferGeometry()
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  sparkGeo.setAttribute('aOffset',  new THREE.BufferAttribute(offsets, 1))
  sparkGeo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds, 1))
  sparkGeo.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1))

  const sparkMat = new THREE.ShaderMaterial({
    vertexShader:   SPARK_VERT,
    fragmentShader: SPARK_FRAG,
    uniforms:       {uTime: {value: 0}},
    transparent:    true,
    blending:       THREE.AdditiveBlending,
    depthWrite:     false,
    depthTest:      false,
  })

  const sparks = new THREE.Points(sparkGeo, sparkMat)
  sparks.renderOrder = 999
  group.add(sparks)

  // ── API ───────────────────────────────────────────────────────────────────
  return {
    group,
    update:       (t) => { fireMat.uniforms.uTime.value = t; sparkMat.uniforms.uTime.value = t },
    setIntensity: (v) => { fireMat.uniforms.uIntensity.value = v },
    setSpeed:     (v) => { fireMat.uniforms.uSpeed.value = v },
    dispose: () => {
      planeGeo.dispose(); fireMat.dispose()
      sparkGeo.dispose(); sparkMat.dispose()
      parent.remove(group)
    },
  }
}
