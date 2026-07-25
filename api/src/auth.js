import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { pool } from './db.js';
import { config } from './config.js';

// -- Hashing de contraseñas ------------------------------------------------
export async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// -- Access token (corto) --------------------------------------------------
export function signAccessToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, email: usuario.email, rol: usuario.rol, nombre: usuario.nombre, empresa_id: usuario.empresa_id },
    config.jwtSecret,
    { expiresIn: config.jwtAccessTtl }
  );
}

// -- Refresh token (largo, hasheado en DB) ---------------------------------
function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export async function issueRefreshToken(usuarioId, ttlDays = 30) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const tokenHash = sha256(raw);
  const expiresAt = new Date(Date.now() + ttlDays * 86400000);
  await pool.query(
    'INSERT INTO refresh_tokens (usuario_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [usuarioId, tokenHash, expiresAt]
  );
  return raw;
}

export async function consumeRefreshToken(raw) {
  if (!raw) return null;
  const tokenHash = sha256(raw);
  // Rotación ATÓMICA (M1): reclamar el token en una sola operación impide
  // que dos requests concurrentes con el mismo token robado ambos tengan éxito.
  const { rows } = await pool.query(
    `UPDATE refresh_tokens
       SET revocado = TRUE
     WHERE token_hash = $1 AND revocado = FALSE AND expires_at > now()
     RETURNING usuario_id`,
    [tokenHash]
  );
  const row = rows[0];
  if (!row) return null; // ya revocado, expirado o inexistente
  const { rows: u } = await pool.query('SELECT * FROM usuarios WHERE id = $1 AND activo = TRUE', [row.usuario_id]);
  return u[0] || null;
}

export async function revokeAllUserTokens(usuarioId) {
  await pool.query('UPDATE refresh_tokens SET revocado = TRUE WHERE usuario_id = $1', [usuarioId]);
}

// -- Verificación de access token ------------------------------------------
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}
