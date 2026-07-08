export function errorHandler(err, req, res, next) {
  console.error('[Error]', err.message)
  const status = err.status ?? 500
  res.status(status).json({
    error: process.env.NODE_ENV === 'production' ? 'Erro interno' : err.message
  })
}

export function notFound(req, res) {
  res.status(404).json({ error: `Rota não encontrada: ${req.method} ${req.path}` })
}
