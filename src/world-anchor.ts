import * as ecs from '@8thwall/ecs'

// ── World-anchor ────────────────────────────────────────────────────────────
// MARKÖR-PRIMÄR tracking (för markör på podiets topplatta man tittar ner på).
// Besökarläge: innehållet följer bildmålet KONTINUERLIGT, men objektets pose
// lågpass-/adaptivt dämpas (mycket dämpning vid små jitter, följsamt vid verklig
// rörelse) → stabilt utan att drifta. Markören är enda referensen; SLAM-drift
// spelar ingen roll. Tappas markören kort hålls senaste pose.
//
// Admin/kalibreringsläge (?admin / ?calibrate): OFÖRÄNDRAT — fryser mot markören
// (scene.attach), man nudgar fritt, SPARA räknar om till markör-relativ offset.
// Sparformatet (markör-relativ pos/rot/scale) är identiskt → gamla kalibreringar
// och admin-UI:t funkar som förut.
//
// Användning i Studio: lägg komponenten på objektet som ska ankras (barn till
// ImageTarget). Sätt targetName = bildmålets namn ("fram"). Den authored
// positionen relativt ImageTarget används som offset om ingen sparad kalibrering
// finns.

// Gemensamt
const hitsMap      = new Map<bigint, number>()
const lockedMap    = new Map<bigint, boolean>()   // status/debug + calibrate-läge
const appliedMap   = new Map<bigint, boolean>()
const markerMatMap = new Map<bigint, any>()        // markörens world-pose vid LÅSNING (calibrate)

// Markör-primärt (besökar-) läge
const acquiredMap    = new Map<bigint, boolean>()  // har vi börjat tracka markör-primärt
const offsetMap      = new Map<bigint, any>()       // Matrix4: markör-relativ offset
const markerObjMap   = new Map<bigint, any>()       // ImageTarget-objektet (uppdateras live)
const fPosMap        = new Map<bigint, any>()       // filtrerad position (Vector3)
const fQuatMap       = new Map<bigint, any>()       // filtrerad rotation (Quaternion)
const fSclMap        = new Map<bigint, any>()       // skala (Vector3)
const savedAppliedMap = new Map<bigint, boolean>()  // har sparad kalibrering vävts in i offset

// Rotations-gizmo (en uppsättning ringar för det ankrade objektet)
let gizmoGroup: any   = null
let gizmoVisible      = false
let gizmoGrabAxis: any = null
let gizmoLastAngle    = 0
let gizmoSign         = 1

// Bygg en markör-relativ offset-matris från sparad kalibrering (XYZ-Euler).
function offsetFromSaved(THREE: any, saved: any) {
  const rad = (d: number) => d * Math.PI / 180
  const p = new THREE.Vector3(saved.pos[0], saved.pos[1], saved.pos[2])
  const e = new THREE.Euler(rad(saved.rot[0]), rad(saved.rot[1]), rad(saved.rot[2]), 'XYZ')
  const q = new THREE.Quaternion().setFromEuler(e)
  const sc = typeof saved.scale === 'number' ? saved.scale : 1
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(sc, sc, sc))
}

// Sätt objektets WORLD-pose (objektet är barn till scenen i besökarläge).
function applyWorld(world: any, obj: any, p: any, q: any, sc: any) {
  const THREE = (window as any).THREE
  const par = obj.parent
  const m = new THREE.Matrix4().compose(p, q, sc)
  if (par) {
    if (typeof par.updateWorldMatrix === 'function') par.updateWorldMatrix(true, false)
    m.premultiply(par.matrixWorld.clone().invert())
  }
  const lp = new THREE.Vector3(), lq = new THREE.Quaternion(), ls = new THREE.Vector3()
  m.decompose(lp, lq, ls)
  obj.position.copy(lp); obj.quaternion.copy(lq); obj.scale.copy(ls)
  if (typeof obj.updateMatrix === 'function') obj.updateMatrix()
  if (typeof obj.updateWorldMatrix === 'function') obj.updateWorldMatrix(true, false)
  world.three.notifyChanged(obj)
}

ecs.registerComponent({
  name: 'world-anchor',

  schema: {
    targetName:     ecs.string,    // namnet på bildmålet att tracka mot
    framesToLock:   ecs.f32,       // stabila träffar innan första placering
    // ── Markör-primär dämpning (besökarläge) ─────────────────────────────────
    smoothing:      ecs.f32,       // bas-dämpning per frame (0–1). Lägre = mjukare/mer lag
    responsiveness: ecs.f32,       // hur snabbt den hänger med vid verklig rörelse
    snapDist:       ecs.f32,       // snäpp direkt om målet är längre bort än detta (0 = aldrig)
    holdWhenLost:   ecs.boolean,   // håll senaste pose när markören tappas (annars samma)
    // ── Calibrate-läge ───────────────────────────────────────────────────────
    relock:         ecs.boolean,   // (endast calibrate) omkalibrera vid ny upptäckt
  },
  schemaDefaults: {
    targetName:     'fram',
    framesToLock:   6,
    smoothing:      0.15,
    responsiveness: 8,
    snapDist:       0.5,
    holdWhenLost:   true,
    relock:         false,
  },
  data: {},

  add: (world, component) => {
    lockedMap.set(component.eid, false)
    hitsMap.set(component.eid, 0)
    acquiredMap.set(component.eid, false)
  },

  tick: (world, component) => {
    const eid = component.eid
    const s   = component.schema

    const obj0  = world.three.entityToObject.get(eid)
    const THREE = (window as any).THREE

    // Exponera kalibrerings-API (flytta/rotera/skala live) första gången
    // three.js-objektet finns. Justerar objektets LOKALA transform.
    if (obj0 && THREE && !(window as any)._anchorApi) {
      const w = world
      const rad = (d: number) => d * Math.PI / 180

      const refresh = () => {
        if (typeof obj0.updateMatrix === 'function') obj0.updateMatrix()
        w.three.notifyChanged(obj0)
      }
      const camVecs = () => {
        const cam = w.three.activeCamera as any
        const q = new THREE.Quaternion()
        if (cam && cam.getWorldQuaternion) cam.getWorldQuaternion(q)
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q); right.y = 0
        const fwd   = new THREE.Vector3(0, 0, -1).applyQuaternion(q); fwd.y = 0
        if (right.lengthSq() > 1e-6) right.normalize()
        if (fwd.lengthSq()   > 1e-6) fwd.normalize()
        return {right, fwd, up: new THREE.Vector3(0, 1, 0)}
      }

      ;(window as any)._anchorApi = {
        isReady: () => true,
        moveScreen: (dRight: number, dUp: number) => {
          const {right, up} = camVecs()
          obj0.position.addScaledVector(right, dRight).addScaledVector(up, dUp)
          refresh()
        },
        moveDepth: (d: number) => {
          const {fwd} = camVecs()
          obj0.position.addScaledVector(fwd, d)
          refresh()
        },
        rotateYaw:   (deg: number) => { obj0.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), rad(deg)); refresh() },
        rotatePitch: (deg: number) => { obj0.rotateOnWorldAxis(camVecs().right, rad(deg)); refresh() },
        scaleBy:     (f: number)   => { obj0.scale.multiplyScalar(f); refresh() },

        // ── Rotations-gizmo: tre ringar (X röd, Y grön, Z blå) ──────────────
        showGizmo: (on: boolean) => {
          gizmoVisible = on
          if (on && !gizmoGroup) {
            gizmoGroup = new THREE.Group()
            const mk = (color: number, axis: any, ex: number, ey: number, ez: number) => {
              const geo = new THREE.TorusGeometry(1, 0.06, 12, 64)
              const matl = new THREE.MeshBasicMaterial({color, transparent: true, opacity: 0.9, depthTest: false})
              const m = new THREE.Mesh(geo, matl)
              m.rotation.set(ex, ey, ez)
              m.renderOrder = 10000
              m.userData.axis = axis
              return m
            }
            gizmoGroup.add(mk(0x4499ff, new THREE.Vector3(0, 0, 1), 0, 0, 0))             // Z blå (XY-plan)
            gizmoGroup.add(mk(0xff5555, new THREE.Vector3(1, 0, 0), 0, Math.PI / 2, 0))   // X röd
            gizmoGroup.add(mk(0x55ff77, new THREE.Vector3(0, 1, 0), Math.PI / 2, 0, 0))   // Y grön
            w.three.scene.add(gizmoGroup)
          }
          if (gizmoGroup) gizmoGroup.visible = on
        },
        gizmoDown: (x: number, y: number) => {
          if (!gizmoGroup || !gizmoVisible) return false
          const cam = w.three.activeCamera as any
          const ndc = new THREE.Vector2((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
          const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam)
          gizmoGroup.updateWorldMatrix(true, true)
          const hits = ray.intersectObjects(gizmoGroup.children, false)
          if (!hits.length) { gizmoGrabAxis = null; return false }
          gizmoGrabAxis = hits[0].object.userData.axis.clone()
          const c = gizmoGroup.position.clone().project(cam)
          const cx = (c.x * 0.5 + 0.5) * window.innerWidth
          const cy = (-c.y * 0.5 + 0.5) * window.innerHeight
          gizmoLastAngle = Math.atan2(y - cy, x - cx)
          const camPos = new THREE.Vector3(); cam.getWorldPosition(camPos)
          const toCam = camPos.sub(gizmoGroup.position).normalize()
          gizmoSign = (gizmoGrabAxis.dot(toCam) >= 0) ? -1 : 1
          return true
        },
        gizmoMove: (x: number, y: number) => {
          if (!gizmoGrabAxis) return
          const cam = w.three.activeCamera as any
          const c = gizmoGroup.position.clone().project(cam)
          const cx = (c.x * 0.5 + 0.5) * window.innerWidth
          const cy = (-c.y * 0.5 + 0.5) * window.innerHeight
          let ang = Math.atan2(y - cy, x - cx)
          let delta = ang - gizmoLastAngle
          if (delta >  Math.PI) delta -= 2 * Math.PI
          if (delta < -Math.PI) delta += 2 * Math.PI
          gizmoLastAngle = ang
          obj0.rotateOnWorldAxis(gizmoGrabAxis, delta * gizmoSign)
          refresh()
        },
        gizmoUp: () => { gizmoGrabAxis = null },

        read: () => {
          const d = (r: number) => Math.round(r * 180 / Math.PI * 10) / 10
          const n = (v: number) => Math.round(v * 1000) / 1000
          const markerMat = markerMatMap.get(eid)
          // Efter låsning (calibrate) ligger objektet i world space. Räkna om till
          // markör-relativ offset (markör⁻¹ · objektWorld) så besökarna får rätt.
          if (THREE && markerMat) {
            obj0.updateWorldMatrix(true, false)
            const rel = markerMat.clone().invert().multiply(obj0.matrixWorld)
            const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
            rel.decompose(p, q, sc)
            const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
            return {pos: [n(p.x), n(p.y), n(p.z)], rot: [d(e.x), d(e.y), d(e.z)], scale: n(sc.x)}
          }
          const e = obj0.rotation
          return {
            pos:   [n(obj0.position.x), n(obj0.position.y), n(obj0.position.z)],
            rot:   [d(e.x), d(e.y), d(e.z)],
            scale: n(obj0.scale.x),
          }
        },
      }
    }

    // Positionera/skala rotations-gizmot vid objektet när det visas.
    if (THREE && obj0 && gizmoGroup && gizmoVisible) {
      try {
        const box    = new THREE.Box3().setFromObject(obj0)
        const center = box.getCenter(new THREE.Vector3())
        const size   = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)
        gizmoGroup.position.copy(center)
        gizmoGroup.scale.setScalar(Math.max(maxDim * 0.32, 0.05))
        if (typeof gizmoGroup.updateMatrix === 'function') gizmoGroup.updateMatrix()
        world.three.notifyChanged(gizmoGroup)
      } catch (e) { /* noop */ }
    }

    // Är bildmålet just nu spårat? (sätts av pipeline-lyssnaren i index.html)
    const state = (window as any)._imageTargetState || {}
    const name  = (s.targetName || '').trim()
    const found = name
      ? !!state[name]
      : Object.keys(state).some(k => state[k] === true)

    const threshold = Math.max(1, Math.floor(s.framesToLock))
    const locked = lockedMap.get(eid) ?? false
    const status: any = {
      found,
      hits:   hitsMap.get(eid) ?? 0,
      locked,
      target: name || '(any)',
      threshold,
      err: (window as any)._anchorStatus?.err,
    }
    ;(window as any)._anchorStatus = status

    const calibrating = !!(window as any)._calibrateMode
    if (calibrating) status.target = 'KALIBRERING'

    const scene = world.three.scene
    if (!obj0 || !scene || !THREE) return

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN / KALIBRERING: frys mot markören (oförändrat beteende)
    // ═══════════════════════════════════════════════════════════════════════
    if (calibrating) {
      if (locked && !s.relock) return
      if (!found) { hitsMap.set(eid, 0); return }

      const hits = (hitsMap.get(eid) ?? 0) + 1
      hitsMap.set(eid, hits)
      status.hits = hits
      if (hits < threshold) return

      const obj    = obj0
      const parent = obj.parent
      try {
        const saved = (window as any)._savedCalibration
        if (saved) {
          const rad = (d: number) => d * Math.PI / 180
          if (Array.isArray(saved.pos)) obj.position.set(saved.pos[0], saved.pos[1], saved.pos[2])
          if (Array.isArray(saved.rot)) {
            const eul = new THREE.Euler(rad(saved.rot[0]), rad(saved.rot[1]), rad(saved.rot[2]), 'XYZ')
            obj.quaternion.setFromEuler(eul)
          }
          if (typeof saved.scale === 'number') obj.scale.setScalar(saved.scale)
          if (typeof obj.updateMatrix === 'function') obj.updateMatrix()
          if (typeof obj.updateWorldMatrix === 'function') obj.updateWorldMatrix(true, false)
        }
        if (parent) {
          if (typeof parent.updateWorldMatrix === 'function') parent.updateWorldMatrix(true, false)
          markerMatMap.set(eid, parent.matrixWorld.clone())
        }
        if (typeof (scene as any).attach === 'function') (scene as any).attach(obj)
        else if (obj.parent) { obj.parent.remove(obj); scene.add(obj) }
        obj.visible = true
        world.three.notifyChanged(obj)
        lockedMap.set(eid, true)
        hitsMap.set(eid, 0)
        status.locked = true
        status.err = undefined
        console.log('[world-anchor] (calibrate) låst i world space')
      } catch (err: any) {
        status.err = String((err && err.message) || err)
        console.warn('[world-anchor] kunde inte låsa:', err)
      }
      return
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BESÖKARE: markör-primär kontinuerlig tracking med adaptiv dämpning
    // ═══════════════════════════════════════════════════════════════════════
    const obj = obj0
    const acquired = acquiredMap.get(eid) ?? false

    if (!acquired) {
      // Dölj tills vi fått en stabil första placering (annars syns den fel).
      if (obj.visible !== false) { obj.visible = false; world.three.notifyChanged(obj) }
      if (!found) { hitsMap.set(eid, 0); return }
      const hits = (hitsMap.get(eid) ?? 0) + 1
      hitsMap.set(eid, hits)
      status.hits = hits
      if (hits < threshold) return

      const parent = obj.parent
      if (!parent) return
      if (typeof parent.updateWorldMatrix === 'function') parent.updateWorldMatrix(true, false)
      markerObjMap.set(eid, parent)

      // Offset: sparad kalibrering om den finns, annars objektets authored lokala transform.
      const saved = (window as any)._savedCalibration
      let offset: any
      if (saved && Array.isArray(saved.pos)) {
        offset = offsetFromSaved(THREE, saved)
        savedAppliedMap.set(eid, true)
      } else {
        if (typeof obj.updateMatrix === 'function') obj.updateMatrix()
        offset = obj.matrix.clone()
        savedAppliedMap.set(eid, false)
      }
      offsetMap.set(eid, offset)

      // Lossa till world space så vi kan driva posen filtrerat (inte tvingas följa
      // markörens jitter via förälder-länken).
      if (typeof (scene as any).attach === 'function') (scene as any).attach(obj)
      else { obj.parent && obj.parent.remove(obj); scene.add(obj) }

      // Snäpp till första målposen och initiera filtret.
      const tw = parent.matrixWorld.clone().multiply(offset)
      const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3()
      tw.decompose(tp, tq, ts)
      fPosMap.set(eid, tp.clone())
      fQuatMap.set(eid, tq.clone())
      fSclMap.set(eid, ts.clone())
      applyWorld(world, obj, tp, tq, ts)
      obj.visible = true
      acquiredMap.set(eid, true)
      lockedMap.set(eid, true)
      status.locked = true
      status.err = undefined
      console.log('[world-anchor] markör-primär tracking igång')
      return
    }

    // Sent anländande sparad kalibrering (fetch klar efter acquire) → väv in en gång.
    if (!savedAppliedMap.get(eid)) {
      const saved = (window as any)._savedCalibration
      if (saved && Array.isArray(saved.pos)) {
        offsetMap.set(eid, offsetFromSaved(THREE, saved))
        savedAppliedMap.set(eid, true)
      }
    }

    // Markören tappad → håll senaste pose (topplatte-markören syns nästan alltid).
    if (!found) return

    const markerObj = markerObjMap.get(eid)
    const offset    = offsetMap.get(eid)
    if (!markerObj || !offset) return
    if (typeof markerObj.updateWorldMatrix === 'function') markerObj.updateWorldMatrix(true, false)

    const tw = markerObj.matrixWorld.clone().multiply(offset)
    const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3()
    tw.decompose(tp, tq, ts)

    const fp = fPosMap.get(eid)
    const fq = fQuatMap.get(eid)
    if (!fp || !fq) return

    // Adaptiv dämpning (one-euro-liknande): liten avvikelse = mest dämpning (dödar
    // jitter), stor avvikelse = följsam (verklig rörelse). Snäpp om målet hoppar långt.
    const dist = fp.distanceTo(tp)
    const base = Math.min(Math.max(s.smoothing, 0), 1)
    let alpha: number
    if (s.snapDist > 0 && dist > s.snapDist) {
      alpha = 1
    } else {
      alpha = Math.min(base + Math.max(s.responsiveness, 0) * dist, 1)
    }
    fp.lerp(tp, alpha)
    fq.slerp(tq, alpha)
    fSclMap.set(eid, ts)
    applyWorld(world, obj, fp, fq, ts)
  },

  remove: (world, component) => {
    const eid = component.eid
    lockedMap.delete(eid)
    hitsMap.delete(eid)
    appliedMap.delete(eid)
    markerMatMap.delete(eid)
    acquiredMap.delete(eid)
    offsetMap.delete(eid)
    markerObjMap.delete(eid)
    fPosMap.delete(eid)
    fQuatMap.delete(eid)
    fSclMap.delete(eid)
    savedAppliedMap.delete(eid)
  },
})
