import * as ecs from '@8thwall/ecs'
import {fireVertexShader, fireFragmentShader} from './fire-shader'
import {particleVertexShader, particleFragmentShader} from './particle-shader'

const fireMatsMap     = new Map<bigint, any[]>()
const p1MatsMap       = new Map<bigint, any[]>()
const p2MatsMap       = new Map<bigint, any[]>()
const origMeshMap     = new Map<bigint, any[]>()  // originalmeshes (den solida modellen) för att kunna dölja/visa
const createdObjMap   = new Map<bigint, any[]>()  // skapade eld-/partikel-objekt, för städning vid remove
const gltfListenerMap = new Map<bigint, (e: any) => void>()
const setupDoneMap    = new Map<bigint, boolean>()

let THREE: any = null

// Smoothing state per entity för audio shift — undviker jittriga skift
const audioShiftSmoothMap = new Map<bigint, number>()

// Ta bort tidigare skapade eld-/partikel-objekt (förhindrar dubbletter vid
// re-init/hot-reload). Rör INTE geometrin (eld-meshen delar modellens geometri).
const cleanupCreated = (eid: bigint) => {
  const objs = createdObjMap.get(eid)
  if (objs) {
    for (const o of objs) {
      if (o.parent) o.parent.remove(o)
      try { if (o.material && o.material.dispose) o.material.dispose() } catch (e) { /* */ }
    }
  }
  createdObjMap.delete(eid)
}

ecs.registerComponent({
  name: 'sculpture-fire',

  schema: {
    showModel:  ecs.boolean,   // visa den solida 3D-modellen under elden (av = bara effekter)

    inflate:    ecs.f32,       // hur mycket elden blåses ut utanför skulpturen (andel av höjd)
    softness:   ecs.f32,       // 0 = skarpa inre lågor, 1 = mjuka inre lågor
    feather:    ecs.f32,       // 0 = skarp kontur, 1 = mjuk urtonad kant (Photoshop-feather)

    density:    ecs.f32,
    speed:      ecs.f32,
    audioReact: ecs.f32,

    p1Count:    ecs.f32,
    p1Size:     ecs.f32,
    p1Speed:    ecs.f32,
    p1Rise:     ecs.f32,

    p2Count:    ecs.f32,
    p2Size:     ecs.f32,
    p2Speed:    ecs.f32,
    p2Rise:     ecs.f32,
  },
  schemaDefaults: {
    showModel:  true,

    inflate:    0.05,
    softness:   0.6,
    feather:    0.5,

    density:    0.85,
    speed:      1.0,
    audioReact: 1.5,

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

    // Hämta en giltig bounding box för en mesh (geometrin, eller via sfären)
    const getBox = (g: any) => {
      let box = g.boundingBox
      if (!box) { try { g.computeBoundingBox(); box = g.boundingBox } catch (e) { /* */ } }
      if (box && isFinite(box.min.x) && isFinite(box.max.x) && box.max.x > box.min.x) return box
      const sph = g.boundingSphere
      if (sph && isFinite(sph.radius) && sph.radius > 0) {
        const c = sph.center, r = sph.radius
        return new THREE.Box3(
          new THREE.Vector3(c.x - r, c.y - r, c.z - r),
          new THREE.Vector3(c.x + r, c.y + r, c.z + r))
      }
      return null
    }

    // Fallback: generera partiklar i modellens volym när vertexdatan ej är
    // åtkomlig på CPU (8th Wall exponerar inte alltid attributen). Gnistor
    // stiger i en pelare runt figuren.
    const makeParticleGeoFromBox = (box: any, cnt: number) => {
      const pos  = new Float32Array(cnt * 3)
      const off  = new Float32Array(cnt)
      const seed = new Float32Array(cnt)
      const idx  = new Float32Array(cnt)
      const sx = box.max.x - box.min.x, sy = box.max.y - box.min.y, sz = box.max.z - box.min.z
      for (let i = 0; i < cnt; i++) {
        pos[i*3]   = box.min.x + (0.25 + 0.5 * Math.random()) * sx
        pos[i*3+1] = box.min.y + Math.random() * sy
        pos[i*3+2] = box.min.z + (0.25 + 0.5 * Math.random()) * sz
        off[i]  = Math.random()
        seed[i] = Math.random()
        idx[i]  = cnt > 1 ? i / (cnt - 1) : 0
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
      cleanupCreated(component.eid)   // ta bort ev. gamla objekt från tidigare körning
      setupDoneMap.set(component.eid, true)

      const s = component.schema
      const fireMats: any[] = []
      const p1Mats:   any[] = []
      const p2Mats:   any[] = []
      const origMeshes: any[] = []
      const createdObjs: any[] = []   // eld-/partikel-objekt att städa vid remove
      let diag = ''

      model.traverse((child: any) => {
        if (!child.isMesh) return

        // Spara originalmeshen så vi kan dölja/visa den solida modellen via showModel
        origMeshes.push(child)

        // Säkra normaler — fresnel-glöd och utblåsning behöver dem
        if (!child.geometry.attributes.normal) child.geometry.computeVertexNormals()

        // Räkna ut Y-min/max så shadern kan mappa varje vertex till 0-1 (ben→huvud)
        child.geometry.computeBoundingBox()
        const bb     = child.geometry.boundingBox
        const yMin   = bb ? bb.min.y : -1
        const yMax   = bb ? bb.max.y :  1
        const height = Math.max(yMax - yMin, 0.001)  // modellhöjd för enhetsoberoende utblåsning

        // ── Surface fire med VU-bar ───────────────────────────────────────────
        const fireMat = new THREE.ShaderMaterial({
          vertexShader: fireVertexShader, fragmentShader: fireFragmentShader,
          uniforms: {
            time:        {value: 0},
            density:     {value: s.density},
            uAudioLevel: {value: 0},
            uWorldYMin:  {value: yMin},   // uppdateras i tick (världsrymd)
            uWorldYMax:  {value: yMax},
            uInflate:    {value: height * s.inflate},
            uSoftness:   {value: s.softness},
            uFeather:    {value: s.feather},
          },
          transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, depthTest: false, side: THREE.DoubleSide,
        })
        fireMat.userData.height = height  // sparas så tick kan räkna om utblåsning live
        if (bb) { fireMat.userData.bbMin = bb.min.clone(); fireMat.userData.bbMax = bb.max.clone() }
        // Skapa en ny mesh istället för child.clone() — klon kopierar userData
        // som kan innehålla ett BigInt (entitets-id) → JSON-serialiseringskrasch.
        const fireMesh = new THREE.Mesh(child.geometry, fireMat)
        fireMesh.position.copy(child.position)
        fireMesh.quaternion.copy(child.quaternion)
        fireMesh.scale.copy(child.scale).multiplyScalar(1.02)
        fireMesh.renderOrder = 998
        child.parent.add(fireMesh)
        world.three.notifyChanged(fireMesh)
        fireMat.userData.mesh = fireMesh   // för att räkna om världs-Y i tick
        fireMats.push(fireMat)
        createdObjs.push(fireMesh)

        const geo = child.geometry
        const ga  = geo && geo.attributes
        const pa  = geo && typeof geo.getAttribute === 'function'
          ? geo.getAttribute('position')
          : (ga ? ga.position : null)
        // Partikel-positioner: från ytan om vertexdatan finns, annars från
        // modellens volym (bounding box) som fallback.
        const box = pa ? null : getBox(geo)
        if (!diag) {
          diag = pa ? 'yta' : (box ? 'box-fallback' : `INGEN pos/box (bb=${geo && geo.boundingBox ? 'y' : 'n'} bs=${geo && geo.boundingSphere ? 'y' : 'n'})`)
        }
        if (!pa && !box) return

        // ── Particle layer 1 ──────────────────────────────────────────────────
        const geo1  = pa ? makeParticleGeo(pa, 200) : makeParticleGeoFromBox(box, 200)
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
        pts1.position.copy(child.position)
        pts1.quaternion.copy(child.quaternion)
        pts1.scale.copy(child.scale)
        pts1.renderOrder = 999
        child.parent.add(pts1)
        world.three.notifyChanged(pts1)
        p1Mats.push(pMat1)
        createdObjs.push(pts1)

        // ── Particle layer 2 ──────────────────────────────────────────────────
        const geo2  = pa ? makeParticleGeo(pa, 150) : makeParticleGeoFromBox(box, 150)
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
        pts2.position.copy(child.position)
        pts2.quaternion.copy(child.quaternion)
        pts2.scale.copy(child.scale)
        pts2.renderOrder = 999
        child.parent.add(pts2)
        world.three.notifyChanged(pts2)
        p2Mats.push(pMat2)
        createdObjs.push(pts2)
      })

      createdObjMap.set(component.eid, createdObjs)
      fireMatsMap.set(component.eid, fireMats)
      p1MatsMap.set(component.eid, p1Mats)
      p2MatsMap.set(component.eid, p2Mats)
      origMeshMap.set(component.eid, origMeshes)
      console.log(`[sculpture-fire] ytor: ${fireMats.length} | partiklar p1: ${p1Mats.length} p2: ${p2Mats.length} | ${diag}`)
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

    // ── Audio-reaktiv VU-bar (enda audio-effekten) ─────────────────────────
    // Baren reser sig från benen mot huvudet med musiken — partiklar oberoende
    const react = s.audioReact
    const bass   = ad?.active ? ad.bass : 0
    const mid    = ad?.active ? ad.mid  : 0
    const treble = ad?.active ? (ad.treble ?? 0) : 0

    // Musiken är hög-pitch (sax, sång, trumma) — treble och mid driver mest
    // Bas ger stadig botten, treble/mid driver baren uppåt mot huvudet
    const energy = bass * 0.5 + mid * 1.0 + treble * 1.6
    const rawLevel = ad?.active ? Math.min(1.0, energy * react * 1.5) : 0

    // Snabb respons — både uppgång och nedgång ska kännas omedelbart
    // (höjningar i sång → uppåt, pauser → snabbt ner till lila)
    const prev   = audioShiftSmoothMap.get(component.eid) ?? 0
    const smooth = prev + (rawLevel - prev) * 0.35
    audioShiftSmoothMap.set(component.eid, smooth)

    // ── Visa/dölj den solida 3D-modellen (live-togglebar i Studio) ─────────
    const origMeshes = origMeshMap.get(component.eid)
    if (origMeshes) {
      for (const m of origMeshes) {
        if (m.visible !== s.showModel) m.visible = s.showModel
      }
    }

    // ── Uppdatera kroppens eldmaterial ──────────────────────────────────────
    const fireMats = fireMatsMap.get(component.eid)
    if (fireMats) {
      const _v = THREE ? new THREE.Vector3() : null
      for (const mat of fireMats) {
        mat.uniforms.time.value        = t * s.speed
        mat.uniforms.density.value     = s.density
        mat.uniforms.uAudioLevel.value = smooth
        mat.uniforms.uInflate.value    = (mat.userData.height ?? 1) * s.inflate
        mat.uniforms.uSoftness.value   = s.softness
        mat.uniforms.uFeather.value    = s.feather

        // Räkna om modellens Y-spann i VÄRLDEN (så VU-baren reser sig rakt upp
        // även när modellen är roterad). 8 hörn av bounding box → billigt.
        const mesh = mat.userData.mesh, bbMin = mat.userData.bbMin, bbMax = mat.userData.bbMax
        if (_v && mesh && bbMin && bbMax) {
          if (mesh.updateWorldMatrix) mesh.updateWorldMatrix(true, false)
          const mw = mesh.matrixWorld
          let wmin = Infinity, wmax = -Infinity
          for (let xi = 0; xi < 2; xi++) for (let yi = 0; yi < 2; yi++) for (let zi = 0; zi < 2; zi++) {
            _v.set(xi ? bbMax.x : bbMin.x, yi ? bbMax.y : bbMin.y, zi ? bbMax.z : bbMin.z).applyMatrix4(mw)
            if (_v.y < wmin) wmin = _v.y
            if (_v.y > wmax) wmax = _v.y
          }
          mat.uniforms.uWorldYMin.value = wmin
          mat.uniforms.uWorldYMax.value = wmax
        }
      }
    }

    // ── Partiklar — alltid samma uppåtgående rörelse, ingen audio ──────────
    const p1Mats = p1MatsMap.get(component.eid)
    if (p1Mats) {
      for (const mat of p1Mats) {
        mat.uniforms.time.value     = t
        mat.uniforms.uSize.value    = s.p1Size
        mat.uniforms.uSpeed.value   = s.p1Speed
        mat.uniforms.uRise.value    = s.p1Rise
        mat.uniforms.uMaxFrac.value = s.p1Count
      }
    }

    const p2Mats = p2MatsMap.get(component.eid)
    if (p2Mats) {
      for (const mat of p2Mats) {
        mat.uniforms.time.value     = t
        mat.uniforms.uSize.value    = s.p2Size
        mat.uniforms.uSpeed.value   = s.p2Speed
        mat.uniforms.uRise.value    = s.p2Rise
        mat.uniforms.uMaxFrac.value = s.p2Count
      }
    }
  },

  remove: (world, component) => {
    const listener = gltfListenerMap.get(component.eid)
    if (listener) {
      world.events.removeListener(component.eid, ecs.events.GLTF_MODEL_LOADED, listener)
      gltfListenerMap.delete(component.eid)
    }
    cleanupCreated(component.eid)   // ta bort skapade eld-/partikel-objekt från scenen
    fireMatsMap.delete(component.eid)
    p1MatsMap.delete(component.eid)
    p2MatsMap.delete(component.eid)
    origMeshMap.delete(component.eid)
    setupDoneMap.delete(component.eid)
    audioShiftSmoothMap.delete(component.eid)
  },
})
