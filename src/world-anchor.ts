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

ecs.registerComponent({
  name: 'world-anchor',

  schema: {
    targetName:   ecs.string,    // namnet på bildmålet att låsa mot
    framesToLock: ecs.f32,       // antal stabila träffar innan frysning
    relock:       ecs.boolean,   // true = omkalibrera vid varje ny upptäckt
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
  },

  tick: (world, component) => {
    const eid = component.eid
    const s   = component.schema

    const locked = lockedMap.get(eid) ?? false

    // Exponera kalibrerings-API (flytta/rotera/skala live) första gången
    // three.js-objektet finns. Justerar objektets LOKALA transform = exakt de
    // värden som skrivs in i Studios Position/Rotation/Scale.
    const obj0 = world.three.entityToObject.get(eid)
    if (obj0 && !(window as any)._anchorApi) {
      const w = world
      const rad = (d: number) => d * Math.PI / 180
      ;(window as any)._anchorApi = {
        nudgePos: (dx: number, dy: number, dz: number) => {
          obj0.position.x += dx; obj0.position.y += dy; obj0.position.z += dz
          w.three.notifyChanged(obj0)
        },
        nudgeRot: (ax: string, deg: number) => {
          if (ax === 'x') obj0.rotateX(rad(deg))
          else if (ax === 'y') obj0.rotateY(rad(deg))
          else obj0.rotateZ(rad(deg))
          w.three.notifyChanged(obj0)
        },
        scaleBy: (f: number) => {
          obj0.scale.multiplyScalar(f)
          w.three.notifyChanged(obj0)
        },
        read: () => {
          const d = (r: number) => Math.round(r * 180 / Math.PI * 10) / 10
          const n = (v: number) => Math.round(v * 1000) / 1000
          const THREE = (window as any).THREE
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

    // Applicera sparad kalibrering (från servern) en gång när objektet finns.
    // Sätter den LOKALA transformen = exakt det admin sparat.
    const saved = (window as any)._savedCalibration
    if (obj0 && saved && !appliedMap.get(eid)) {
      try {
        if (Array.isArray(saved.pos))   obj0.position.set(saved.pos[0], saved.pos[1], saved.pos[2])
        if (Array.isArray(saved.rot)) {
          const r = (d: number) => d * Math.PI / 180
          obj0.rotation.set(r(saved.rot[0]), r(saved.rot[1]), r(saved.rot[2]))
        }
        if (typeof saved.scale === 'number') obj0.scale.setScalar(saved.scale)
        world.three.notifyChanged(obj0)
        appliedMap.set(eid, true)
        console.log('[world-anchor] applicerade sparad kalibrering')
      } catch (e) { /* noop */ }
    }

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

    if (locked && !s.relock) return

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
      // Spara markörens (förälderns) world-pose vid låsning — används för att
      // räkna om nudge-justeringar till markör-relativ offset vid SPARA.
      const THREE = (window as any).THREE
      const parent = obj.parent
      if (THREE && parent) {
        if (typeof parent.updateWorldMatrix === 'function') parent.updateWorldMatrix(true, false)
        markerMatMap.set(eid, parent.matrixWorld.clone())
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
  },
})
