// Middleware de autenticación por API key para agentes IA.
// Popula req.user igual que requireAuth JWT, reutilizando todo el control de acceso existente.
import crypto from 'crypto';
import { pool } from '../db.js';

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function apiKeyAuth(req, res, next) {
  // Aceptar X-API-Key o Authorization: Bearer cmd_xxx
  const header = req.headers['x-api-key'] || '';
  const authHeader = req.headers.authorization || '';
  let rawKey = header;
  if (!rawKey && authHeader.startsWith('Bearer ')) {
    rawKey = authHeader.slice(7);
  }

  if (!rawKey || !rawKey.startsWith('cmd_')) {
    return res.status(401).json({ error: 'API key requerida. Usa header X-API-Key: cmd_xxx' });
  }

  const keyHash = sha256(rawKey);

  try {
    // Buscar la key
    const { rows } = await pool.query(
      `SELECT * FROM api_keys WHERE key_hash = $1 AND activa = TRUE`,
      [keyHash]
    );
    const key = rows[0];
    if (!key) return res.status(401).json({ error: 'API key inválida o revocada' });

    // Verificar expiración
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return res.status(401).json({ error: 'API key expirada' });
    }

    // Cargar usuario vinculado
    const { rows: users } = await pool.query(
      'SELECT id, email, nombre, rol, activo FROM usuarios WHERE id = $1 AND activo = TRUE',
      [key.usuario_id]
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'Usuario vinculado inactivo' });

    // Popular req.user — mismo formato que requireAuth JWT
    req.user = { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol };
    req.apiKey = {
      id: key.id,
      nombre: key.nombre,
      scopes: key.scopes || ['read', 'write'],
    };

    // Actualizar último uso (fire-and-forget, no bloquea)
    pool.query('UPDATE api_keys SET ultimo_uso = now() WHERE id = $1', [key.id]).catch(() => {});

    next();
  } catch (e) {
    console.error('[apiKeyAuth] error:', e.message);
    res.status(500).json({ error: 'Error validando API key' });
  }
}

// Middleware para exigir scope write en rutas de escritura
export function requireScopeWrite(req, res, next) {
  const scopes = req.apiKey?.scopes || [];
  if (!scopes.includes('write')) {
    return res.status(403).json({ error: 'Esta API key es de solo lectura. Se requiere scope write.' });
  }
  next();
}
