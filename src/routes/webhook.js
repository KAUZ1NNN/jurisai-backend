import { Router } from 'express'
import { parseWebhookMessage } from '../services/whatsapp.js'
import { processIncomingMessage } from '../services/messageProcessor.js'

const router = Router()

// ─── POST /webhook ────────────────────────────────────────────────────────────
// A Z-API envia POST para cada mensagem recebida
// Não tem verificação GET como a Meta — a segurança é pelo Security Token
// que validamos no header Client-Token via variável ZAPI_SECURITY_TOKEN
router.post('/', async (req, res) => {
  // Valida o Security Token para garantir que o POST veio mesmo da Z-API
  const securityToken = process.env.ZAPI_SECURITY_TOKEN
  const headerToken   = req.headers['client-token']

  if (securityToken && headerToken !== securityToken) {
    console.warn('[Webhook] Token de segurança inválido — requisição ignorada')
    return res.sendStatus(401)
  }

  // Responde 200 imediatamente (Z-API reenvia se não receber 200 rápido)
  res.sendStatus(200)

  try {
    const parsed = parseWebhookMessage(req.body)
    if (!parsed) return // Não é mensagem de texto recebida — ignora

    // Processa em background
    processIncomingMessage(parsed).catch(err =>
      console.error('[Webhook] Erro no processamento:', err.message)
    )
  } catch (err) {
    console.error('[Webhook] Erro ao parsear payload:', err.message)
  }
})

// ─── GET /webhook/status ──────────────────────────────────────────────────────
// Endpoint auxiliar para verificar conexão com Z-API
router.get('/status', async (req, res) => {
  try {
    const { getInstanceStatus } = await import('../services/whatsapp.js')
    const status = await getInstanceStatus()
    res.json({ status, timestamp: new Date().toISOString() })
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message })
  }
})

export default router
