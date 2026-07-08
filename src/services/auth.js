import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { query } from '../db/index.js'

const SECRET = process.env.JWT_SECRET ?? 'jurisai-dev-secret-troque-em-producao'
const EXPIRES = '7d'

// ─── TOKENS ───────────────────────────────────────────────────────────────────
export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    SECRET,
    { expiresIn: EXPIRES }
  )
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET)
}

// ─── USUÁRIO ──────────────────────────────────────────────────────────────────
export async function createUser({ name, email, password }) {
  const hash = await bcrypt.hash(password, 12)
  const { rows } = await query(
    `INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, role`,
    [name, email, hash]
  )
  return rows[0]
}

export async function findUserByEmail(email) {
  const { rows } = await query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  )
  return rows[0] ?? null
}

export async function validatePassword(plain, hash) {
  return bcrypt.compare(plain, hash)
}
