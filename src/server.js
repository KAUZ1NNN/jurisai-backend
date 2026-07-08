import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import http from 'http'

import { runMigrations, runAuthMigration } from './db/index.js'
import { initWebSocket } from './services/websocket.js'
import { initCronJobs } from './services/cron.js'
import { requireAuth } from './middleware/auth.js'

import webhookRouter       from './routes/webhook.js'
import authRouter          from './routes/auth.js'
import conversationsRouter from './routes/conversations.js'
import apiRouter           from './routes/index.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'

const app    = express()
const server = http.createServer(app)

console.log('FRONTEND_URL =', process.env.FRONTEND_URL)

// ─── MIDDLEWARES ───────────────────────────────────────────────────────────────
app.use(cors({
  origin     : process.env.FRONTEND_URL ?? 'http://localhost:5173',
  methods    : ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
}))
app.use(express.json())

// ─── HEALTH CHECK (público) ───────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status   : 'ok',
  version  : '1.0.0',
  service  : 'JurisAI Backend',
  timestamp: new Date().toISOString(),
}))

// ─── ROTAS PÚBLICAS ───────────────────────────────────────────────────────────
app.use('/webhook', webhookRouter)  // Meta valida sem token
app.use('/auth',    authRouter)     // login/register sem token

// ─── ROTAS PROTEGIDAS (exigem JWT) ───────────────────────────────────────────
app.use('/conversations', requireAuth, conversationsRouter)
app.use('/',              requireAuth, apiRouter)

// ─── 404 + ERROS ──────────────────────────────────────────────────────────────
app.use(notFound)
app.use(errorHandler)

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT ?? 3001

async function bootstrap() {
  try {
    await runMigrations()
    await runAuthMigration()

    server.listen(PORT, () => {
      console.log(`\n🚀 JurisAI Backend na porta ${PORT}`)
      console.log(`   Health : http://localhost:${PORT}/health`)
      console.log(`   Webhook: http://localhost:${PORT}/webhook`)
      console.log(`   Auth   : http://localhost:${PORT}/auth/login`)
      console.log(`   Env    : ${process.env.NODE_ENV ?? 'development'}\n`)
    })

    initWebSocket(server)
    initCronJobs()

  } catch (err) {
    console.error('[Bootstrap] Erro fatal:', err.message)
    process.exit(1)
  }
}

bootstrap()
