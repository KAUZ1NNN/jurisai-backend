# JurisAI — Backend

API Node.js + Express para o sistema de atendimento jurídico via WhatsApp com IA.

## Stack
- Node.js 18+ (ESModules)
- Express 4
- PostgreSQL (Railway managed)
- WebSocket (ws)
- Anthropic Claude Haiku 4.5
- WhatsApp Meta Cloud API

## Estrutura

```
src/
├── db/
│   └── index.js             # Pool PostgreSQL + migrations automáticas
├── middleware/
│   └── errorHandler.js      # Tratamento global de erros
├── routes/
│   ├── webhook.js           # POST/GET /webhook (Meta Cloud API)
│   ├── conversations.js     # CRUD de conversas + mensagens manuais
│   └── index.js             # alerts, clients, automations, stats
└── services/
    ├── ai.js                # Claude Haiku — prompts por área jurídica
    ├── messageProcessor.js  # Pipeline principal: receber → IA → detectar → enviar
    ├── sensitiveDetector.js # Detecta CPF, documentos, dados sensíveis
    ├── websocket.js         # Broadcast em tempo real para o dashboard
    └── whatsapp.js          # Meta Cloud API — envio e parse do webhook
```

## Desenvolvimento local

```bash
cp .env.example .env
# Preencha as variáveis (ver abaixo)

npm install
npm run dev
```

## Variáveis de ambiente

| Variável | Descrição |
|----------|-----------|
| `PORT` | Porta do servidor (padrão: 3001) |
| `WHATSAPP_TOKEN` | System User Token do painel Meta |
| `WHATSAPP_PHONE_ID` | Phone Number ID |
| `WHATSAPP_VERIFY_TOKEN` | Token de verificação do webhook (você define) |
| `WHATSAPP_BUSINESS_ID` | WhatsApp Business Account ID |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic |
| `DATABASE_URL` | URL PostgreSQL (Railway injeta automaticamente) |
| `FRONTEND_URL` | URL do frontend (para CORS) |

## Como configurar o WhatsApp (Meta Cloud API)

1. Acesse [developers.facebook.com](https://developers.facebook.com)
2. Crie um App do tipo **Business**
3. Adicione o produto **WhatsApp**
4. Em **WhatsApp > API Setup**: copie o `Phone Number ID` e o `Access Token`
5. Em **WhatsApp > Configuration > Webhook**:
   - URL: `https://SEU-BACKEND.railway.app/webhook`
   - Verify Token: o valor que você definiu em `WHATSAPP_VERIFY_TOKEN`
   - Eventos: marque **messages**
6. Para produção, crie um **System User Token** permanente (não expira)

## Deploy no Railway

1. Push para o GitHub
2. Railway: New Project → Deploy from GitHub
3. **Adicione um banco PostgreSQL**: New Service → Database → PostgreSQL
4. As variáveis `DATABASE_URL` são injetadas automaticamente
5. Adicione as demais variáveis em **Variables**
6. O `railway.json` já configura o start command

## Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/health` | Health check |
| GET | `/webhook` | Verificação Meta |
| POST | `/webhook` | Mensagens de entrada |
| GET | `/conversations` | Lista conversas |
| GET | `/conversations/:id` | Conversa + mensagens |
| PATCH | `/conversations/:id/status` | Assumir/encerrar |
| POST | `/conversations/:id/messages` | Mensagem manual |
| GET | `/alerts` | Alertas pendentes |
| POST | `/alerts/:id/approve` | Aprovar e enviar |
| POST | `/alerts/:id/discard` | Descartar alerta |
| GET | `/clients` | Lista clientes |
| PATCH | `/clients/:id/stage` | Muda estágio do kanban |
| GET | `/automations` | Lista automações |
| PATCH | `/automations/:id` | Liga/desliga automação |
| GET | `/stats` | Métricas do dashboard |

## WebSocket

Conecte o frontend em `ws://SEU-BACKEND.railway.app/ws`

Eventos emitidos pelo servidor:
- `NEW_MESSAGE` — nova mensagem do cliente
- `AI_REPLIED` — IA enviou resposta automática
- `ALERT_CREATED` — mensagem pausada (dado sensível ou documento)
- `ALERT_RESOLVED` — alerta aprovado ou descartado
- `CONVERSATION_UPDATED` — status ou área atualizada
- `CLIENT_CREATED` — novo cliente cadastrado

## Pipeline de mensagem

```
WhatsApp (cliente envia)
        ↓
POST /webhook
        ↓
parseWebhookMessage()      ← extrai phone, text, name
        ↓
processIncomingMessage()
  ├── upsert client
  ├── upsert conversation
  ├── salva mensagem "in"
  ├── [conversa assumida?] → para aqui
  ├── generateReply() via Claude Haiku
  ├── detectSensitive()
  │     ├── flagged → cria alerta, NÃO envia, notifica WS
  │     └── ok      → sendTextMessage(), salva "out", notifica WS
  └── wsEvents.broadcast()
```
