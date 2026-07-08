import { verifyToken } from '../services/auth.js'

export function requireAuth(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autenticado' })
  }
  try {
    const token = header.split(' ')[1]
    req.user = verifyToken(token)
    next()
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' })
  }
}
