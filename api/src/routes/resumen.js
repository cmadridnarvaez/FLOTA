import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, vehiculosVisibles } from '../middleware/auth.js';

export const resumenRouter = Router();
resumenRouter.use(requireAuth);

// GET /api/resumen — KPIs globales + próximos vencimientos (solo documentos vigentes)
resumenRouter.get('/', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol, req.user.empresa_id);
  const params = [];
  let filtroVeh = '';
  if (visibles !== null) {
    if (visibles.length === 0) {
      return res.json({ data: { total: 0, vencidos: 0, proximos: 0, alDia: 0, documentos: 0, proximosVenc: [] } });
    }
    filtroVeh = ' AND vehiculo_id = ANY($1::bigint[])';
    params.push(visibles);
  }

  // C2: todas las queries filtran es_vigente = TRUE para no contar versiones archivadas
  const qDocs = (extraWhere, p) =>
    pool.query(
      `SELECT count(*)::int FROM documentos WHERE vence IS NOT NULL AND es_vigente = TRUE ${filtroVeh} ${extraWhere}`,
      p
    );

  const [tVeh, tDocs, rVenc, rProx, rAlDia] = await Promise.all([
    visibles === null
      ? pool.query('SELECT count(*)::int FROM vehiculos')
      : pool.query('SELECT count(*)::int FROM vehiculos WHERE id = ANY($1::bigint[])', [visibles]),
    qDocs('', params),
    qDocs('AND vence < CURRENT_DATE', params),
    qDocs('AND vence >= CURRENT_DATE AND vence <= CURRENT_DATE + 60', params),
    qDocs('AND vence > CURRENT_DATE + 60', params),
  ]);

  // Próximos vencimientos (los 30 más cercanos, solo vigentes)
  const p2 = [...params];
  const prox = await pool.query(
    `SELECT d.id, d.tipo, d.descripcion, d.vence, d.vehiculo_id, v.nombre, v.patente
     FROM documentos d JOIN vehiculos v ON v.id = d.vehiculo_id
     WHERE d.vence IS NOT NULL AND d.es_vigente = TRUE ${filtroVeh}
     ORDER BY d.vence ASC LIMIT 30`,
    p2
  );

  res.json({
    data: {
      total: tVeh.rows[0].count,
      documentos: tDocs.rows[0].count,
      vencidos: rVenc.rows[0].count,
      proximos: rProx.rows[0].count,
      alDia: rAlDia.rows[0].count,
      proximosVenc: prox.rows,
    },
  });
});
