import { Router } from 'express'
import { query } from '../db/index.js'
import { wsEvents } from '../services/websocket.js'
import { sendTextMessage } from '../services/whatsapp.js'

const router = Router()

// ─── ALERTS ───────────────────────────────────────────────────────────────────

router.get('/alerts', async (req, res) => {
  const { rows } = await query(`
    SELECT
      a.*,
      cl.name AS client_name,
      co.area,
      co.phone,
      SUBSTRING(cl.name FROM '^(\\w)') ||
        COALESCE(SUBSTRING(cl.name FROM '\\s(\\w)'), '') AS initials
    FROM alerts a
    JOIN conversations co ON co.id = a.conversation_id
    JOIN clients cl ON cl.id = co.client_id
    WHERE a.status = 'pending'
    ORDER BY a.created_at DESC
  `)
  res.json(rows)
})

// Aprovar e enviar
router.post('/alerts/:id/approve', async (req, res) => {
  const { id } = req.params
  const { draft } = req.body // Permite edição antes de aprovar

  const alertRes = await query(`SELECT * FROM alerts WHERE id = $1`, [id])
  if (!alertRes.rows.length) return res.status(404).json({ error: 'Alerta não encontrado' })
  const alert = alertRes.rows[0]

  const textToSend = draft?.trim() || alert.draft
  const convRes = await query(`SELECT * FROM conversations WHERE id = $1`, [alert.conversation_id])
  const conv = convRes.rows[0]

  // Envia via WhatsApp
  let waOutId = null
  try {
    waOutId = await sendTextMessage(conv.phone, textToSend)
  } catch (err) {
    return res.status(502).json({ error: 'Falha ao enviar mensagem via WhatsApp' })
  }

  // Atualiza alerta e mensagem
  await query(`UPDATE alerts SET status = 'approved', resolved_at = NOW() WHERE id = $1`, [id])
  await query(`UPDATE messages SET status = 'approved', text = $1, wa_message_id = $2 WHERE id = $3`,
    [textToSend, waOutId, alert.message_id])

  wsEvents.alertResolved(id, 'approved')
  res.json({ ok: true })
})

// Descartar
router.post('/alerts/:id/discard', async (req, res) => {
  const { id } = req.params
  await query(`UPDATE alerts SET status = 'discarded', resolved_at = NOW() WHERE id = $1`, [id])
  await query(`UPDATE messages SET status = 'discarded' WHERE id = (SELECT message_id FROM alerts WHERE id = $1)`, [id])
  wsEvents.alertResolved(id, 'discarded')
  res.json({ ok: true })
})

// ─── CLIENTS ──────────────────────────────────────────────────────────────────

router.get('/clients', async (req, res) => {
  const { rows } = await query(`
    SELECT *,
      SUBSTRING(name FROM '^(\\w)') ||
        COALESCE(SUBSTRING(name FROM '\\s(\\w)'), '') AS initials
    FROM clients
    ORDER BY created_at DESC
  `)
  res.json(rows)
})

router.patch('/clients/:id/stage', async (req, res) => {
  const { id } = req.params
  const { stage } = req.body
  const allowed = ['lead', 'consulta', 'proposta', 'fechado']
  if (!allowed.includes(stage)) return res.status(400).json({ error: 'Stage inválido' })
  const { rows } = await query(`UPDATE clients SET stage = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [stage, id])
  res.json(rows[0])
})

// ─── AUTOMATIONS ──────────────────────────────────────────────────────────────

router.get('/automations', async (req, res) => {
  const { rows } = await query(`SELECT * FROM automations ORDER BY created_at`)
  res.json(rows)
})

router.patch('/automations/:id', async (req, res) => {
  const { id } = req.params
  const { on } = req.body
  const { rows } = await query(`UPDATE automations SET enabled = $1, updated_at = NOW() WHERE id = $2 RETURNING *`, [on, id])
  res.json(rows[0])
})

// ─── STATS ────────────────────────────────────────────────────────────────────

router.get('/stats', async (req, res) => {
  const [activeConvs, pendingAlerts, totalClients, msgStats, areaBreakdown] = await Promise.all([
    query(`SELECT COUNT(*) FROM conversations WHERE status = 'ia_ativa'`),
    query(`SELECT COUNT(*) FROM alerts WHERE status = 'pending'`),
    query(`SELECT COUNT(*) FROM clients`),
    query(`
      SELECT
        COUNT(*) FILTER (WHERE direction = 'out' AND sent_by = 'ia' AND status = 'sent') AS ai_sent,
        COUNT(*) FILTER (WHERE direction = 'out') AS total_out
      FROM messages
      WHERE created_at > NOW() - INTERVAL '24 hours'
    `),
    query(`
      SELECT area, COUNT(*) AS total
      FROM conversations
      WHERE area IS NOT NULL AND created_at > NOW() - INTERVAL '7 days'
      GROUP BY area
    `),
  ])

  const aiSent  = Number(msgStats.rows[0].ai_sent)
  const totalOut = Number(msgStats.rows[0].total_out)
  const aiRate  = totalOut > 0 ? Math.round((aiSent / totalOut) * 100) : 0

  const areaTotal = areaBreakdown.rows.reduce((s, r) => s + Number(r.total), 0)
  const areaData  = areaBreakdown.rows.map(r => ({
    area : r.area,
    pct  : areaTotal > 0 ? Math.round((r.total / areaTotal) * 100) : 0,
    color: { consumidor: '#378ADD', previdenciario: '#7F77DD', bancario: '#1D9E75' }[r.area] ?? '#9ca3af',
  }))

  res.json({
    activeConversations: Number(activeConvs.rows[0].count),
    pendingAlerts      : Number(pendingAlerts.rows[0].count),
    totalClients       : Number(totalClients.rows[0].count),
    aiRate,
    areaBreakdown      : areaData,
  })
})

export default router

// ─── WHATSAPP STATUS + QR CODE ────────────────────────────────────────────────
import { getInstanceStatus, getQRCode } from '../services/whatsapp.js'

router.get('/whatsapp/status', async (req, res) => {
  const status = await getInstanceStatus()
  res.json({ status })
})

router.get('/whatsapp/qrcode', async (req, res) => {
  try {
    const qr = await getQRCode()
    if (!qr) return res.status(404).json({ error: 'QR Code não disponível. Instância pode já estar conectada.' })
    res.json({ qrcode: qr })
  } catch (err) {
    res.status(502).json({ error: err.message })
  }
})
