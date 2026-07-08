import { WebSocketServer } from 'ws'

let wss = null

export function initWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' })

  wss.on('connection', (ws, req) => {
    console.log('[WS] Cliente conectado:', req.socket.remoteAddress)
    ws.isAlive = true

    // Envia confirmação de conexão
    ws.send(JSON.stringify({ type: 'connected', message: 'JurisAI WebSocket ativo' }))

    ws.on('pong', () => { ws.isAlive = true })
    ws.on('close', () => console.log('[WS] Cliente desconectado'))
    ws.on('error', (err) => console.error('[WS] Erro:', err.message))
  })

  // Heartbeat — mantém conexões vivas
  const interval = setInterval(() => {
    wss.clients.forEach(ws => {
      if (!ws.isAlive) return ws.terminate()
      ws.isAlive = false
      ws.ping()
    })
  }, 30_000)

  wss.on('close', () => clearInterval(interval))
  console.log('[WS] Servidor WebSocket iniciado em /ws')
}

// ─── EVENTOS ──────────────────────────────────────────────────────────────────
// Todos os broadcasts do sistema passam por aqui

function broadcast(payload) {
  if (!wss) return
  const data = JSON.stringify(payload)
  wss.clients.forEach(ws => {
    if (ws.readyState === 1) ws.send(data) // 1 = OPEN
  })
}

export const wsEvents = {
  // Nova mensagem recebida do cliente
  newMessage(conversation, message) {
    broadcast({ type: 'NEW_MESSAGE', conversation, message })
  },

  // IA enviou resposta automaticamente
  aiReplied(conversationId, message) {
    broadcast({ type: 'AI_REPLIED', conversationId, message })
  },

  // IA criou alerta (dado sensível ou documento)
  alertCreated(alert) {
    broadcast({ type: 'ALERT_CREATED', alert })
  },

  // Alerta resolvido (aprovado ou descartado)
  alertResolved(alertId, action) {
    broadcast({ type: 'ALERT_RESOLVED', alertId, action })
  },

  // Conversa atualizada (mudança de status, área, etc.)
  conversationUpdated(conversation) {
    broadcast({ type: 'CONVERSATION_UPDATED', conversation })
  },

  // Novo cliente cadastrado automaticamente
  clientCreated(client) {
    broadcast({ type: 'CLIENT_CREATED', client })
  },
}
