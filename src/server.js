import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import http from 'http'

import { runMigrations, runAuthMigration, runSettingsMigration } from './db/index.js'
import { initWebSocket } from './services/websocket.js'
import { initCronJobs } from './services/cron.js'
import { requireAuth } from './middleware/auth.js'

import webhookRouter       from './routes/webhook.js'
import authRouter          from './routes/auth.js'
import conversationsRouter from './routes/conversations.js'
import settingsRouter      from './routes/settings.js'
import apiRouter           from './routes/index.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'

const app    = express()
const server = http.createServer(app)

app.use(cors({
  origin     : process.env.FRONTEND_URL ?? 'http://localhost:5173',
  methods    : ['GET', 'POST', 'PATCH', 'DELETE'],
  credentials: true,
}))
app.use(express.json({ limit: '2mb' })) // permite logo em base64

app.get('/health', (_, res) => res.json({
  status: 'ok', version: '1.0.0', service: 'JurisAI Backend',
  timestamp: new Date().toISOString(),
}))

// Rotas públicas
app.use('/webhook', webhookRouter)
app.use('/auth',    authRouter)

// Rotas protegidas
app.use('/conversations', requireAuth, conversationsRouter)
app.use('/settings',      requireAuth, settingsRouter)
app.use('/',              requireAuth, apiRouter)

app.use(notFound)
app.use(errorHandler)

const PORT = process.env.PORT ?? 3001

async function bootstrap() {
  try {
    await runMigrations()
    await runAuthMigration()
    await runSettingsMigration()

    server.listen(PORT, () => {
      console.log(`\n🚀 JurisAI Backend na porta ${PORT}`)
      console.log(`   Health : http://localhost:${PORT}/health`)
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
