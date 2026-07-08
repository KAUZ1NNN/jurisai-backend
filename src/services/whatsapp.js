import axios from 'axios'
import 'dotenv/config'

// ─── Z-API ────────────────────────────────────────────────────────────────────
// Docs: https://developer.z-api.io
// Variáveis necessárias no Railway:
//   ZAPI_INSTANCE_ID  → ID da instância (painel Z-API → sua instância → Instance ID)
//   ZAPI_TOKEN        → Token da instância (painel Z-API → sua instância → Token)
//   ZAPI_SECURITY_TOKEN → Security Token (painel Z-API → sua instância → Security Token)

const INSTANCE_ID      = process.env.ZAPI_INSTANCE_ID
const TOKEN            = process.env.ZAPI_TOKEN
const SECURITY_TOKEN   = process.env.ZAPI_SECURITY_TOKEN

const BASE = `https://api.z-api.io/instances/${INSTANCE_ID}/token/${TOKEN}`

const zapi = axios.create({
  baseURL: BASE,
  headers: {
    'Content-Type': 'application/json',
    'Client-Token': SECURITY_TOKEN,
  },
})

zapi.interceptors.response.use(
  r => r,
  err => {
    const msg = err.response?.data?.message ?? err.message
    console.error('[WhatsApp Z-API] Erro:', msg)
    throw new Error(msg)
  }
)

// ─── ENVIAR MENSAGEM DE TEXTO ─────────────────────────────────────────────────
export async function sendTextMessage(to, text) {
  const phone = sanitizePhone(to)
  const { data } = await zapi.post('/send-text', {
    phone,
    message: text,
  })
  // Z-API retorna { zaapId, messageId, id }
  return data?.messageId ?? data?.id ?? null
}

// ─── MARCAR COMO LIDA ─────────────────────────────────────────────────────────
export async function markAsRead(waMessageId) {
  try {
    await zapi.post('/read-message', {
      messageId: waMessageId,
    })
  } catch {
    // Não crítico — ignora silenciosamente
  }
}

// ─── PARSE DO WEBHOOK DA Z-API ────────────────────────────────────────────────
// A Z-API envia POST no seu webhook para cada mensagem recebida
export function parseWebhookMessage(body) {
  try {
    // Z-API envia diferentes tipos de evento — só nos interessa mensagem recebida
    // fromMe = true significa que foi o próprio número que enviou (ignorar)
    if (body.fromMe) return null
    if (body.type !== 'ReceivedCallback') return null

    // Só processa mensagens de texto
    const text = body.text?.message
    if (!text) return null

    const phone = body.phone?.replace(/\D/g, '') // remove caracteres não numéricos

    if (!phone) return null

    return {
      waMessageId: body.messageId ?? body.id,
      phone,
      name: body.senderName ?? body.pushname ?? 'Cliente',
      text,
      timestamp: body.momentsAgo
        ? new Date(Date.now() - body.momentsAgo * 1000)
        : new Date(),
    }
  } catch {
    return null
  }
}

// ─── STATUS DA CONEXÃO ────────────────────────────────────────────────────────
export async function getInstanceStatus() {
  try {
    const { data } = await zapi.get('/status')
    return data?.connected ? 'connected' : 'disconnected'
  } catch {
    return 'error'
  }
}

// ─── UTILITÁRIO ───────────────────────────────────────────────────────────────
function sanitizePhone(phone) {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('55') ? digits : `55${digits}`
}
