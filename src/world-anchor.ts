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

const lockedMap = new Map<bigint, boolean>()
const hitsMap   = new Map<bigint, number>()

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

    // Frys i world space: läs nuvarande world-transform (bildmålet har redan
    // placerat oss med rätt offset) och lossa från bildmålet.
    const e = world.eidToEntity.get(eid)
    if (!e) { status.err = 'ingen entity'; return }
    try {
      const wp = e.getWorldPosition()
      const wq = e.getWorldQuaternion()
      const p  = {x: wp.x, y: wp.y, z: wp.z}
      const q  = {x: wq.x, y: wq.y, z: wq.z, w: wq.w}

      e.setParent(null)            // lossa till scenens rot (world space)
      e.setWorldPosition(p)
      e.setWorldQuaternion(q)
      if (typeof e.show === 'function') e.show()

      const obj = world.three.entityToObject.get(eid)
      if (obj) world.three.notifyChanged(obj)

      lockedMap.set(eid, true)
      hitsMap.set(eid, 0)
      status.locked = true
      status.err = undefined
      console.log('[world-anchor] låst i world space mot', s.targetName)
    } catch (err: any) {
      status.err = String((err && err.message) || err)
      console.warn('[world-anchor] kunde inte låsa:', err)
    }
  },

  remove: (world, component) => {
    lockedMap.delete(component.eid)
    hitsMap.delete(component.eid)
  },
})
