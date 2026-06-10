import * as ecs from '@8thwall/ecs'

// ── Marker-calibrate ────────────────────────────────────────────────────────
// Admin-/kalibreringsverktyg för innehåll som trackas NATIVT av 8th Walls
// ImageTarget (objektet ligger som BARN till ImageTarget — markören flyttar
// föräldern, barnet följer med automatiskt). Denna komponent gör INGEN egen
// tracking; den bara:
//   • Besökare: tillämpar ev. sparad kalibrering på objektets LOKALA transform
//     (lokal = markör-relativ, eftersom objektet är barn till ImageTarget).
//   • Admin/kalibrering (?admin / ?calibrate): exponerar window._anchorApi
//     (flytta/rotera/skala + gizmo) och låser mot markören så man kan nudga och
//     SPARA. Sparformatet (markör-relativ pos/rot/scale) är identiskt med det
//     gamla world-anchor:t → gamla kalibreringar och admin-UI:t funkar som förut.
//
// Användning i Studio: lägg komponenten på samma objekt som har sculpture-fire
// (barn till ImageTarget). Sätt targetName = bildmålets namn ("fram").

const lockedMap     = new Map<bigint, boolean>()
const hitsMap       = new Map<bigint, number>()
const markerMatMap  = new Map<bigint, any>()   // markörens world-pose vid LÅSNING (calibrate)
const savedAppliedMap = new Map<bigint, boolean>()  // besökar-kalibrering inlagd?

// Rotations-gizmo (en uppsättning ringar för det kalibrerade objektet)
let gizmoGroup: any    = null
let gizmoVisible       = false
let gizmoGrabAxis: any  = null
let gizmoLastAngle     = 0
let gizmoSign          = 1

ecs.registerComponent({
  name: 'marker-calibrate',

  schema: {
    targetName:   ecs.string,    // bildmålets namn (för status/lås)
    framesToLock: ecs.f32,       // stabila träffar innan admin-lås
    relock:       ecs.boolean,   // (endast calibrate) omkalibrera vid ny upptäckt
  },
  schemaDefaults: {
    targetName:   'fram',
    framesToLock: 6,
    relock:       false,
  },
  data: {},

  add: (world, component) => {
    lockedMap.set(component.eid, false)
    hitsMap.set(component.eid, 0)
    savedAppliedMap.set(component.eid, false)
  },

  tick: (world, component) => {
    const eid   = component.eid
    const s     = component.schema
    const obj0  = world.three.entityToObject.get(eid)
    const THREE = (window as any).THREE
    if (!obj0 || !THREE) return

    // ── Exponera kalibrerings-API (flytta/rotera/skala live) en gång ──────────
    // Justerar objektets transform. Under admin-lås ligger objektet i world space
    // (scene.attach) så gesterna känns kamera-relativa; read() räknar om till
    // markör-relativ offset.
    if (!(window as any)._anchorApi) {
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

        // ── Rotations-gizmo: tre ringar (X röd, Y grön, Z blå) ───────────────
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
          // Efter lås (calibrate) ligger objektet i world space. Räkna om till
          // markör-relativ offset (markör⁻¹ · objektWorld) så besökarna får rätt.
          if (markerMat) {
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
    if (gizmoGroup && gizmoVisible) {
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
    if (!scene) return

    // ═══════════════════════════════════════════════════════════════════════
    // ADMIN / KALIBRERING: frys mot markören, nudga fritt, SPARA
    // ═══════════════════════════════════════════════════════════════════════
    if (calibrating) {
      if (locked && !s.relock) return
      if (!found) { hitsMap.set(eid, 0); return }

      const hits = (hitsMap.get(eid) ?? 0) + 1
      hitsMap.set(eid, hits)
      status.hits = hits
      if (hits < threshold) return

      const obj    = obj0
      const parent = obj.parent   // = ImageTarget (objektet är barn till det)
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
        // Lossa till world space så nudge-gesterna blir kamera-relativa och stabila
        // medan markören är still. read()/SPARA räknar tillbaka till markör-relativt.
        if (typeof (scene as any).attach === 'function') (scene as any).attach(obj)
        else if (obj.parent) { obj.parent.remove(obj); scene.add(obj) }
        obj.visible = true
        world.three.notifyChanged(obj)
        lockedMap.set(eid, true)
        hitsMap.set(eid, 0)
        status.locked = true
        status.err = undefined
        console.log('[marker-calibrate] låst i world space (admin)')
      } catch (err: any) {
        status.err = String((err && err.message) || err)
        console.warn('[marker-calibrate] kunde inte låsa:', err)
      }
      return
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BESÖKARE: ingen egen tracking — native ImageTarget bär objektet.
    // Tillämpa bara sparad kalibrering på den LOKALA (markör-relativa) transformen.
    // Görs en gång; hanterar även sent anländande fetch (savedCalibration).
    // ═══════════════════════════════════════════════════════════════════════
    if (!savedAppliedMap.get(eid)) {
      const saved = (window as any)._savedCalibration
      if (saved && Array.isArray(saved.pos)) {
        const rad = (d: number) => d * Math.PI / 180
        obj0.position.set(saved.pos[0], saved.pos[1], saved.pos[2])
        if (Array.isArray(saved.rot)) {
          obj0.quaternion.setFromEuler(
            new THREE.Euler(rad(saved.rot[0]), rad(saved.rot[1]), rad(saved.rot[2]), 'XYZ'))
        }
        if (typeof saved.scale === 'number') obj0.scale.setScalar(saved.scale)
        if (typeof obj0.updateMatrix === 'function') obj0.updateMatrix()
        world.three.notifyChanged(obj0)
        savedAppliedMap.set(eid, true)
        console.log('[marker-calibrate] sparad kalibrering tillämpad (besökare)')
      }
    }
  },

  remove: (world, component) => {
    const eid = component.eid
    lockedMap.delete(eid)
    hitsMap.delete(eid)
    markerMatMap.delete(eid)
    savedAppliedMap.delete(eid)
  },
})
