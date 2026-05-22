import * as ecs from '@8thwall/ecs'
import {fireVertexShader, fireFragmentShader} from './fire-shader'
import {particleVertexShader, particleFragmentShader} from './particle-shader'

const fireMatsMap     = new Map<bigint, any[]>()
const p1MatsMap       = new Map<bigint, any[]>()
const p2MatsMap       = new Map<bigint, any[]>()
const pillarMeshMap   = new Map<bigint, any[]>()
const gltfListenerMap = new Map<bigint, (e: any) => void>()
const setupDoneMap    = new Map<bigint, boolean>()

let THREE: any = null

ecs.registerComponent({
  name: 'sculpture-fire',

  schema: {
    density:    ecs.f32,   // yteld intensitet 0–2
    speed:      ecs.f32,   // hastighet 0.1–3
    audioReact: ecs.f32,   // hur mycket musiken påverkar 0–3

    pillarOn:   ecs.f32,   // 1 = på, 0 = av
    pillarX:    ecs.f32,   // position vänster/höger
    pillarY:    ecs.f32,   // position upp/ner
    pillarZ:    ecs.f32,   // position fram/bak
    pillarH:    ecs.f32,   // höjd (0 = auto)
    pillarW:    ecs.f32,   // bredd (0 = auto)
    pillarInt:  ecs.f32,   // pelar-intensitet 0–2

    p1Count:    ecs.f32,   // lager 1 — andel partiklar aktiva 0–1
    p1Size:     ecs.f32,   // lager 1 — storlek i pixlar
    p1Speed:    ecs.f32,   // lager 1 — hastighet
    p1Rise:     ecs.f32,   // lager 1 — stigningshöjd

    p2Count:    ecs.f32,   // lager 2 — andel partiklar aktiva 0–1
    p2Size:     ecs.f32,   // lager 2 — storlek i pixlar
    p2Speed:    ecs.f32,   // lager 2 — hastighet
    p2Rise:     ecs.f32,   // lager 2 — stigningshöjd
  },
  schemaDefaults: {
    density:    0.85,
    speed:      1.0,
    audioReact: 1.5,

    pillarOn:   1,
    pillarX:    0,
    pillarY:    0,
    pillarZ:    0,
    pillarH:    0,
    pillarW:    0,
    pillarInt:  1.2,

    p1Count:    0.8,
    p1Size:     14.0,
    p1Speed:    1.0,
    p1Rise:     0.3,

    p2Count:    0.5,
    p2Size:     6.0,
    p2Speed:    1.6,
    p2Rise:     0.55,
  },
  data: {},

  add: (world, component) => {
    THREE = (window as any).THREE
    if (!THREE) { console.error('[sculpture-fire] THREE saknas'); return }
    setupDoneMap.set(component.eid, false)

    const makeParticleGeo = (pa: any, maxP: number) => {
      const total = pa.count
      const step  = Math.max(1, Math.floor(total / maxP))
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

      const s         = component.schema
      const fireMats: any[] = []
      const p1Mats:   any[] = []
      const p2Mats:   any[] = []
      const pillarMeshes: any[] = []

      let firstMeshParent: any = null

      model.traverse((child: any) => {
        if (!child.isMesh) return

        // Save parent of first mesh — this is where pillar will live
        if (!firstMeshParent) firstMeshParent = child.parent

        // ── Surface fire ──────────────────────────────────────────────────────
        const fireMat = new THREE.ShaderMaterial({
          vertexShader: fireVertexShader, fragmentShader: fireFragmentShader,
          uniforms:     {time: {value: 0}, density: {value: s.density}},
          transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, depthTest: false, side: THREE.DoubleSide,
        })
        const fireMesh = child.clone()
        fireMesh.material = fireMat
        fireMesh.scale.multiplyScalar(1.02)
        fireMesh.renderOrder = 998
        child.parent.add(fireMesh)
        world.three.notifyChanged(fireMesh)
        fireMats.push(fireMat)

        const pa = child.geometry?.attributes?.position
        if (!pa) return

        // ── Particle layer 1 ──────────────────────────────────────────────────
        const geo1  = makeParticleGeo(pa, 200)
        const pMat1 = new THREE.ShaderMaterial({
          vertexShader: particleVertexShader, fragmentShader: particleFragmentShader,
          uniforms: {
            time:     {value: 0},
            uSize:    {value: s.p1Size},
            uSpeed:   {value: s.p1Speed},
            uRise:    {value: s.p1Rise},
            uMaxFrac: {value: s.p1Count},
          },
          transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, depthTest: false,
        })
        const pts1 = new THREE.Points(geo1, pMat1)
        pts1.renderOrder = 999
        child.parent.add(pts1)
        world.three.notifyChanged(pts1)
        p1Mats.push(pMat1)

        // ── Particle layer 2 ──────────────────────────────────────────────────
        const geo2  = makeParticleGeo(pa, 150)
        const pMat2 = new THREE.ShaderMaterial({
          vertexShader: particleVertexShader, fragmentShader: particleFragmentShader,
          uniforms: {
            time:     {value: 0},
            uSize:    {value: s.p2Size},
            uSpeed:   {value: s.p2Speed},
            uRise:    {value: s.p2Rise},
            uMaxFrac: {value: s.p2Count},
          },
          transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, depthTest: false,
        })
        const pts2 = new THREE.Points(geo2, pMat2)
        pts2.renderOrder = 999
        child.parent.add(pts2)
        world.three.notifyChanged(pts2)
        p2Mats.push(pMat2)
      })

      // ── Fire pillar — added as sibling of mesh (only confirmed-working pattern) ──
      if (firstMeshParent && s.pillarOn > 0.5) {
        const h = s.pillarH > 0 ? s.pillarH : 1.2
        const w = s.pillarW > 0 ? s.pillarW : 0.45

        const planeGeo = new THREE.PlaneGeometry(w, h, 1, 8)

        for (let i = 0; i < 2; i++) {
          const planeMat = new THREE.ShaderMaterial({
            vertexShader: fireVertexShader, fragmentShader: fireFragmentShader,
            uniforms:     {time: {value: 0}, density: {value: s.pillarInt}},
            transparent: true, blending: THREE.AdditiveBlending,
            depthWrite: false, depthTest: false, side: THREE.DoubleSide,
          })
          const plane = new THREE.Mesh(planeGeo, planeMat)
          plane.position.set(s.pillarX, h / 2 + s.pillarY, s.pillarZ)
          plane.rotation.y = i * (Math.PI / 2)
          plane.renderOrder = 999
          firstMeshParent.add(plane)
          world.three.notifyChanged(plane)
          pillarMeshes.push({mesh: plane, mat: planeMat, h})
          fireMats.push(planeMat)
        }
        console.log('[sculpture-fire] Pelare skapad i firstMeshParent, höjd:', h)
      }

      fireMatsMap.set(component.eid, fireMats)
      p1MatsMap.set(component.eid, p1Mats)
      p2MatsMap.set(component.eid, p2Mats)
      pillarMeshMap.set(component.eid, pillarMeshes)
      console.log('[sculpture-fire] klar — ytor:', fireMats.length, 'pillar:', pillarMeshes.length)
    }

    const onLoaded = (e: any) => applyFire(e.data.model)
    gltfListenerMap.set(component.eid, onLoaded)
    world.events.addListener(component.eid, ecs.events.GLTF_MODEL_LOADED, onLoaded)
    const obj = world.three.entityToObject.get(component.eid)
    if (obj && obj.children.length > 0) applyFire(obj)
  },

  tick: (world, component) => {
    const t  = world.time.elapsed
    const s  = component.schema
    const ad = (window as any).audioData

    const react = s.audioReact
    const bass  = ad?.active ? ad.bass : 0
    const mid   = ad?.active ? ad.mid  : 0

    const effectiveDensity = s.density   * (1.0 + bass * react * 2.0)
    const effectiveSpeed   = s.speed     * (1.0 + mid  * react * 1.2)
    const effectivePillar  = s.pillarInt * (1.0 + bass * react * 1.5)

    const fireMats    = fireMatsMap.get(component.eid)
    const pillarMeshes = pillarMeshMap.get(component.eid)

    if (fireMats) {
      // Pillar mat refs live in fireMats but we need to know which are pillar mats
      const pillarMatSet = new Set(pillarMeshes?.map((e: any) => e.mat) ?? [])
      for (const mat of fireMats) {
        mat.uniforms.time.value    = t * effectiveSpeed
        mat.uniforms.density.value = pillarMatSet.has(mat) ? effectivePillar : effectiveDensity
      }
    }

    const p1Mats = p1MatsMap.get(component.eid)
    if (p1Mats) {
      for (const mat of p1Mats) {
        mat.uniforms.time.value     = t
        mat.uniforms.uSize.value    = s.p1Size
        mat.uniforms.uSpeed.value   = s.p1Speed * effectiveSpeed
        mat.uniforms.uRise.value    = s.p1Rise
        mat.uniforms.uMaxFrac.value = s.p1Count
      }
    }

    const p2Mats = p2MatsMap.get(component.eid)
    if (p2Mats) {
      for (const mat of p2Mats) {
        mat.uniforms.time.value     = t
        mat.uniforms.uSize.value    = s.p2Size
        mat.uniforms.uSpeed.value   = s.p2Speed * effectiveSpeed
        mat.uniforms.uRise.value    = s.p2Rise
        mat.uniforms.uMaxFrac.value = s.p2Count
      }
    }

    // Live-move and show/hide pillar planes
    if (pillarMeshes) {
      for (const entry of pillarMeshes) {
        const {mesh, h} = entry
        mesh.visible    = s.pillarOn > 0.5
        mesh.position.x = s.pillarX
        mesh.position.y = h / 2 + s.pillarY
        mesh.position.z = s.pillarZ
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
    p1MatsMap.delete(component.eid)
    p2MatsMap.delete(component.eid)
    pillarMeshMap.delete(component.eid)
    setupDoneMap.delete(component.eid)
  },
})
