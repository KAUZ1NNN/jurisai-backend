import cron from 'node-cron'
import { query } from '../db/index.js'
import { sendTextMessage } from './whatsapp.js'

// ─── HELPERS ─────────────────────────────────────────────────────────────────
async function isEnabled(key) {
  const { rows } = await query(`SELECT enabled FROM automations WHERE key = $1`, [key])
  return rows[0]?.enabled ?? false
}

async function logDispatch(conversationId, text, trigger) {
  await query(`
    INSERT INTO messages (conversation_id, phone, direction, text, sent_by, status)
    SELECT $1, phone, 'out', $2, 'automacao', 'sent'
    FROM conversations WHERE id = $1
  `, [conversationId, text])
  console.log(`[CRON] Disparo "${trigger}" → conversa ${conversationId}`)
}

// ─── AUTOMAÇÃO 1 — Follow-up 48h ────────────────────────────────────────────
// Roda a cada hora — busca conversas sem resposta do cliente por 48h
async function followUp48h() {
  if (!await isEnabled('followup_48h')) return

  const { rows } = await query(`
    SELECT c.id, c.phone, cl.name
    FROM conversations c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.status = 'ia_ativa'
      AND c.last_time < NOW() - INTERVAL '48 hours'
      AND NOT EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sent_by = 'automacao'
          AND m.text LIKE '%aguardando%'
          AND m.created_at > NOW() - INTERVAL '48 hours'
      )
  `)

  for (const conv of rows) {
    const msg = `Olá, ${conv.name.split(' ')[0]}! 👋 Só passando para lembrá-lo(a) que o escritório do Dr. Rafael Costa ainda está disponível para ajudar. Pode nos chamar a qualquer momento!`
    try {
      await sendTextMessage(conv.phone, msg)
      await logDispatch(conv.id, msg, 'followup_48h')
    } catch (err) {
      console.error(`[CRON] Erro no follow-up para ${conv.phone}:`, err.message)
    }
  }

  if (rows.length) console.log(`[CRON] follow-up 48h: ${rows.length} disparo(s)`)
}

// ─── AUTOMAÇÃO 2 — Pesquisa de satisfação ───────────────────────────────────
// Roda a cada hora — envia survey 30min após conversa encerrada
async function satisfactionSurvey() {
  if (!await isEnabled('satisfaction')) return

  const { rows } = await query(`
    SELECT c.id, c.phone, cl.name
    FROM conversations c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.status = 'encerrado'
      AND c.updated_at BETWEEN NOW() - INTERVAL '90 minutes' AND NOW() - INTERVAL '30 minutes'
      AND NOT EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sent_by = 'automacao'
          AND m.text LIKE '%satisfação%'
      )
  `)

  for (const conv of rows) {
    const msg = `Olá, ${conv.name.split(' ')[0]}! Esperamos ter ajudado. 😊\n\nPoderia avaliar nosso atendimento de 1 a 5?\n\n⭐ 1 - Ruim\n⭐⭐ 2 - Regular\n⭐⭐⭐ 3 - Bom\n⭐⭐⭐⭐ 4 - Muito bom\n⭐⭐⭐⭐⭐ 5 - Excelente\n\nSua opinião é muito importante para nós!`
    try {
      await sendTextMessage(conv.phone, msg)
      await logDispatch(conv.id, msg, 'satisfaction')
    } catch (err) {
      console.error(`[CRON] Erro no survey para ${conv.phone}:`, err.message)
    }
  }

  if (rows.length) console.log(`[CRON] satisfaction: ${rows.length} disparo(s)`)
}

// ─── AUTOMAÇÃO 3 — Reengajamento de lead frio ───────────────────────────────
// Roda uma vez por dia às 09:00 — leads sem interação há 7 dias
async function reengagement() {
  if (!await isEnabled('reengagement')) return

  const { rows } = await query(`
    SELECT c.id, c.phone, cl.name, c.area
    FROM conversations c
    JOIN clients cl ON cl.id = c.client_id
    WHERE c.status = 'ia_ativa'
      AND c.last_time < NOW() - INTERVAL '7 days'
      AND NOT EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sent_by = 'automacao'
          AND m.text LIKE '%retomar%'
          AND m.created_at > NOW() - INTERVAL '7 days'
      )
  `)

  const areaMsg = {
    consumidor:     'Se tiver alguma questão sobre direito do consumidor, negativação indevida ou cobranças abusivas',
    previdenciario: 'Se ainda precisar de ajuda com INSS, aposentadoria ou benefícios',
    bancario:       'Se tiver dúvidas sobre juros abusivos, tarifas indevidas ou revisão de contrato bancário',
  }

  for (const conv of rows) {
    const area = areaMsg[conv.area] ?? 'Se precisar de assistência jurídica'
    const msg = `Olá, ${conv.name.split(' ')[0]}! 👋 ${area}, o escritório do Dr. Rafael Costa está à sua disposição. Podemos retomar o atendimento quando quiser!`
    try {
      await sendTextMessage(conv.phone, msg)
      await logDispatch(conv.id, msg, 'reengagement')
    } catch (err) {
      console.error(`[CRON] Erro no reengajamento para ${conv.phone}:`, err.message)
    }
  }

  if (rows.length) console.log(`[CRON] reengagement: ${rows.length} disparo(s)`)
}

// ─── LEMBRETE DE DOCUMENTOS PENDENTES ───────────────────────────────────────
// Roda diariamente às 10:00 — alertas de documento aprovados há mais de 24h sem resposta
async function docsReminder() {
  if (!await isEnabled('docs_reminder')) return

  const { rows } = await query(`
    SELECT DISTINCT c.id, c.phone, cl.name
    FROM alerts a
    JOIN conversations c ON c.id = a.conversation_id
    JOIN clients cl ON cl.id = c.client_id
    WHERE a.type = 'document'
      AND a.status = 'approved'
      AND a.resolved_at < NOW() - INTERVAL '24 hours'
      AND c.status = 'ia_ativa'
      AND NOT EXISTS (
        SELECT 1 FROM messages m
        WHERE m.conversation_id = c.id
          AND m.sent_by = 'automacao'
          AND m.text LIKE '%documento%pendente%'
          AND m.created_at > NOW() - INTERVAL '24 hours'
      )
  `)

  for (const conv of rows) {
    const msg = `Olá, ${conv.name.split(' ')[0]}! Lembrando que há documentos pendentes para o andamento do seu caso. Qualquer dúvida, entre em contato conosco! 📄`
    try {
      await sendTextMessage(conv.phone, msg)
      await logDispatch(conv.id, msg, 'docs_reminder')
    } catch (err) {
      console.error(`[CRON] Erro no docs reminder para ${conv.phone}:`, err.message)
    }
  }
}

// ─── INICIALIZADOR ────────────────────────────────────────────────────────────
export function initCronJobs() {
  // Follow-up: a cada hora
  cron.schedule('0 * * * *', () => {
    followUp48h().catch(e => console.error('[CRON] followUp48h erro:', e.message))
  })

  // Pesquisa de satisfação: a cada hora
  cron.schedule('30 * * * *', () => {
    satisfactionSurvey().catch(e => console.error('[CRON] satisfaction erro:', e.message))
  })

  // Reengajamento: diariamente às 09:00
  cron.schedule('0 9 * * *', () => {
    reengagement().catch(e => console.error('[CRON] reengagement erro:', e.message))
  })

  // Lembrete de documentos: diariamente às 10:00
  cron.schedule('0 10 * * *', () => {
    docsReminder().catch(e => console.error('[CRON] docsReminder erro:', e.message))
  })

  console.log('[CRON] Jobs iniciados: follow-up, satisfaction, reengagement, docs-reminder')
}
