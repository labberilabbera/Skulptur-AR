import * as ecs from '@8thwall/ecs'

// ── Ember-glow ──────────────────────────────────────────────────────────────
// Läggs på en "glöd-modell" (samma form som den förkolnade modellen, men med en
// glödtextur). Komponenten gör modellens material additivt och animerar glöden
// så den andas, flödar i sprickorna och pulserar med musiken. Där glödtexturen
// är mörk adderas ~inget → den förkolnade modellen bakom syns; där den lyser
// tränger glöden igenom. Lägg glöd-modellen ovanpå/överlappande den förkolnade.

const glowVertexShader = /* glsl */ `
  uniform float uExpand;    // hur långt skalet blåses ut (modell-enheter)
  uniform float uAudio;     // 0 = tyst, 1 = peak — driver utblåsningen
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // På musikens toppar växer glöd-skalet utanför kol-modellen
    vec3 p = position + normal * (uExpand * uAudio);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`

const glowFragmentShader = /* glsl */ `
  uniform sampler2D tGlow;
  uniform float time;
  uniform float uAudio;     // 0 = tyst, 1 = peak
  uniform float uBoost;     // generell ljusstyrka
  varying vec2 vUv;

  // enkel värdebrus för flimmer i glöden
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }

  void main() {
    vec3 g = texture2D(tGlow, vUv).rgb;
    float lum = max(max(g.r, g.g), g.b);

    // Mjuk andning + flödande flimmer uppåt i sprickorna = levande grundglöd
    float breath = 0.6 + 0.4 * sin(time * 1.3);
    float flow   = 0.7 + 0.3 * noise(vUv * vec2(8.0, 22.0) + vec2(0.0, -time * 1.2));
    float base   = breath * flow;

    // Musiken lyfter glöden tydligt ovanpå grundnivån
    float intensity = base * (0.7 + uAudio * 2.0) * uBoost;

    vec3 col = g * intensity * 1.6;
    // glödhett kärnsken mot vit-orange vid musikens toppar
    col += vec3(1.0, 0.5, 0.15) * lum * uAudio * 1.2;

    gl_FragColor = vec4(col, 1.0);
  }
`

const matsMap        = new Map<bigint, any[]>()
const listenerMap    = new Map<bigint, (e: any) => void>()
const setupDoneMap   = new Map<bigint, boolean>()
const audioSmoothMap = new Map<bigint, number>()

let THREE: any = null

ecs.registerComponent({
  name: 'ember-glow',

  schema: {
    speed:      ecs.f32,   // andnings-/flödeshastighet
    boost:      ecs.f32,   // generell ljusstyrka
    audioReact: ecs.f32,   // hur mycket musiken driver glöden
    expand:     ecs.f32,   // hur mycket glöden växer utanför kol-modellen på toppar (andel av höjd)
  },
  schemaDefaults: {
    speed:      1.0,
    boost:      1.0,
    audioReact: 1.2,
    expand:     0.03,
  },
  data: {},

  add: (world, component) => {
    THREE = (window as any).THREE
    if (!THREE) { console.error('[ember-glow] THREE saknas'); return }
    setupDoneMap.set(component.eid, false)

    const applyGlow = (model: any) => {
      if (setupDoneMap.get(component.eid)) return
      setupDoneMap.set(component.eid, true)

      const mats: any[] = []
      model.traverse((child: any) => {
        if (!child.isMesh) return

        // Glödtexturen = modellens baseColor-textur (från GLB:n)
        const srcMat = Array.isArray(child.material) ? child.material[0] : child.material
        const tex = srcMat && srcMat.map ? srcMat.map : null
        if (!tex) { console.warn('[ember-glow] mesh saknar textur'); return }

        // Säkra normaler (behövs för utblåsningen) + räkna ut höjd för skalan
        if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals()
        child.geometry.computeBoundingBox()
        const bb = child.geometry.boundingBox
        const height = bb ? Math.max(bb.max.y - bb.min.y, 0.001) : 1

        const mat = new THREE.ShaderMaterial({
          vertexShader: glowVertexShader,
          fragmentShader: glowFragmentShader,
          uniforms: {
            tGlow:   {value: tex},
            time:    {value: 0},
            uAudio:  {value: 0},
            uBoost:  {value: component.schema.boost},
            uExpand: {value: 0},
          },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          depthTest: true,
          side: THREE.FrontSide,
          polygonOffset: true,        // undvik z-fighting mot förkolnade modellen
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
        mat.userData.height = height
        child.material = mat
        child.renderOrder = 997
        world.three.notifyChanged(child)
        mats.push(mat)
      })

      matsMap.set(component.eid, mats)
      console.log('[ember-glow] klar — ytor:', mats.length)
    }

    const onLoaded = (e: any) => applyGlow(e.data.model)
    listenerMap.set(component.eid, onLoaded)
    world.events.addListener(component.eid, ecs.events.GLTF_MODEL_LOADED, onLoaded)
    const obj = world.three.entityToObject.get(component.eid)
    if (obj && obj.children.length > 0) applyGlow(obj)
  },

  tick: (world, component) => {
    const mats = matsMap.get(component.eid)
    if (!mats) return
    const s  = component.schema
    // Tillförlitlig sekund-klocka (oberoende av ECS-tidsenhet)
    const t  = (performance.now() * 0.001) * s.speed
    const ad = (window as any).audioData

    // Ljud-energi → mål, med snabb attack / långsam decay = musikalisk pump
    let target = 0
    if (ad && ad.active) {
      const energy = ad.bass * 0.6 + ad.mid * 1.0 + (ad.treble ?? 0) * 1.3
      target = Math.min(1.0, energy * s.audioReact * 0.6)
    }
    const prev   = audioSmoothMap.get(component.eid) ?? 0
    const k      = target > prev ? 0.5 : 0.08
    const smooth = prev + (target - prev) * k
    audioSmoothMap.set(component.eid, smooth)

    for (const mat of mats) {
      mat.uniforms.time.value    = t
      mat.uniforms.uAudio.value  = smooth
      mat.uniforms.uBoost.value  = s.boost
      mat.uniforms.uExpand.value = (mat.userData.height || 1) * s.expand
    }
  },

  remove: (world, component) => {
    const l = listenerMap.get(component.eid)
    if (l) {
      world.events.removeListener(component.eid, ecs.events.GLTF_MODEL_LOADED, l)
      listenerMap.delete(component.eid)
    }
    matsMap.delete(component.eid)
    setupDoneMap.delete(component.eid)
    audioSmoothMap.delete(component.eid)
  },
})
