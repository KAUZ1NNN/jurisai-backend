import { Router } from 'express'
import { createUser, findUserByEmail, validatePassword, signToken } from '../services/auth.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// POST /auth/register — Cria o primeiro usuário (advogado)
// Em produção você pode desabilitar esta rota depois de criar a conta
router.post('/register', async (req, res) => {
  const { name, email, password } = req.body

  if (!name || !email || !password)
    return res.status(400).json({ error: 'Nome, e-mail e senha são obrigatórios' })

  if (password.length < 6)
    return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' })

  const existing = await findUserByEmail(email)
  if (existing)
    return res.status(409).json({ error: 'E-mail já cadastrado' })

  const user = await createUser({ name, email, password })
  const token = signToken(user)

  res.status(201).json({ token, user })
})

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body

  if (!email || !password)
    return res.status(400).json({ error: 'E-mail e senha obrigatórios' })

  const user = await findUserByEmail(email)
  if (!user)
    return res.status(401).json({ error: 'E-mail ou senha incorretos' })

  const valid = await validatePassword(password, user.password)
  if (!valid)
    return res.status(401).json({ error: 'E-mail ou senha incorretos' })

  const token = signToken(user)
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } })
})

// GET /auth/me — Retorna dados do usuário logado
router.get('/me', requireAuth, async (req, res) => {
  res.json({ user: req.user })
})

export default router
