import { Router } from 'express'
import { query } from '../db/index.js'
import { wsEvents } from '../services/websocket.js'

const router = Router()

// GET /conversations — Lista todas as conversas
router.get('/', async (req, res) => {
  const { rows } = await query(`
    SELECT
      c.id, c.phone, c.area, c.status, c.last_message, c.last_time,
      cl.name AS client_name,
      SUBSTRING(cl.name FROM '^(\\w)') ||
        COALESCE(SUBSTRING(cl.name FROM '\\s(\\w)'), '') AS initials,
      EXISTS(
        SELECT 1 FROM alerts a WHERE a.conversation_id = c.id AND a.status = 'pending'
      ) AS has_alert
    FROM conversations c
    LEFT JOIN clients cl ON cl.id = c.client_id
    ORDER BY c.last_time DESC
  `)
  res.json(rows)
})

// GET /conversations/:id — Conversa + mensagens
router.get('/:id', async (req, res) => {
  const { id } = req.params

  const convRes = await query(`
    SELECT c.*, cl.name AS client_name
    FROM conversations c
    LEFT JOIN clients cl ON cl.id = c.client_id
    WHERE c.id = $1
  `, [id])

  if (!convRes.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' })

  const messagesRes = await query(`
    SELECT * FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC
  `, [id])

  res.json({ ...convRes.rows[0], messages: messagesRes.rows })
})

// PATCH /conversations/:id/status — Assumir ou encerrar conversa
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params
  const { status } = req.body

  const allowed = ['ia_ativa', 'assumido', 'encerrado']
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Status inválido' })

  const { rows } = await query(`
    UPDATE conversations SET status = $1, updated_at = NOW()
    WHERE id = $2 RETURNING *
  `, [status, id])

  if (!rows.length) return res.status(404).json({ error: 'Conversa não encontrada' })

  wsEvents.conversationUpdated(rows[0])
  res.json(rows[0])
})

// POST /conversations/:id/messages — Advogado envia mensagem manual
router.post('/:id/messages', async (req, res) => {
  const { id } = req.params
  const { text } = req.body

  if (!text?.trim()) return res.status(400).json({ error: 'Texto obrigatório' })

  // Busca conversa para pegar o phone
  const convRes = await query(`SELECT * FROM conversations WHERE id = $1`, [id])
  if (!convRes.rows.length) return res.status(404).json({ error: 'Conversa não encontrada' })
  const conv = convRes.rows[0]

  // Envia pelo WhatsApp
  let waOutId = null
  try {
    const { sendTextMessage } = await import('../services/whatsapp.js')
    waOutId = await sendTextMessage(conv.phone, text)
  } catch (err) {
    console.error('[Conversations] Erro ao enviar mensagem manual:', err.message)
    return res.status(502).json({ error: 'Falha ao enviar mensagem via WhatsApp' })
  }

  const { rows } = await query(`
    INSERT INTO messages (conversation_id, phone, direction, text, sent_by, status, wa_message_id)
    VALUES ($1, $2, 'out', $3, 'humano', 'sent', $4)
    RETURNING *
  `, [id, conv.phone, text, waOutId])

  wsEvents.aiReplied(id, rows[0])
  res.status(201).json(rows[0])
})

export default router
