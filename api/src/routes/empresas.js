// ============================================================================
// CRUD de Empresas — solo super_admin
// ============================================================================
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { requireAuth, requireSuperAdmin } from '../middleware/auth.js';

export const empresasRouter = Router();
empresasRouter.use(requireAuth);

// GET /api/empresas — listar todas (solo super_admin)
empresasRouter.get('/', requireSuperAdmin, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT e.*,
            (SELECT count(*) FROM usuarios u WHERE u.empresa_id = e.id)::int AS usuarios_count,
            (SELECT count(*) FROM vehiculos v WHERE v.empresa_id = e.id)::int AS vehiculos_count
     FROM empresas e ORDER BY e.nombre`
  );
  res.json({ data: rows });
});

// GET /api/empresas/:id — detalle de una empresa
empresasRouter.get('/:id', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query(
    `SELECT e.*,
            (SELECT count(*) FROM usuarios u WHERE u.empresa_id = e.id)::int AS usuarios_count,
            (SELECT count(*) FROM vehiculos v WHERE v.empresa_id = e.id)::int AS vehiculos_count
     FROM empresas e WHERE e.id = $1`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Empresa no encontrada' });
  res.json({ data: rows[0] });
});

// POST /api/empresas — crear empresa + admin inicial
empresasRouter.post('/', requireSuperAdmin, async (req, res) => {
  const b = req.body || {};
  if (!b.nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  if (!b.admin_email || !b.admin_password) return res.status(400).json({ error: 'admin_email y admin_password son obligatorios' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Crear empresa
    const { rows: empRows } = await client.query(
      `INSERT INTO empresas (nombre, rut, plan) VALUES ($1, $2, $3) RETURNING *`,
      [b.nombre, b.rut || null, b.plan || 'basico']
    );
    const empresa = empRows[0];

    // Crear admin inicial de la empresa
    const exists = await client.query('SELECT 1 FROM usuarios WHERE lower(email) = lower($1)', [b.admin_email]);
    if (exists.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    }
    const hash = await bcrypt.hash(b.admin_password, 10);
    await client.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol, empresa_id, activo)
       VALUES (lower($1), $2, $3, 'admin', $4, TRUE)`,
      [b.admin_email.trim(), b.admin_nombre || b.nombre + ' (Admin)', hash, empresa.id]
    );

    await client.query('COMMIT');
    res.status(201).json({ data: empresa, message: 'Empresa creada con admin inicial' });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Error al crear empresa: ' + e.message });
  } finally {
    client.release();
  }
});

// PUT /api/empresas/:id — editar empresa
empresasRouter.put('/:id', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows } = await pool.query(
    `UPDATE empresas SET
       nombre = COALESCE($1, nombre),
       rut = COALESCE($2, rut),
       plan = COALESCE($3, plan),
       activa = COALESCE($4, activa),
       logo_path = COALESCE($5, logo_path)
     WHERE id = $6 RETURNING *`,
    [b.nombre, b.rut, b.plan, b.activa, b.logo_path, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Empresa no encontrada' });
  res.json({ data: rows[0] });
});

// DELETE /api/empresas/:id — desactivar empresa (no borrar datos)
empresasRouter.delete('/:id', requireSuperAdmin, async (req, res) => {
  const id = Number(req.params.id);
  await pool.query('UPDATE empresas SET activa = FALSE WHERE id = $1', [id]);
  await pool.query('UPDATE usuarios SET activo = FALSE WHERE empresa_id = $1', [id]);
  res.json({ ok: true });
});
