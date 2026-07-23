import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { revokeAllUserTokens } from '../auth.js';

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

export const usuariosRouter = Router();
usuariosRouter.use(requireAuth);

// --- Gestión de usuarios (solo admin) ---
// GET /api/usuarios
usuariosRouter.get('/', requireAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.creado_en,
            (SELECT count(*) FROM acceso_vehiculo av WHERE av.usuario_id = u.id)::int AS vehiculos_count
     FROM usuarios u ORDER BY u.nombre`
  );
  res.json({ data: rows });
});

// POST /api/usuarios
usuariosRouter.post('/', requireAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.email || !b.nombre || !b.password) return res.status(400).json({ error: 'email, nombre y password son obligatorios' });
  const exists = await pool.query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1)', [b.email]);
  if (exists.rows[0]) return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
  const hash = await bcrypt.hash(b.password, 10);
  const { rows } = await pool.query(
    `INSERT INTO usuarios (email, nombre, password_hash, rol, activo)
     VALUES (lower($1), $2, $3, $4, $5) RETURNING id, email, nombre, rol, activo`,
    [b.email.trim(), b.nombre.trim(), hash, b.rol || 'usuario', b.activo !== false]
  );
  res.status(201).json({ data: rows[0] });
});

// PUT /api/usuarios/:id
usuariosRouter.put('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const hash = b.password ? await bcrypt.hash(b.password, 10) : null;
  const { rows } = await pool.query(
    `UPDATE usuarios SET
       email  = lower(COALESCE($1, email)),
       nombre = COALESCE($2, nombre),
       rol    = COALESCE($3, rol),
       activo = COALESCE($4, activo),
       password_hash = COALESCE($5, password_hash)
     WHERE id = $6 RETURNING id, email, nombre, rol, activo`,
    [b.email, b.nombre, b.rol, b.activo, hash, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  // Si se reseteó la password, invalidar sesiones previas
  if (hash) await revokeAllUserTokens(id);
  res.json({ data: rows[0] });
});

// DELETE /api/usuarios/:id
usuariosRouter.delete('/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  await revokeAllUserTokens(id);
  await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
  res.json({ ok: true });
});

// --- Acceso selectivo vehículo ↔ usuario (solo admin) ---
// GET /api/usuarios/:id/vehiculos  -> ids de vehículos asignados
usuariosRouter.get('/:id/vehiculos', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT vehiculo_id FROM acceso_vehiculo WHERE usuario_id = $1', [id]);
  res.json({ data: rows.map((r) => r.vehiculo_id) });
});

// PUT /api/usuarios/:id/vehiculos  body: { vehiculos: [ids] }  (reemplaza la lista)
usuariosRouter.put('/:id/vehiculos', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const ids = Array.isArray(req.body?.vehiculos) ? req.body.vehiculos.map(Number) : [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM acceso_vehiculo WHERE usuario_id = $1', [id]);
    if (ids.length) {
      const values = ids.map((_, i) => `($1, $${i + 2})`).join(',');
      await client.query(`INSERT INTO acceso_vehiculo (usuario_id, vehiculo_id) VALUES ${values} ON CONFLICT DO NOTHING`, [id, ...ids]);
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[usuarios] error actualizando accesos:', e.message);
    return res.status(500).json({ error: 'Error al actualizar accesos' });
  } finally {
    client.release();
  }
  await revokeAllUserTokens(id);
  res.json({ ok: true, asignados: ids.length });
});

// ============================================================================
// API Keys — gestión (solo admin)
// ============================================================================

// GET /api/usuarios/:id/api-keys — listar keys del usuario
usuariosRouter.get('/:id/api-keys', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT id, nombre, key_prefix, scopes, activa, creada_en, ultimo_uso, expires_at
     FROM api_keys WHERE usuario_id = $1 ORDER BY creada_en DESC`,
    [id]
  );
  res.json({ data: rows });
});

// POST /api/usuarios/:id/api-keys — crear key (devuelve plaintext UNA sola vez)
usuariosRouter.post('/:id/api-keys', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  if (!b.nombre) return res.status(400).json({ error: 'nombre es obligatorio' });

  // Generar key: cmd_ + 40 chars random
  const raw = 'cmd_' + crypto.randomBytes(20).toString('hex');
  const keyHash = sha256(raw);
  const keyPrefix = raw.slice(0, 12); // cmd_abcd1234...
  const scopes = Array.isArray(b.scopes) ? b.scopes : ['read', 'write'];

  const { rows } = await pool.query(
    `INSERT INTO api_keys (nombre, key_hash, key_prefix, usuario_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, nombre, key_prefix, scopes, activa, creada_en, expires_at`,
    [b.nombre, keyHash, keyPrefix, id, scopes, b.expires_at || null]
  );

  // Devolver la key real UNA sola vez
  res.status(201).json({ data: rows[0], api_key: raw, aviso: 'Copia esta key ahora. No se volverá a mostrar.' });
});

// DELETE /api/usuarios/:id/api-keys/:keyId — revocar
usuariosRouter.delete('/:id/api-keys/:keyId', requireAdmin, async (req, res) => {
  const keyId = Number(req.params.keyId);
  await pool.query('UPDATE api_keys SET activa = FALSE WHERE id = $1 AND usuario_id = $2', [keyId, Number(req.params.id)]);
  res.json({ ok: true });
});
