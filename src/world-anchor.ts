import * as ecs from '@8thwall/ecs'

// ── World-anchor ────────────────────────────────────────────────────────────
// Bildmål på/bredvid en böjd, glansig skulptur trackar instabilt och innehållet
// försvinner när markören lämnar bilden. Den här komponenten låter 8th Wall
// positionera innehållet via bildmålet som vanligt, och "fryser" det sedan i
// world space (lossar det från bildmålet) efter några stabila träffar. Då hålls
// elden stadig av SLAM och står kvar även när markören är utanför kameran.
//
// Användning i Studio: lägg komponenten på samma objekt som ska ankras (t.ex.
// sculpture), som ligger som barn till ImageTarget. Sätt targetName = bildmålets
// namn ("fram"). Offseten (markör bredvid → eld på skulpturen) ställs in genom
// objektets vanliga position/rotation relativt ImageTarget i editorn.

const lockedMap   = new Map<bigint, boolean>()
const hitsMap     = new Map<bigint, number>()
const appliedMap  = new Map<bigint, boolean>()  // har sparad kalibrering applicerats
const markerMatMap = new Map<bigint, any>()     // markörens (förälderns) world-pose vid låsning
const markerObjMap = new Map<bigint, any>()     // referens till markör-objektet (uppdateras live av 8th Wall)
const lockOffsetMap = new Map<bigint, any>()    // frusen offset: markör⁻¹ · objektWorld vid låsning

// Rotations-gizmo (en uppsättning ringar för det ankrade objektet)
let gizmoGroup: any   = null
let gizmoVisible      = false
let gizmoGrabAxis: any = null
let gizmoLastAngle    = 0
let gizmoSign         = 1

ecs.registerComponent({
  name: 'world-anchor',

  schema: {
    targetName:   ecs.string,    // namnet på bildmålet att låsa mot
    framesToLock: ecs.f32,       // antal stabila träffar innan frysning
    relock:       ecs.boolean,   // true = omkalibrera vid varje ny upptäckt
    // ── Hybrid-korrigering (mot SLAM-drift) ──────────────────────────────────
    correct:      ecs.boolean,   // efter lås: glid mot markörens pose när den syns
    correctSpeed: ecs.f32,       // lerp-faktor per frame (0–1). Lägre = mjukare/långsammare
    deadband:     ecs.f32,       // ignorera avvikelser mindre än detta (world-enheter)
    maxJump:      ecs.f32,       // hoppa inte mot mål längre bort än detta (0 = ingen gräns)
  },
  schemaDefaults: {
    targetName:   'fram',
    framesToLock: 6,
    relock:       false,
    correct:      true,
    correctSpeed: 0.12,
    deadband:     0.02,
    maxJump:      2.0,
  },
  data: {},

  add: (world, component) => {
    lockedMap.set(component.eid, false)
    hitsMap.set(component.eid, 0)
  },

  tick: (world, component) => {
    const eid = component.eid
    const s   = component.schema

    const locked = lockedMap.get(eid) ?? false

    // Exponera kalibrerings-API (flytta/rotera/skala live) första gången
    // three.js-objektet finns. Justerar objektets LOKALA transform = exakt de
    // värden som skrivs in i Studios Position/Rotation/Scale.
    const obj0  = world.three.entityToObject.get(eid)
    const THREE = (window as any).THREE
    if (obj0 && THREE && !(window as any)._anchorApi) {
      const w = world
      const rad = (d: number) => d * Math.PI / 180

      // Uppdatera matrisen explicit (manual matrix-läge renderar annars inte ändringen)
      const refresh = () => {
        if (typeof obj0.updateMatrix === 'function') obj0.updateMatrix()
        w.three.notifyChanged(obj0)
      }
      // Kamera-relativa axlar (höger/upp/fram) — så "vänster" alltid är vänster i din vy
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
        // Flytta i kameraplanet (höger/upp) och på djupet (fram/bak)
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
          // Efter låsning ligger objektet i world space. Räkna om till markör-
          // relativ offset (markör⁻¹ · objektWorld) så besökarna får rätt.
          if (THREE && markerMat) {
            obj0.updateWorldMatrix(true, false)
            const rel = markerMat.clone().invert().multiply(obj0.matrixWorld)
            const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
            rel.decompose(p, q, sc)
            const e = new THREE.Euler().setFromQuaternion(q, 'XYZ')
            return {pos: [n(p.x), n(p.y), n(p.z)], rot: [d(e.x), d(e.y), d(e.z)], scale: n(sc.x)}
          }
          // Före låsning: objektets lokala transform (relativt bildmålet)
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
    // Storlek baseras på en mindre faktor av modellens största mått (inte
    // bounding-sphere-radien som för en hög figur blir enorm). Centreras på
    // bounding box-mitten.
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

    // (Sparad kalibrering appliceras vid LÅSNING längre ner — inte här —
    //  så att modell-laddningen inte hinner skriva över den.)

    // Är bildmålet just nu spårat? (sätts av pipeline-lyssnaren i index.html)
    // Om targetName är tomt: lås på vilket bildmål som helst som hittas.
    const state = (window as any)._imageTargetState || {}
    const name  = (s.targetName || '').trim()
    const found = name
      ? !!state[name]
      : Object.keys(state).some(k => state[k] === true)

    const threshold = Math.max(1, Math.floor(s.framesToLock))
    const status: any = {
      found,
      hits:   hitsMap.get(eid) ?? 0,
      locked,
      target: name || '(any)',
      threshold,
      err: (window as any)._anchorStatus?.err,
    }
    ;(window as any)._anchorStatus = status

    // Admin/kalibrering låser också (så man kan titta bort från markören och
    // nudga fritt) — skillnaden är att man där får nudga + spara.
    if ((window as any)._calibrateMode) status.target = 'KALIBRERING'

    if (locked) {
      // Hybrid-korrigering: när markören syns, glid objektet mot den pose den
      // hade vid lås (markörWorld · frusen offset). Mellan syningar håller SLAM
      // ställningen; när markören skymtar nollas driften — mjukt, aldrig i hopp.
      // Inte i kalibrerings-/admin-läge — där nudgar man manuellt och korrigeringen
      // skulle skriva över de egna justeringarna varje frame markören syns.
      const calibrating = !!(window as any)._calibrateMode
      if (s.correct && found && !calibrating && THREE && obj0) {
        const markerObj = markerObjMap.get(eid)
        const offset    = lockOffsetMap.get(eid)
        if (markerObj && offset) {
          try {
            if (typeof markerObj.updateWorldMatrix === 'function') markerObj.updateWorldMatrix(true, false)
            const targetWorld = markerObj.matrixWorld.clone().multiply(offset)

            // Mål i world space (behåll objektets skala — korrigera bara läge/rotation)
            const tPos = new THREE.Vector3(), tQuat = new THREE.Quaternion(), tScl = new THREE.Vector3()
            targetWorld.decompose(tPos, tQuat, tScl)

            const curPos = new THREE.Vector3();  obj0.getWorldPosition(curPos)
            const curQuat = new THREE.Quaternion(); obj0.getWorldQuaternion(curQuat)

            const dist = curPos.distanceTo(tPos)
            const maxJump = s.maxJump || 0
            // Dödband: ignorera litet brus. Tak: chasa inte en uppenbart felaktig
            // markör-detektion långt bort (då är markörtracking bara skräp just då).
            if (dist >= (s.deadband || 0) && (maxJump <= 0 || dist <= maxJump)) {
              const a = Math.min(Math.max(s.correctSpeed || 0.12, 0), 1)
              const nPos  = curPos.clone().lerp(tPos, a)
              const nQuat = curQuat.clone().slerp(tQuat, a)

              // Skriv tillbaka i objektets LOKALA rum (objektet är nu barn till scenen)
              const par = obj0.parent
              const keepScale = new THREE.Vector3(); obj0.getWorldScale(keepScale)
              const m = new THREE.Matrix4().compose(nPos, nQuat, keepScale)
              if (par) {
                if (typeof par.updateWorldMatrix === 'function') par.updateWorldMatrix(true, false)
                m.premultiply(par.matrixWorld.clone().invert())
              }
              const pl = new THREE.Vector3(), ql = new THREE.Quaternion(), sl = new THREE.Vector3()
              m.decompose(pl, ql, sl)
              obj0.position.copy(pl); obj0.quaternion.copy(ql); obj0.scale.copy(sl)
              if (typeof obj0.updateMatrix === 'function') obj0.updateMatrix()
              if (typeof obj0.updateWorldMatrix === 'function') obj0.updateWorldMatrix(true, false)
              world.three.notifyChanged(obj0)
            }
          } catch (e) { /* noop — håll kvar SLAM-posen om korrigering fallerar */ }
        }
      }
      if (!s.relock) return
    }

    if (!found) {
      hitsMap.set(eid, 0)
      return
    }

    // Räkna stabila träffar i rad innan vi fryser
    const hits = (hitsMap.get(eid) ?? 0) + 1
    hitsMap.set(eid, hits)
    status.hits = hits
    if (hits < threshold) return

    // Frys i world space genom att reparenta three.js-objektet direkt med
    // scene.attach() — det bevarar world-transformen (position/rotation/skala)
    // och lossar objektet från bildmålet i three.js-grafen, så bildmålets
    // rörelser inte längre påverkar det. SLAM håller det sedan stadigt.
    const obj   = world.three.entityToObject.get(eid)
    const scene = world.three.scene
    if (!obj)   { status.err = 'inget 3d-objekt'; return }
    if (!scene) { status.err = 'ingen scen';      return }
    try {
      const THREE = (window as any).THREE
      const parent = obj.parent

      // Applicera sparad kalibrering som LOKAL transform precis innan frysning.
      // Görs här (inte kontinuerligt) så att modell-laddning inte hinner skriva
      // över den. obj.world blir då förälder · sparad-offset → fryses rätt.
      const saved = (window as any)._savedCalibration
      if (saved) {
        const rad = (d: number) => d * Math.PI / 180
        if (Array.isArray(saved.pos)) obj.position.set(saved.pos[0], saved.pos[1], saved.pos[2])
        if (Array.isArray(saved.rot)) {
          // Bygg quaternion från EXPLICIT XYZ-Euler (samma ordning som admin
          // sparar med) → oberoende av objektets rotation.order.
          const eul = new THREE.Euler(rad(saved.rot[0]), rad(saved.rot[1]), rad(saved.rot[2]), 'XYZ')
          obj.quaternion.setFromEuler(eul)
        }
        if (typeof saved.scale === 'number') obj.scale.setScalar(saved.scale)
        // 8th Wall kör manuellt matris-läge → måste tvinga matris-uppdatering,
        // annars "fastnar" inte de satta värdena i objektets matris.
        if (typeof obj.updateMatrix === 'function') obj.updateMatrix()
        if (typeof obj.updateWorldMatrix === 'function') obj.updateWorldMatrix(true, false)
      }

      // Spara markörens (förälderns) world-pose vid låsning — används för att
      // räkna om nudge-justeringar till markör-relativ offset vid SPARA.
      if (THREE && parent) {
        if (typeof parent.updateWorldMatrix === 'function') parent.updateWorldMatrix(true, false)
        markerMatMap.set(eid, parent.matrixWorld.clone())

        // Hybrid: spara markör-objektet (8th Wall uppdaterar dess matris live när
        // markören trackas) + en FRUSEN offset markör⁻¹ · objektWorld. Efter lås
        // räknas mål-posen varje frame som aktuellMarkörWorld · offset, och objektet
        // glider dit → SLAM-drift korrigeras bort utan hopp. Måste beräknas FÖRE
        // scene.attach (medan obj fortfarande är barn till markören).
        if (typeof obj.updateWorldMatrix === 'function') obj.updateWorldMatrix(true, false)
        const offset = parent.matrixWorld.clone().invert().multiply(obj.matrixWorld)
        lockOffsetMap.set(eid, offset)
        markerObjMap.set(eid, parent)
      }

      if (typeof (scene as any).attach === 'function') {
        ;(scene as any).attach(obj)        // bevarar world-transform
      } else if (obj.parent) {
        obj.parent.remove(obj)
        scene.add(obj)
      }
      obj.visible = true
      world.three.notifyChanged(obj)

      lockedMap.set(eid, true)
      hitsMap.set(eid, 0)
      status.locked = true
      status.err = undefined
      console.log('[world-anchor] låst i world space')
    } catch (err: any) {
      status.err = String((err && err.message) || err)
      console.warn('[world-anchor] kunde inte låsa:', err)
    }
  },

  remove: (world, component) => {
    lockedMap.delete(component.eid)
    hitsMap.delete(component.eid)
    appliedMap.delete(component.eid)
    markerMatMap.delete(component.eid)
    markerObjMap.delete(component.eid)
    lockOffsetMap.delete(component.eid)
  },
})
