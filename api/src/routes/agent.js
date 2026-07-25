// ============================================================================
// API para Agentes IA — /api/agent/*
// Acceso con API key (X-API-Key: cmd_xxx). Reutiliza todo el control de acceso.
// ============================================================================
import { Router } from 'express';
import { revisarYEnviar, enviarEmailPrueba } from '../notifier.js';
import { config } from '../config.js';
import { pool } from '../db.js';
import { apiKeyAuth, requireScopeWrite } from '../middleware/apiKeyAuth.js';
import { rateLimitAgent } from '../middleware/rateLimitAgent.js';
import { vehiculosVisibles, puedeAccederVehiculo } from '../middleware/auth.js';
import { lookupPatente } from '../boostr.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

export const agentRouter = Router();
agentRouter.use(apiKeyAuth);
agentRouter.use(rateLimitAgent);

// Helper: limpia timestamps a formato Chile legible
const _TIMESTAMP_FIELDS = new Set(['creado_en', 'actualizado_en', 'ultimo_uso', 'enviado_en', 'expires_at']);
function limpiarFechas(obj) {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) {
    const cl = new Date(obj.getTime() - 4 * 3600000);
    const p = (n) => String(n).padStart(2, '0');
    return cl.getFullYear() + '-' + p(cl.getMonth()+1) + '-' + p(cl.getDate()) + ' ' + p(cl.getHours()) + ':' + p(cl.getMinutes());
  }
  if (Array.isArray(obj)) return obj.map(limpiarFechas);
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      if (_TIMESTAMP_FIELDS.has(k) && typeof obj[k] === 'string') {
        const m = obj[k].match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/);
        out[k] = m ? m[1] + ' ' + m[2] : obj[k];
      } else {
        out[k] = limpiarFechas(obj[k]);
      }
    }
    return out;
  }
  return obj;
}

function ok(res, data) { res.json({ data: limpiarFechas(data) }); }

// ============================================================================
// GET /api/agent — Discovery: lista todos los endpoints disponibles (LLM-friendly)
// ============================================================================
agentRouter.get('/', (req, res) => {
  res.json({
    servicio: 'Flota CMD Servicios Tecnológicos SpA',
    version: '1.0',
    autenticacion: 'Header X-API-Key: cmd_xxx o Authorization: Bearer cmd_xxx',
    rate_limit: '60 req/minuto por API key',
    scopes: req.apiKey.scopes,
    usuario: { email: req.user.email, rol: req.user.rol },
    endpoints: {
      consultas: {
        'GET /api/agent/vehiculos': 'Lista vehículos visibles con ficha técnica completa',
        'GET /api/agent/vehiculos/:id': 'Detalle de un vehículo',
        'GET /api/agent/vehiculos/:id/ciclo-de-vida': 'Timeline completo (docs + mantenciones + gastos + GPS)',
        'GET /api/agent/documentos?vehiculo_id=X': 'Documentos (opcional filtrar por vehículo)',
        'GET /api/agent/mantenciones?vehiculo_id=X': 'Historial de mantenciones',
        'GET /api/agent/gastos?vehiculo_id=X': 'Gastos registrados',
        'GET /api/agent/resumen': 'KPIs globales + próximos vencimientos',
        'GET /api/agent/chile/indicadores': 'UF, UTM, dólar, euro (mindicador.cl)',
        'GET /api/agent/lookup/:patente': 'Consulta AutoRiesgo por patente',
      },
      actualizaciones: req.apiKey.scopes.includes('write') ? {
        'POST /api/agent/vehiculos': 'Crear vehículo',
        'PUT /api/agent/vehiculos/:id': 'Actualizar vehículo (ficha técnica, GPS, etc.)',
        'POST /api/agent/mantenciones': 'Registrar mantención',
        'PUT /api/agent/mantenciones/:id': 'Editar mantención',
        'DELETE /api/agent/mantenciones/:id': 'Eliminar mantención',
        'POST /api/agent/gastos': 'Registrar gasto',
        'PUT /api/agent/gastos/:id': 'Editar gasto',
        'DELETE /api/agent/gastos/:id': 'Eliminar gasto',
        'POST /api/agent/documentos': 'Registrar documento (metadata, sin archivo)',
        'PUT /api/agent/documentos/:id': 'Editar documento',
        'DELETE /api/agent/documentos/:id': 'Eliminar documento',
      } : 'API key de solo lectura — sin permisos de escritura',
    },
    ejemplos: {
      crear_gasto: {
        method: 'POST',
        url: '/api/agent/gastos',
        body: { vehiculo_id: 1, fecha: '2026-07-20', categoria: 'combustible', monto: 25000, descripcion: 'Estanque lleno' },
        categorias_validas: ['combustible', 'seguro', 'patente', 'mantencion', 'peaje', 'repuestos', 'accesorios', 'otro'],
      },
      actualizar_gps: {
        method: 'PUT',
        url: '/api/agent/vehiculos/2',
        body: { gps_tipo: 'suscripcion', gps_empresa: 'SuiGPS', gps_device_id: 'SG-123', gps_vence: '2026-12-31' },
      },
    },
  });
});

// ============================================================================
// CONSULTAS (read)
// ============================================================================

// GET /api/agent/vehiculos
agentRouter.get('/vehiculos', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol, req.user.empresa_id);
  let q = 'SELECT * FROM vehiculos';
  const params = [];
  if (visibles !== null) {
    if (visibles.length === 0) return ok(res, []);
    q += ' WHERE id = ANY($1::bigint[])';
    params.push(visibles);
  }
  q += ' ORDER BY nombre';
  const { rows } = await pool.query(q, params);
  ok(res, rows);
});

// GET /api/agent/vehiculos/:id
agentRouter.get('/vehiculos/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await puedeAccederVehiculo(req, id))) return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  const { rows } = await pool.query('SELECT * FROM vehiculos WHERE id = $1', [id]);
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  ok(res, rows[0]);
});

// GET /api/agent/vehiculos/:id/ciclo-de-vida
agentRouter.get('/vehiculos/:id/ciclo-de-vida', async (req, res) => {
  const id = Number(req.params.id);
  if (!(await puedeAccederVehiculo(req, id))) return res.status(403).json({ error: 'Sin acceso a este vehículo' });

  const [veh, docs, mant, gas] = await Promise.all([
    pool.query('SELECT * FROM vehiculos WHERE id = $1', [id]),
    pool.query('SELECT * FROM documentos WHERE vehiculo_id = $1 ORDER BY vence ASC NULLS LAST', [id]),
    pool.query('SELECT * FROM mantenciones WHERE vehiculo_id = $1 ORDER BY fecha DESC', [id]),
    pool.query('SELECT * FROM gastos WHERE vehiculo_id = $1 ORDER BY fecha DESC', [id]),
  ]);

  if (!veh.rows[0]) return res.status(404).json({ error: 'No encontrado' });

  const totalMant = mant.rows.reduce((a, m) => a + Number(m.costo || 0), 0);
  const totalGas = gas.rows.reduce((a, g) => a + Number(g.monto || 0), 0);

  ok(res, {
    vehiculo: veh.rows[0],
    documentos: docs.rows,
    mantenciones: mant.rows,
    gastos: gas.rows,
    resumen: {
      total_documentos: docs.rows.length,
      total_mantenciones: mant.rows.length,
      total_gastos: gas.rows.length,
      inversion_total: totalMant + totalGas,
      costo_mantenciones: totalMant,
      costo_gastos: totalGas,
    },
  });
});

// GET /api/agent/documentos?vehiculo_id=
agentRouter.get('/documentos', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol, req.user.empresa_id);
  const params = [];
  let where = '';
  if (visibles !== null) {
    if (visibles.length === 0) return ok(res, []);
    where += ' AND vehiculo_id = ANY($1::bigint[])';
    params.push(visibles);
  }
  if (req.query.vehiculo_id) {
    where += ' AND vehiculo_id = $' + (params.length + 1);
    params.push(Number(req.query.vehiculo_id));
  }
  const { rows } = await pool.query(`SELECT * FROM documentos WHERE 1=1 ${where} ORDER BY vence ASC NULLS LAST`, params);
  ok(res, rows);
});

// GET /api/agent/mantenciones?vehiculo_id=
agentRouter.get('/mantenciones', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol, req.user.empresa_id);
  const params = [];
  let where = '';
  if (visibles !== null) {
    if (visibles.length === 0) return ok(res, []);
    where += ' AND vehiculo_id = ANY($1::bigint[])';
    params.push(visibles);
  }
  if (req.query.vehiculo_id) {
    where += ' AND vehiculo_id = $' + (params.length + 1);
    params.push(Number(req.query.vehiculo_id));
  }
  const { rows } = await pool.query(`SELECT * FROM mantenciones WHERE 1=1 ${where} ORDER BY fecha DESC`, params);
  ok(res, rows);
});

// GET /api/agent/gastos?vehiculo_id=
agentRouter.get('/gastos', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol, req.user.empresa_id);
  const params = [];
  let where = '';
  if (visibles !== null) {
    if (visibles.length === 0) return ok(res, []);
    where += ' AND vehiculo_id = ANY($1::bigint[])';
    params.push(visibles);
  }
  if (req.query.vehiculo_id) {
    where += ' AND vehiculo_id = $' + (params.length + 1);
    params.push(Number(req.query.vehiculo_id));
  }
  const { rows } = await pool.query(`SELECT * FROM gastos WHERE 1=1 ${where} ORDER BY fecha DESC`, params);
  ok(res, rows);
});

// GET /api/agent/resumen
agentRouter.get('/resumen', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol, req.user.empresa_id);
  const params = [];
  let filtroVeh = '';
  if (visibles !== null) {
    if (visibles.length === 0) return ok(res, { total: 0, documentos: 0, vencidos: 0, proximos: 0, alDia: 0 });
    filtroVeh = ' AND vehiculo_id = ANY($1::bigint[])';
    params.push(visibles);
  }

  const [tVeh, rVenc, rProx, prox] = await Promise.all([
    visibles === null
      ? pool.query('SELECT count(*)::int FROM vehiculos')
      : pool.query('SELECT count(*)::int FROM vehiculos WHERE id = ANY($1::bigint[])', [visibles]),
    pool.query(`SELECT count(*)::int FROM documentos WHERE vence IS NOT NULL ${filtroVeh} AND vence < CURRENT_DATE`, params),
    pool.query(`SELECT count(*)::int FROM documentos WHERE vence IS NOT NULL ${filtroVeh} AND vence >= CURRENT_DATE AND vence <= CURRENT_DATE + 60`, params),
    pool.query(
      `SELECT d.id, d.tipo, d.descripcion, d.vence, d.vehiculo_id, v.nombre, v.patente
       FROM documentos d JOIN vehiculos v ON v.id = d.vehiculo_id
       WHERE d.vence IS NOT NULL ${filtroVeh}
       ORDER BY d.vence ASC LIMIT 30`,
      params
    ),
  ]);

  ok(res, {
    total: tVeh.rows[0].count,
    vencidos: rVenc.rows[0].count,
    proximos: rProx.rows[0].count,
    proximosVenc: prox.rows,
  });
});

// GET /api/agent/chile/indicadores
agentRouter.get('/chile/indicadores', async (req, res) => {
  try {
    const r = await fetch('https://mindicador.cl/api', { signal: AbortSignal.timeout(8000) });
    const raw = await r.json();
    ok(res, {
      uf: { valor: raw.uf?.valor, fecha: raw.uf?.fecha },
      utm: { valor: raw.utm?.valor, fecha: raw.utm?.fecha },
      dolar: { valor: raw.dolar?.valor, fecha: raw.dolar?.fecha },
      euro: { valor: raw.euro?.valor, fecha: raw.euro?.fecha },
    });
  } catch {
    res.status(502).json({ error: 'No se pudieron obtener los indicadores' });
  }
});

// GET /api/agent/lookup/:patente
agentRouter.get('/lookup/:patente', async (req, res) => {
  const patente = String(req.params.patente || '').toUpperCase().trim();
  if (!patente) return res.status(400).json({ error: 'Patente requerida' });
  try {
    const data = await lookupPatente(patente);
    ok(res, data);
  } catch (e) {
    // H3: no exponer internals del upstream
    console.error('[agent] lookup error:', patente, e.message);
    if (e.message?.includes('Rate limit')) {
      res.status(429).json({ error: 'Límite de consultas excedido. Reintenta en unos segundos.' });
    } else if (e.message?.includes('no encontrada')) {
      res.status(404).json({ error: 'Patente no encontrada en el registro' });
    } else {
      res.status(502).json({ error: 'No se pudo consultar la patente en este momento' });
    }
  }
});

// ============================================================================
// ACTUALIZACIONES (write) — requieren scope write
// ============================================================================

// POST /api/agent/vehiculos
agentRouter.post('/vehiculos', requireScopeWrite, async (req, res) => {
  const b = req.body || {};
  if (!b.nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  const { rows } = await pool.query(
    `INSERT INTO vehiculos (nombre, patente, titular, tipo, marca, modelo, anio, vin, motor, color, notas, gps_tipo, gps_empresa, gps_device_id, gps_vence)
     VALUES ($1, upper($2), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
    [b.nombre, b.patente ? String(b.patente).toUpperCase().trim() : null, b.titular || null, b.tipo || 'calle',
     b.marca || null, b.modelo || null, b.anio || null, b.vin || null, b.motor || null, b.color || null, b.notas || null,
     b.gps_tipo || null, b.gps_empresa || null, b.gps_device_id || null, b.gps_vence || null]
  );
  if (req.user.rol !== 'admin') {
    await pool.query('INSERT INTO acceso_vehiculo (usuario_id, vehiculo_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, rows[0].id]);
  }
  res.status(201).json({ data: rows[0] });
});

// PUT /api/agent/vehiculos/:id
agentRouter.put('/vehiculos/:id', requireScopeWrite, async (req, res) => {
  const id = Number(req.params.id);
  if (!(await puedeAccederVehiculo(req, id))) return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  const b = req.body || {};
  const { rows } = await pool.query(
    `UPDATE vehiculos SET
       nombre = COALESCE($1, nombre), patente = upper(COALESCE($2, patente)),
       titular = COALESCE($3, titular), tipo = COALESCE($4, tipo),
       marca = COALESCE($5, marca), modelo = COALESCE($6, modelo), anio = COALESCE($7, anio),
       vin = COALESCE($8, vin), motor = COALESCE($9, motor), color = COALESCE($10, color),
       notas = COALESCE($11, notas),
       gps_tipo = $12, gps_empresa = $13, gps_device_id = $14, gps_vence = $15
     WHERE id = $16 RETURNING *`,
    [b.nombre, b.patente, b.titular, b.tipo, b.marca, b.modelo, b.anio, b.vin, b.motor, b.color, b.notas,
     b.gps_tipo !== undefined ? b.gps_tipo : undefined, b.gps_empresa !== undefined ? b.gps_empresa : undefined,
     b.gps_device_id !== undefined ? b.gps_device_id : undefined, b.gps_vence !== undefined ? b.gps_vence : undefined, id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  ok(res, rows[0]);
});

// POST /api/agent/mantenciones
agentRouter.post('/mantenciones', requireScopeWrite, async (req, res) => {
  const b = req.body || {};
  if (!b.vehiculo_id || !b.fecha) return res.status(400).json({ error: 'vehiculo_id y fecha son obligatorios' });
  if (!(await puedeAccederVehiculo(req, Number(b.vehiculo_id)))) return res.status(403).json({ error: 'Sin acceso' });
  const { rows } = await pool.query(
    `INSERT INTO mantenciones (vehiculo_id, fecha, tipo, kilometraje, costo, descripcion)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [Number(b.vehiculo_id), b.fecha, b.tipo || null, b.kilometraje || null, b.costo || null, b.descripcion || null]
  );
  res.status(201).json({ data: rows[0] });
});

// PUT /api/agent/mantenciones/:id — editar mantención
agentRouter.put('/mantenciones/:id', requireScopeWrite, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM mantenciones WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'Mantención no encontrada' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  const { rows } = await pool.query(
    `UPDATE mantenciones SET
       vehiculo_id  = COALESCE($1, vehiculo_id),
       fecha        = COALESCE($2, fecha),
       tipo         = COALESCE($3, tipo),
       kilometraje  = COALESCE($4, kilometraje),
       costo        = COALESCE($5, costo),
       descripcion  = COALESCE($6, descripcion)
     WHERE id = $7 RETURNING *`,
    [b.vehiculo_id ? Number(b.vehiculo_id) : undefined, b.fecha, b.tipo, b.kilometraje !== undefined ? b.kilometraje : undefined,
     b.costo !== undefined ? b.costo : undefined, b.descripcion, id]
  );
  ok(res, rows[0]);
});

// DELETE /api/agent/mantenciones/:id — borrar mantención
agentRouter.delete('/mantenciones/:id', requireScopeWrite, async (req, res) => {
  const id = Number(req.params.id);
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM mantenciones WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'Mantención no encontrada' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  await pool.query('DELETE FROM mantenciones WHERE id = $1', [id]);
  res.json({ ok: true });
});

// H1: Validación preventiva de tipos para evitar crashes.
// Usa el patrón {ok:false,msg} para que el handler haga return res.status(400) sin throw.
function validarId(v, campo) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, msg: `${campo} debe ser un número entero positivo` };
  return { ok: true, val: n };
}
function validarMonto(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return { ok: false, msg: 'monto debe ser un número positivo' };
  return { ok: true, val: n };
}
function validarFecha(v, campo) {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return { ok: false, msg: (campo||'fecha') + ' debe tener formato YYYY-MM-DD' };
  return { ok: true, val: v };
}

// POST /api/agent/gastos
const CATEGORIAS_VALIDAS = ['combustible', 'seguro', 'patente', 'mantencion', 'peaje', 'repuestos', 'accesorios', 'otro'];
agentRouter.post('/gastos', requireScopeWrite, async (req, res) => {
  const b = req.body || {};
  if (!b.vehiculo_id || !b.fecha || b.monto == null) return res.status(400).json({ error: 'vehiculo_id, fecha y monto son obligatorios' });
  const vid = validarId(b.vehiculo_id, 'vehiculo_id');
  if (!vid.ok) return res.status(400).json({ error: vid.msg });
  const fecha = validarFecha(b.fecha, 'fecha');
  if (!fecha.ok) return res.status(400).json({ error: fecha.msg });
  const monto = validarMonto(b.monto);
  if (!monto.ok) return res.status(400).json({ error: monto.msg });
  const cat = b.categoria || 'otro';
  if (!CATEGORIAS_VALIDAS.includes(cat)) {
    return res.status(400).json({ error: `Categoría inválida: "${cat}". Valores válidos: ${CATEGORIAS_VALIDAS.join(', ')}` });
  }
  if (!(await puedeAccederVehiculo(req, vid.val))) return res.status(403).json({ error: 'Sin acceso' });
  const { rows } = await pool.query(
    `INSERT INTO gastos (vehiculo_id, fecha, categoria, monto, descripcion)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [vid.val, fecha.val, cat, monto.val, b.descripcion || null]
  );
  res.status(201).json({ data: rows[0] });
});

// PUT /api/agent/gastos/:id — editar gasto
agentRouter.put('/gastos/:id', requireScopeWrite, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM gastos WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'Gasto no encontrado' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  if (b.categoria && !CATEGORIAS_VALIDAS.includes(b.categoria)) {
    return res.status(400).json({ error: `Categoría inválida: "${b.categoria}". Valores válidos: ${CATEGORIAS_VALIDAS.join(', ')}` });
  }
  const { rows } = await pool.query(
    `UPDATE gastos SET
       vehiculo_id = COALESCE($1, vehiculo_id),
       fecha       = COALESCE($2, fecha),
       categoria   = COALESCE($3, categoria),
       monto       = COALESCE($4, monto),
       descripcion = COALESCE($5, descripcion)
     WHERE id = $6 RETURNING *`,
    [b.vehiculo_id ? Number(b.vehiculo_id) : undefined, b.fecha, b.categoria, b.monto !== undefined ? Number(b.monto) : undefined, b.descripcion, id]
  );
  ok(res, rows[0]);
});

// DELETE /api/agent/gastos/:id — borrar gasto
agentRouter.delete('/gastos/:id', requireScopeWrite, async (req, res) => {
  const id = Number(req.params.id);
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM gastos WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'Gasto no encontrado' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  await pool.query('DELETE FROM gastos WHERE id = $1', [id]);
  res.json({ ok: true });
});

// POST /api/agent/documentos
agentRouter.post('/documentos', requireScopeWrite, async (req, res) => {
  const b = req.body || {};
  if (!b.vehiculo_id || !b.tipo) return res.status(400).json({ error: 'vehiculo_id y tipo son obligatorios' });
  if (!(await puedeAccederVehiculo(req, Number(b.vehiculo_id)))) return res.status(403).json({ error: 'Sin acceso' });
  const { rows } = await pool.query(
    `INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [Number(b.vehiculo_id), b.tipo, b.descripcion || null, b.vence || null]
  );
  res.status(201).json({ data: rows[0] });
});

// PUT /api/agent/documentos/:id — editar documento (metadata, sin archivo)
agentRouter.put('/documentos/:id', requireScopeWrite, async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM documentos WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'Documento no encontrado' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  const { rows } = await pool.query(
    `UPDATE documentos SET
       tipo = COALESCE($1, tipo),
       descripcion = COALESCE($2, descripcion),
       vence = COALESCE($3, vence)
     WHERE id = $4 RETURNING *`,
    [b.tipo, b.descripcion, b.vence, id]
  );
  ok(res, rows[0]);
});

// DELETE /api/agent/documentos/:id — borrar documento
agentRouter.delete('/documentos/:id', requireScopeWrite, async (req, res) => {
  const id = Number(req.params.id);
  const { rows: ex } = await pool.query('SELECT vehiculo_id FROM documentos WHERE id = $1', [id]);
  if (!ex[0]) return res.status(404).json({ error: 'Documento no encontrado' });
  if (!(await puedeAccederVehiculo(req, ex[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  await pool.query('DELETE FROM documentos WHERE id = $1', [id]);
  res.json({ ok: true });
});

// ============================================================================
// NOTIFICACIONES — alertas por email
// ============================================================================

// H2: Cooldown para /notifier/test (max 1 cada 10 min, anti-spam)
let ultimoTestTs = 0;
const TEST_COOLDOWN_MS = 10 * 60 * 1000;

// POST /api/agent/notifier/test — email de prueba
agentRouter.post('/notifier/test', requireScopeWrite, async (req, res) => {
  const ahora = Date.now();
  if (ahora - ultimoTestTs < TEST_COOLDOWN_MS) {
    const espera = Math.ceil((TEST_COOLDOWN_MS - (ahora - ultimoTestTs)) / 1000);
    return res.status(429).json({ error: `Email de prueba en cooldown. Reintenta en ${espera}s` });
  }
  ultimoTestTs = ahora;
  try {
    const result = await enviarEmailPrueba();
    ok(res, { enviado: true, id: result.id, to: config.alertaTo });
  } catch (e) {
    // H3: no exponer internals del error de Resend
    console.error('[notifier] error email prueba:', e.message);
    res.status(502).json({ error: 'No se pudo enviar el email de prueba. Verifica la configuración.' });
  }
});

// POST /api/agent/notifier/run — ejecutar revisión de vencimientos ahora
agentRouter.post('/notifier/run', requireScopeWrite, async (req, res) => {
  try {
    const result = await revisarYEnviar();
    ok(res, result);
  } catch (e) {
    // H3: mensaje genérico
    console.error('[notifier] error revisión:', e.message);
    res.status(500).json({ error: 'Error al revisar vencimientos' });
  }
});
