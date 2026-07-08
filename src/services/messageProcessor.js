import { query } from '../db/index.js'
import { generateReply, getWelcomeMessage } from './ai.js'
import { sendTextMessage, markAsRead } from './whatsapp.js'
import { detectSensitive } from './sensitiveDetector.js'
import { wsEvents } from './websocket.js'

/**
 * Pipeline principal de processamento de mensagens
 *
 * Fluxo:
 *   1. Recebe mensagem do webhook
 *   2. Garante que o cliente e a conversa existam no banco
 *   3. Salva a mensagem de entrada
 *   4. Busca histórico da conversa
 *   5. Gera resposta via IA
 *   6. Detecta conteúdo sensível
 *   7a. Se sensível → cria alerta, NÃO envia
 *   7b. Se ok → envia via WhatsApp e salva
 *   8. Notifica o dashboard via WebSocket
 */
export async function processIncomingMessage({ waMessageId, phone, name, text, timestamp }) {
  console.log(`[PROCESSOR] Mensagem de ${phone}: "${text.slice(0, 60)}..."`)

  // ── 1. Upsert do cliente ────────────────────────────────────────────────────
  const clientRes = await query(`
    INSERT INTO clients (name, phone)
    VALUES ($1, $2)
    ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
    RETURNING *
  `, [name, phone])
  const client = clientRes.rows[0]

  // ── 2. Upsert da conversa ───────────────────────────────────────────────────
  const convRes = await query(`
    INSERT INTO conversations (client_id, phone, last_message, last_time)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (phone) DO UPDATE
      SET last_message = EXCLUDED.last_message,
          last_time    = EXCLUDED.last_time,
          updated_at   = NOW()
    WHERE conversations.status != 'encerrado'
    RETURNING *
  `, [client.id, phone, text, timestamp])

  // Pode retornar vazio se a conversa estava encerrada
  let conversation = convRes.rows[0]
  if (!conversation) {
    // Reabre ou busca a conversa encerrada
    const existing = await query(`SELECT * FROM conversations WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`, [phone])
    conversation = existing.rows[0]
  }

  if (!conversation) {
    console.error('[PROCESSOR] Não foi possível criar/encontrar conversa para', phone)
    return
  }

  // ── 3. Salva mensagem de entrada ────────────────────────────────────────────
  const inMsgRes = await query(`
    INSERT INTO messages (conversation_id, phone, direction, text, sent_by, status, wa_message_id)
    VALUES ($1, $2, 'in', $3, 'cliente', 'sent', $4)
    RETURNING *
  `, [conversation.id, phone, text, waMessageId])
  const inMessage = inMsgRes.rows[0]

  // Marca como lida na Meta API (não bloqueia)
  markAsRead(waMessageId).catch(() => {})

  // Notifica dashboard
  wsEvents.newMessage(conversation, inMessage)

  // ── 4. Verifica se conversa está em modo manual ─────────────────────────────
  if (conversation.status === 'assumido') {
    console.log('[PROCESSOR] Conversa assumida pelo advogado — IA inativa')
    return
  }

  // ── 5. Busca histórico para contexto da IA ──────────────────────────────────
  const histRes = await query(`
    SELECT direction, text FROM messages
    WHERE conversation_id = $1
    ORDER BY created_at ASC
    LIMIT 20
  `, [conversation.id])

  const history = histRes.rows.map(m => ({
    role: m.direction === 'in' ? 'user' : 'assistant',
    content: m.text,
  }))

  // ── 6. Mensagem de boas-vindas na primeira interação ────────────────────────
  const isFirstMessage = histRes.rows.filter(m => m.direction === 'in').length === 1
  let replyText
  let detectedArea = conversation.area

  if (isFirstMessage) {
    replyText = getWelcomeMessage()
  } else {
    // ── 7. Gera resposta via IA ───────────────────────────────────────────────
    try {
      const result = await generateReply(text, history.slice(0, -1), conversation.area)
      replyText    = result.reply
      detectedArea = result.detectedArea
    } catch (err) {
      console.error('[PROCESSOR] Erro na IA:', err.message)
      replyText = 'Desculpe, estou com uma instabilidade no momento. O Dr. Rafael entrará em contato em breve.'
    }
  }

  // ── 8. Atualiza área detectada ──────────────────────────────────────────────
  if (detectedArea && detectedArea !== conversation.area) {
    await query(`UPDATE conversations SET area = $1, updated_at = NOW() WHERE id = $2`, [detectedArea, conversation.id])
    await query(`UPDATE clients SET area = $1, updated_at = NOW() WHERE id = $2`, [detectedArea, client.id])
    conversation.area = detectedArea
  }

  // ── 9. Detecta conteúdo sensível na resposta ────────────────────────────────
  const detection = detectSensitive(replyText)

  if (detection.flagged) {
    // ── 9a. Cria alerta — NÃO envia a mensagem ─────────────────────────────
    console.log(`[PROCESSOR] Conteúdo sensível detectado (${detection.type}) — criando alerta`)

    const msgRes = await query(`
      INSERT INTO messages (conversation_id, phone, direction, text, sent_by, status, alert_reason)
      VALUES ($1, $2, 'out', $3, 'ia', 'pending_review', $4)
      RETURNING *
    `, [conversation.id, phone, replyText, detection.type])
    const pendingMsg = msgRes.rows[0]

    const alertRes = await query(`
      INSERT INTO alerts (conversation_id, message_id, type, reason, draft)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [conversation.id, pendingMsg.id, detection.type, detection.reason, replyText])
    const alert = { ...alertRes.rows[0], clientName: name, area: conversation.area }

    // Notifica dashboard
    wsEvents.alertCreated(alert)
    wsEvents.conversationUpdated({ ...conversation, hasAlert: true })

  } else {
    // ── 9b. Envia automaticamente ────────────────────────────────────────────
    let waOutId = null
    try {
      waOutId = await sendTextMessage(phone, replyText)
      console.log(`[PROCESSOR] Mensagem enviada para ${phone} | wa_id: ${waOutId}`)
    } catch (err) {
      console.error('[PROCESSOR] Erro ao enviar para WhatsApp:', err.message)
    }

    const outMsgRes = await query(`
      INSERT INTO messages (conversation_id, phone, direction, text, sent_by, status, wa_message_id)
      VALUES ($1, $2, 'out', $3, 'ia', 'sent', $4)
      RETURNING *
    `, [conversation.id, phone, replyText, waOutId])
    const outMessage = outMsgRes.rows[0]

    // Atualiza última mensagem da conversa
    await query(`
      UPDATE conversations SET last_message = $1, last_time = NOW(), updated_at = NOW() WHERE id = $2
    `, [replyText.slice(0, 120), conversation.id])

    // Notifica dashboard
    wsEvents.aiReplied(conversation.id, outMessage)
  }
}
