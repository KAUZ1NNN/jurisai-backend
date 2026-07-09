import { Router } from 'express'
import { query } from '../db/index.js'
import { requireAuth } from '../middleware/auth.js'
import { validatePassword, createUser, findUserByEmail } from '../services/auth.js'
import bcrypt from 'bcryptjs'

const router = Router()

// ─── GET /settings ────────────────────────────────────────────────────────────
// Retorna todas as configurações como objeto chave-valor
router.get('/', requireAuth, async (req, res) => {
  const { rows } = await query(`SELECT key, value FROM settings ORDER BY key`)
  const settings = {}
  rows.forEach(r => { settings[r.key] = r.value })
  res.json(settings)
})

// ─── PATCH /settings ──────────────────────────────────────────────────────────
// Atualiza uma ou mais configurações
// Body: { office_name: '...', welcome_message: '...', ... }
router.patch('/', requireAuth, async (req, res) => {
  const allowed = [
    'office_name', 'office_phone', 'office_email', 'office_area',
    'office_logo', 'welcome_message', 'office_hours_start',
    'office_hours_end', 'office_hours_24h',
  ]

  const updates = Object.entries(req.body).filter(([k]) => allowed.includes(k))
  if (!updates.length) return res.status(400).json({ error: 'Nenhum campo válido enviado' })

  for (const [key, value] of updates) {
    await query(`
      INSERT INTO settings (key, value) VALUES ($1, $2)
      ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()
    `, [key, value])
  }

  res.json({ ok: true })
})

// ─── PATCH /settings/password ─────────────────────────────────────────────────
// Troca a senha do usuário logado
router.patch('/password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body

  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias' })

  if (new_password.length < 6)
    return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres' })

  // Busca o usuário no banco
  const { rows } = await query(`SELECT * FROM users WHERE id = $1`, [req.user.id])
  if (!rows.length) return res.status(404).json({ error: 'Usuário não encontrado' })

  const valid = await validatePassword(current_password, rows[0].password)
  if (!valid) return res.status(401).json({ error: 'Senha atual incorreta' })

  const hash = await bcrypt.hash(new_password, 12)
  await query(`UPDATE users SET password = $1 WHERE id = $2`, [hash, req.user.id])

  res.json({ ok: true })
})

// ─── POST /settings/logo ──────────────────────────────────────────────────────
// Recebe imagem em base64 e salva como URL de dados
// Para produção futura: integrar com S3 ou Cloudinary
router.post('/logo', requireAuth, async (req, res) => {
  const { base64, mimeType } = req.body

  if (!base64 || !mimeType)
    return res.status(400).json({ error: 'base64 e mimeType são obrigatórios' })

  // Valida tipo de arquivo
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
  if (!allowed.includes(mimeType))
    return res.status(400).json({ error: 'Tipo de arquivo não permitido. Use JPG, PNG, WEBP ou SVG.' })

  // Valida tamanho (~500KB em base64)
  if (base64.length > 700_000)
    return res.status(400).json({ error: 'Imagem muito grande. Máximo 500KB.' })

  const dataUrl = `data:${mimeType};base64,${base64}`

  await query(`
    INSERT INTO settings (key, value) VALUES ('office_logo', $1)
    ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
  `, [dataUrl])

  res.json({ ok: true, logo: dataUrl })
})

export default router
