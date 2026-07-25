import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, vehiculosVisibles, puedeAccederVehiculo } from '../middleware/auth.js';

export const mantRouter = Router();
mantRouter.use(requireAuth);

// GET /api/mantenciones?vehiculo_id=
mantRouter.get('/', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol, req.user.empresa_id);
  const params = [];
  let where = '';
  if (visibles !== null) {
    if (visibles.length === 0) return res.json({ data: [] });
    where += ' AND vehiculo_id = ANY($1::bigint[])';
    params.push(visibles);
  }
  if (req.query.vehiculo_id) {
    where += ' AND vehiculo_id = $' + (params.length + 1);
    params.push(Number(req.query.vehiculo_id));
  }
  const { rows } = await pool.query(
    `SELECT * FROM mantenciones WHERE 1=1 ${where} ORDER BY fecha DESC`,
    params
  );
  res.json({ data: rows });
});

mantRouter.post('/', async (req, res) => {
  const b = req.body || {};
  if (!b.vehiculo_id || !b.fecha) return res.status(400).json({ error: 'vehiculo_id y fecha son obligatorios' });
  if (!(await puedeAccederVehiculo(req, Number(b.vehiculo_id)))) return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  const { rows } = await pool.query(
    `INSERT INTO mantenciones (vehiculo_id, fecha, tipo, kilometraje, costo, descripcion)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [Number(b.vehiculo_id), b.fecha, b.tipo || null, b.kilometraje || null, b.costo || null, b.descripcion || null]
  );
  res.status(201).json({ data: rows[0] });
});

// PUT /api/mantenciones/:id — editar mantención
mantRouter.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM mantenciones WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'No encontrado' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  // H2: si cambia vehiculo_id, validar acceso al nuevo vehículo
  if (b.vehiculo_id && Number(b.vehiculo_id) !== Number(ex[0].vehiculo_id)) {
    if (!(await puedeAccederVehiculo(req, Number(b.vehiculo_id)))) return res.status(403).json({ error: 'Sin acceso al vehículo destino' });
  }
  const { rows } = await pool.query(
    `UPDATE mantenciones SET
       vehiculo_id  = COALESCE($1, vehiculo_id),
       fecha        = COALESCE($2, fecha),
       tipo         = COALESCE($3, tipo),
       kilometraje  = COALESCE($4, kilometraje),
       costo        = COALESCE($5, costo),
       descripcion  = COALESCE($6, descripcion)
     WHERE id = $7 RETURNING *`,
    [
      b.vehiculo_id ? Number(b.vehiculo_id) : undefined,
      b.fecha || undefined,
      b.tipo || undefined,
      b.kilometraje !== undefined ? b.kilometraje : undefined,
      b.costo !== undefined ? b.costo : undefined,
      b.descripcion || undefined,
      id,
    ]
  );
  res.json({ data: rows[0] });
});

mantRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM mantenciones WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'No encontrado' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  await pool.query('DELETE FROM mantenciones WHERE id = $1', [id]);
  res.json({ ok: true });
});
