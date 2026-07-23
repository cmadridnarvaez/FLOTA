// Rate limiting para API de agentes IA — 60 req/minuto por API key
const VENTANA_MS = 60 * 1000;
const MAX_REQS = 60;
const requests = new Map(); // keyId -> [timestamps]

setInterval(() => {
  const ahora = Date.now();
  for (const [id, arr] of requests) {
    const limpio = arr.filter((t) => ahora - t < VENTANA_MS);
    if (limpio.length === 0) requests.delete(id);
    else requests.set(id, limpio);
  }
}, 5 * 60 * 1000).unref();

export function rateLimitAgent(req, res, next) {
  const keyId = req.apiKey?.id;
  if (!keyId) return next(); // sin keyId no debería pasar, pero no bloquear

  const ahora = Date.now();
  const arr = (requests.get(keyId) || []).filter((t) => ahora - t < VENTANA_MS);

  if (arr.length >= MAX_REQS) {
    const reintento = Math.ceil((VENTANA_MS - (ahora - arr[0])) / 1000);
    res.setHeader('Retry-After', reintento);
    return res.status(429).json({
      error: 'Rate limit excedido',
      limite: MAX_REQS + ' req/' + VENTANA_MS / 1000 + 's',
      reintentar_en: reintento + 's',
    });
  }

  arr.push(ahora);
  requests.set(keyId, arr);
  next();
}
