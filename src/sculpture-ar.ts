import * as ecs from '@8thwall/ecs'
import {fireVertexShader, fireFragmentShader} from './fire-shader'
import {particleVertexShader, particleFragmentShader} from './particle-shader'

// ── Maps för att hålla referenser per entity ─────────────────────────────────
const fireMatsMap     = new Map<bigint, any[]>()
const emberMatsMap    = new Map<bigint, any[]>()
const gltfListenerMap = new Map<bigint, (e: any) => void>()
const setupDoneMap    = new Map<bigint, boolean>()

let THREE: any = null

ecs.registerComponent({
  name: 'sculpture-fire',

  /**
   * ── Justera elden här ──────────────────────────────────────────────────
   * intensity      — huvudregler för synlighet (0-2)
   * speed          — animationshastighet, lägre = mer harmonisk (0.3-2)
   * audioReact     — hur mycket musiken påverkar (0-3)
   * flameHeight    — hur långt elden flödar uppåt (0.5-3)
   * noiseScale     — täthet på noise-strukturen, högre = mindre detaljer (1-6)
   * glowStrength   — styrka på kant-/aura-glöd (0-2)
   * surfaceOffset  — hur långt ut från ytan eldlagret ligger (0.005-0.05)
   * emberCount     — andel ember-partiklar aktiva (0-1)
   * emberSize      — storlek på ember-partiklar i pixlar (2-20)
   * emberSpeed     — hastighet för embers (0.3-2)
   * emberRise      — höjd embers stiger (0.1-1)
   */
  schema: {
    intensity:     ecs.f32,
    speed:         ecs.f32,
    audioReact:    ecs.f32,
    flameHeight:   ecs.f32,
    noiseScale:    ecs.f32,
    glowStrength:  ecs.f32,
    surfaceOffset: ecs.f32,
    emberCount:    ecs.f32,
    emberSize:     ecs.f32,
    emberSpeed:    ecs.f32,
    emberRise:     ecs.f32,
  },
  schemaDefaults: {
    intensity:     0.9,
    speed:         0.7,
    audioReact:    1.2,
    flameHeight:   1.3,
    noiseScale:    2.8,
    glowStrength:  0.8,
    surfaceOffset: 0.015,
    emberCount:    0.35,
    emberSize:     6.0,
    emberSpeed:    0.8,
    emberRise:     0.35,
  },
  data: {},

  add: (world, component) => {
    THREE = (window as any).THREE
    if (!THREE) { console.error('[sculpture-fire] THREE saknas'); return }
    setupDoneMap.set(component.eid, false)

    // Skapar ember-partikel-geometri från meshens vertices
    const makeEmberGeo = (pa: any, maxCount: number) => {
      const total = pa.count
      const step  = Math.max(1, Math.floor(total / maxCount))
      const cnt   = Math.floor(total / step)
      const pos   = new Float32Array(cnt * 3)
      const off   = new Float32Array(cnt)
      const seed  = new Float32Array(cnt)
      const idx   = new Float32Array(cnt)
      for (let i = 0; i < cnt; i++) {
        const si   = i * step
        pos[i*3]   = pa.getX(si); pos[i*3+1] = pa.getY(si); pos[i*3+2] = pa.getZ(si)
        off[i]     = Math.random()
        seed[i]    = Math.random()
        idx[i]     = cnt > 1 ? i / (cnt - 1) : 0
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos,  3))
      geo.setAttribute('aOffset',  new THREE.BufferAttribute(off,  1))
      geo.setAttribute('aSeed',    new THREE.BufferAttribute(seed, 1))
      geo.setAttribute('aIndex',   new THREE.BufferAttribute(idx,  1))
      return geo
    }

    const applyFire = (model: any) => {
      if (setupDoneMap.get(component.eid)) return
      setupDoneMap.set(component.eid, true)

      const s = component.schema
      const fireMats:  any[] = []
      const emberMats: any[] = []

      model.traverse((child: any) => {
        if (!child.isMesh) return

        // ── Eldlager: duplicerad mesh med offset längs normal ──────────────
        // Lagret hugs ytan istället för att kapsla in skulpturen
        const fireMat = new THREE.ShaderMaterial({
          vertexShader:   fireVertexShader,
          fragmentShader: fireFragmentShader,
          uniforms: {
            time:           {value: 0},
            uIntensity:     {value: s.intensity},
            uNoiseScale:    {value: s.noiseScale},
            uGlowStrength:  {value: s.glowStrength},
            uFlameHeight:   {value: s.flameHeight},
            uSurfaceOffset: {value: s.surfaceOffset},
          },
          transparent: true,
          blending:    THREE.AdditiveBlending,
          depthWrite:  false,
          depthTest:   true,   // depth-test PÅ så elden döljs av andra delar av kroppen
          side:        THREE.FrontSide,
        })

        const fireMesh = child.clone()
        fireMesh.material    = fireMat
        fireMesh.renderOrder = 998
        child.parent.add(fireMesh)
        world.three.notifyChanged(fireMesh)
        fireMats.push(fireMat)

        // ── Ember-partiklar som accent (max 100 enligt spec) ────────────────
        const pa = child.geometry?.attributes?.position
        if (!pa) return

        const emberGeo = makeEmberGeo(pa, 100)
        const emberMat = new THREE.ShaderMaterial({
          vertexShader:   particleVertexShader,
          fragmentShader: particleFragmentShader,
          uniforms: {
            time:     {value: 0},
            uSize:    {value: s.emberSize},
            uSpeed:   {value: s.emberSpeed},
            uRise:    {value: s.emberRise},
            uMaxFrac: {value: s.emberCount},
          },
          transparent: true,
          blending:    THREE.AdditiveBlending,
          depthWrite:  false,
          depthTest:   false,
        })
        const embers = new THREE.Points(emberGeo, emberMat)
        embers.renderOrder = 999
        child.parent.add(embers)
        world.three.notifyChanged(embers)
        emberMats.push(emberMat)
      })

      fireMatsMap.set(component.eid, fireMats)
      emberMatsMap.set(component.eid, emberMats)
      console.log('[sculpture-fire] klar — eldytor:', fireMats.length, 'embers:', emberMats.length)
    }

    const onLoaded = (e: any) => applyFire(e.data.model)
    gltfListenerMap.set(component.eid, onLoaded)
    world.events.addListener(component.eid, ecs.events.GLTF_MODEL_LOADED, onLoaded)

    // Race-skydd: om GLB redan laddats innan komponenten kopplats
    const obj = world.three.entityToObject.get(component.eid)
    if (obj && obj.children.length > 0) applyFire(obj)
  },

  tick: (world, component) => {
    const t  = world.time.elapsed
    const s  = component.schema
    const ad = (window as any).audioData

    // Audioreaktivitet — bas pumpar intensitet, mid driver hastighet
    const react = s.audioReact
    const bass  = ad?.active ? ad.bass : 0
    const mid   = ad?.active ? ad.mid  : 0

    const effIntensity = s.intensity * (1.0 + bass * react * 1.8)
    const effSpeed     = s.speed     * (1.0 + mid  * react * 1.0)

    // Uppdatera alla eldmaterial varje tick
    const fireMats = fireMatsMap.get(component.eid)
    if (fireMats) {
      for (const mat of fireMats) {
        mat.uniforms.time.value           = t * effSpeed
        mat.uniforms.uIntensity.value     = effIntensity
        mat.uniforms.uNoiseScale.value    = s.noiseScale
        mat.uniforms.uGlowStrength.value  = s.glowStrength
        mat.uniforms.uFlameHeight.value   = s.flameHeight
        mat.uniforms.uSurfaceOffset.value = s.surfaceOffset
      }
    }

    // Uppdatera embers
    const emberMats = emberMatsMap.get(component.eid)
    if (emberMats) {
      for (const mat of emberMats) {
        mat.uniforms.time.value     = t
        mat.uniforms.uSize.value    = s.emberSize
        mat.uniforms.uSpeed.value   = s.emberSpeed * effSpeed
        mat.uniforms.uRise.value    = s.emberRise
        mat.uniforms.uMaxFrac.value = s.emberCount
      }
    }
  },

  remove: (world, component) => {
    const listener = gltfListenerMap.get(component.eid)
    if (listener) {
      world.events.removeListener(component.eid, ecs.events.GLTF_MODEL_LOADED, listener)
      gltfListenerMap.delete(component.eid)
    }
    fireMatsMap.delete(component.eid)
    emberMatsMap.delete(component.eid)
    setupDoneMap.delete(component.eid)
  },
})
