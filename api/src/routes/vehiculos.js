import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, vehiculosVisibles, puedeAccederVehiculo } from '../middleware/auth.js';
import { config } from '../config.js';
import { lookupPatente } from '../boostr.js';
import { num, fechaValida, buildUpdate } from '../middleware/validate.js';

export const vehiculosRouter = Router();
vehiculosRouter.use(requireAuth);

// GET /api/vehiculos
vehiculosRouter.get('/', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol);
  let q = 'SELECT * FROM vehiculos';
  const params = [];
  if (visibles !== null) {
    if (visibles.length === 0) return res.json({ data: [] });
    q += ' WHERE id = ANY($1::bigint[])';
    params.push(visibles);
  }
  q += ' ORDER BY nombre';
  const { rows } = await pool.query(q, params);
  res.json({ data: rows });
});

// GET /api/vehiculos/:id
vehiculosRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await puedeAccederVehiculo(req, id))) return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  const { rows } = await pool.query('SELECT * FROM vehiculos WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  res.json({ data: rows[0] });
});

// POST /api/vehiculos
vehiculosRouter.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.nombre) return res.status(400).json({ error: 'Nombre es obligatorio' });
  const { rows } = await pool.query(
    `INSERT INTO vehiculos (nombre, patente, titular, tipo, marca, modelo, anio, vin, motor, color, notas, gps_tipo, gps_empresa, gps_device_id, gps_vence)
     VALUES ($1, upper($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [
      b.nombre,
      b.patente ? String(b.patente).toUpperCase().trim() : null,
      b.titular || null,
      b.tipo || 'calle',
      b.marca || null,
      b.modelo || null,
      b.anio || null,
      b.vin || null,
      b.motor || null,
      b.color || null,
      b.notas || null,
      b.gps_tipo || null,
      b.gps_empresa || null,
      b.gps_device_id || null,
      b.gps_vence || null,
    ]
  );
  // Si el creador es usuario normal, auto-asignar acceso
  if (req.user.rol !== 'admin') {
    await pool.query('INSERT INTO acceso_vehiculo (usuario_id, vehiculo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, rows[0].id]);
  }
  res.status(201).json({ data: rows[0] });
});

// PUT /api/vehiculos/:id
vehiculosRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await puedeAccederVehiculo(req, id))) return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  const b = req.body || {};
  // C2: buildUpdate arma SET dinámico solo con campos presentes (permite setear NULL explícito)
  const { setClause, params, nextParamIndex } = buildUpdate(b, {
    nombre: (v) => v?.trim() || null,
    patente: (v) => v ? String(v).toUpperCase().trim() : null,
    titular: (v) => v?.trim() || null,
    tipo: (v) => v,
    marca: (v) => v?.trim() || null,
    modelo: (v) => v?.trim() || null,
    anio: (v) => num(v),
    vin: (v) => v?.trim() || null,
    motor: (v) => v?.trim() || null,
    color: (v) => v?.trim() || null,
    notas: (v) => v?.trim() || null,
    gps_tipo: (v) => v || null,
    gps_empresa: (v) => v?.trim() || null,
    gps_device_id: (v) => v?.trim() || null,
    gps_vence: (v) => fechaValida(v) || null,
  });
  if (!setClause) return res.status(400).json({ error: 'No hay campos para actualizar' });
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE vehiculos SET ${setClause} WHERE id = $${nextParamIndex} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  res.json({ data: rows[0] });
});

// DELETE /api/vehiculos/:id  (solo admin)
vehiculosRouter.delete('/:id', async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Requiere admin' });
  const id = Number(req.params.id);
  await pool.query('DELETE FROM vehiculos WHERE id = $1', [id]);
  res.json({ ok: true });
});

// GET /api/vehiculos/lookup/:patente — consulta APIs externas (AutoRiesgo + Boostr fallback)
vehiculosRouter.get('/lookup/:patente', async (req, res) => {
  const patente = String(req.params.patente || '').toUpperCase().trim();
  if (!patente) return res.status(400).json({ error: 'Patente requerida' });
  try {
    const data = await lookupPatente(patente);
    res.json({ data });
  } catch (e) {
    res.status(502).json({ error: e.message || 'No se pudo consultar la patente' });
  }
});
