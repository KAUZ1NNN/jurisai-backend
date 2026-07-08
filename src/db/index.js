import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
})

pool.on('error', (err) => {
  console.error('[DB] Erro inesperado no pool:', err.message)
})

export async function query(sql, params = []) {
  const client = await pool.connect()
  try {
    const result = await client.query(sql, params)
    return result
  } finally {
    client.release()
  }
}

// ─── MIGRATIONS ──────────────────────────────────────────────────────────────
// Cria todas as tabelas se não existirem (idempotente)
export async function runMigrations() {
  await query(`
    CREATE TABLE IF NOT EXISTS clients (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name        TEXT NOT NULL,
      phone       TEXT UNIQUE NOT NULL,
      area        TEXT,          -- consumidor | previdenciario | bancario | null
      stage       TEXT DEFAULT 'lead', -- lead | consulta | proposta | fechado
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      client_id     UUID REFERENCES clients(id) ON DELETE CASCADE,
      phone         TEXT NOT NULL,
      area          TEXT,
      status        TEXT DEFAULT 'ia_ativa', -- ia_ativa | assumido | encerrado
      last_message  TEXT,
      last_time     TIMESTAMPTZ DEFAULT NOW(),
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS messages (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
      phone           TEXT NOT NULL,
      direction       TEXT NOT NULL,  -- in | out
      text            TEXT NOT NULL,
      sent_by         TEXT DEFAULT 'ia', -- ia | humano
      status          TEXT DEFAULT 'sent', -- sent | pending_review | approved | discarded
      alert_reason    TEXT,           -- cpf_requested | document_requested | monetary_value | null
      wa_message_id   TEXT,           -- ID retornado pela Meta API
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
      message_id      UUID REFERENCES messages(id) ON DELETE CASCADE,
      type            TEXT NOT NULL,  -- sensitive_data | document
      reason          TEXT NOT NULL,
      draft           TEXT NOT NULL,
      status          TEXT DEFAULT 'pending', -- pending | approved | discarded
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ
    );
  `)

  await query(`
    CREATE TABLE IF NOT EXISTS automations (
      id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key       TEXT UNIQUE NOT NULL,
      title     TEXT NOT NULL,
      enabled   BOOLEAN DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `)

  // Seed automações padrão
  await query(`
    INSERT INTO automations (key, title, enabled) VALUES
      ('welcome',            'Boas-vindas e triagem por área',          TRUE),
      ('qualify_consumidor', 'Qualificação — Consumidor',                TRUE),
      ('qualify_prev',       'Qualificação — Previdenciário',            TRUE),
      ('qualify_bancario',   'Qualificação — Bancário',                  TRUE),
      ('followup_48h',       'Follow-up após 48h sem resposta',          TRUE),
      ('satisfaction',       'Pesquisa de satisfação',                   TRUE),
      ('docs_reminder',      'Lembrete de documentos pendentes',         FALSE),
      ('reengagement',       'Reengajamento de lead frio',               FALSE)
    ON CONFLICT (key) DO NOTHING;
  `)

  console.log('[DB] Migrations concluídas.')
}

// Adicionado na migration v2 — tabela de usuários
export async function runAuthMigration() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         TEXT NOT NULL,
      email        TEXT UNIQUE NOT NULL,
      password     TEXT NOT NULL,        -- bcrypt hash
      role         TEXT DEFAULT 'advogado',
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `)
  console.log('[DB] Auth migration concluída.')
}
