// ── Serverless-funktion: spara/hämta AR-kalibrering ─────────────────────────
// GET  /api/calibration?id=eld         → { calibration: {pos,rot,scale} | null }
// POST /api/calibration  { id, passcode, pos, rot, scale }  → { ok: true }
//
// Lagring: Vercel KV / Upstash Redis via REST. Kräver miljövariablerna
//   KV_REST_API_URL, KV_REST_API_TOKEN   (skapas när du kopplar KV i Vercel)
//   ADMIN_PASSCODE                       (sätter du själv — admin-lösenordet)

const KV_URL   = process.env.KV_REST_API_URL
const KV_TOKEN = process.env.KV_REST_API_TOKEN
const PASSCODE = process.env.ADMIN_PASSCODE

async function kv(command) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: {Authorization: `Bearer ${KV_TOKEN}`},
    body: JSON.stringify(command),
  })
  const j = await r.json()
  return j.result
}

const cleanId = id => String(id || 'default').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'default'

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (!KV_URL || !KV_TOKEN) {
    return res.status(500).json({error: 'KV ej konfigurerad (saknar KV_REST_API_URL/TOKEN)'})
  }

  try {
    if (req.method === 'GET') {
      const id  = cleanId(req.query && req.query.id)
      const val = await kv(['GET', `calib:${id}`])
      res.setHeader('Cache-Control', 'no-store')
      return res.status(200).json({calibration: val ? JSON.parse(val) : null})
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const {id, passcode, pos, rot, scale} = body

      if (!PASSCODE) return res.status(500).json({error: 'ADMIN_PASSCODE ej satt på servern'})
      if (passcode !== PASSCODE) return res.status(401).json({error: 'Fel lösenord'})

      if (!Array.isArray(pos) || !Array.isArray(rot) || typeof scale !== 'number') {
        return res.status(400).json({error: 'Ogiltig data'})
      }

      const data = JSON.stringify({pos, rot, scale, savedAt: Date.now()})
      await kv(['SET', `calib:${cleanId(id)}`, data])
      return res.status(200).json({ok: true})
    }

    return res.status(405).json({error: 'Method not allowed'})
  } catch (e) {
    return res.status(500).json({error: String((e && e.message) || e)})
  }
}
