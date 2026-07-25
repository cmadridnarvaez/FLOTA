import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import {
  verifyPassword,
  signAccessToken,
  issueRefreshToken,
  consumeRefreshToken,
  revokeAllUserTokens,
} from '../auth.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimitLogin } from '../middleware/rateLimit.js';

export const authRouter = Router();

const REFRESH_COOKIE = 'rt';
const cookieOpts = {
  httpOnly: true,
  sameSite: 'Lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/api',
  maxAge: 30 * 86400000,
};

// POST /api/auth/login  (rate-limited M4)
authRouter.post('/login', rateLimitLogin, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Faltan credenciales' });
  const { rows } = await pool.query(
    'SELECT * FROM usuarios WHERE lower(email) = lower($1) AND activo = TRUE',
    [email.trim()]
  );
  const u = rows[0];
  if (!u || !(await verifyPassword(password, u.password_hash))) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }
  const access = signAccessToken(u);
  const refresh = await issueRefreshToken(u.id);
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts);
  res.json({
    token: access,
    user: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, empresa_id: u.empresa_id },
  });
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  const u = await consumeRefreshToken(raw);
  if (!u) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api' });
    return res.status(401).json({ error: 'Sesión expirada' });
  }
  const access = signAccessToken(u);
  const refresh = await issueRefreshToken(u.id);
  res.cookie(REFRESH_COOKIE, refresh, cookieOpts);
  res.json({
    token: access,
    user: { id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, empresa_id: u.empresa_id },
  });
});

// POST /api/auth/logout
authRouter.post('/logout', async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (raw) await consumeRefreshToken(raw);
  res.clearCookie(REFRESH_COOKIE, { path: '/api' });
  res.json({ ok: true });
});

// GET /api/auth/me
authRouter.get('/me', requireAuth, async (req, res) => {
  res.json({
    user: { id: req.user.id, email: req.user.email, nombre: req.user.nombre, rol: req.user.rol },
  });
});

// PUT /api/auth/password  (cambia la propia contraseña)
authRouter.put('/password', requireAuth, async (req, res) => {
  const { actual, nueva } = req.body || {};
  if (!actual || !nueva || nueva.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  const { rows } = await pool.query('SELECT * FROM usuarios WHERE id = $1', [req.user.id]);
  const u = rows[0];
  if (!(await verifyPassword(actual, u.password_hash))) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }
  const hash = await bcrypt.hash(nueva, 10);
  await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
  await revokeAllUserTokens(req.user.id);
  res.json({ ok: true });
});
