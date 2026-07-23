// Rate limiter simple en memoria (M4). Sin dependencias externas.
// Apto para una app de pocos usuarios detrás de un único nginx.
const VENTANA_MS = 15 * 60 * 1000; // 15 min
const MAX_INTENTOS = 10;

const intentos = new Map(); // ip -> [ts, ...]

// Express con trust proxy(1) expone req.ip ya resuelto desde X-Forwarded-For.
function ipDe(req) {
  return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}

// Middleware: cuenta el intento y bloquea si excede el máximo.
// Se reinicia el contador tras un login exitoso (hook vía res).
export function rateLimitLogin(req, res, next) {
  const ip = ipDe(req);
  const ahora = Date.now();
  const arr = (intentos.get(ip) || []).filter((t) => ahora - t < VENTANA_MS);

  if (arr.length >= MAX_INTENTOS) {
    const reintento = Math.ceil((VENTANA_MS - (ahora - arr[0])) / 1000);
    res.setHeader('Retry-After', reintento);
    return res.status(429).json({ error: 'Demasiados intentos. Reintenta en ' + reintento + 's' });
  }

  // Registrar este intento. Si el login resulta exitoso, se descarta.
  arr.push(ahora);
  intentos.set(ip, arr);

  // Hook: al enviar respuesta, si fue 200 (éxito), limpiar contador de esta IP
  const ipFinal = ip;
  const origJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode === 200) intentos.delete(ipFinal);
    return origJson(body);
  };

  next();
}

// Limpieza periódica del mapa para que no crezca indefinidamente
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, arr] of intentos) {
    const limpio = arr.filter((t) => ahora - t < VENTANA_MS);
    if (limpio.length === 0) intentos.delete(ip);
    else intentos.set(ip, limpio);
  }
}, 10 * 60 * 1000).unref();
