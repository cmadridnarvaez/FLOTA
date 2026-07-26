import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db.js';
import { requireAuth, vehiculosVisibles, puedeAccederVehiculo } from '../middleware/auth.js';
import { config } from '../config.js';
import { analizarDocumento, iaDisponible } from '../aiVision.js';

export const docsRouter = Router();
docsRouter.use(requireAuth);

// --- Validación de magic numbers (H2): no confiar solo en el MIME del cliente ---
const MAGIC = {
  pdf:  Buffer.from('%PDF', 'latin1'),
  png:  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  jpg:  Buffer.from([0xff, 0xd8, 0xff]),
  gif:  Buffer.from('GIF89a', 'latin1'),  // 89a es la variante más común
  webp: Buffer.from('WEBP', 'latin1'),  // offset 8, verificado abajo
};
function detectarTipo(buf) {
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return 'pdf';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.toString('latin1', 0, 6).match(/^GIF8[79]a$/)) return 'gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// Multer escribe a un directorio temporal genérico. La validación de vehiculo_id
// y acceso ocurre DESPUÉS en el handler, y el archivo se mueve al destino final
// validado. Esto cierra el path traversal (H1): el destination nunca usa input
// del usuario sin validar.
const tmpDir = path.join(config.storageDir, '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, tmpDir),
    filename: (req, file, cb) => {
      const safe = (file.originalname || 'doc').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      cb(null, `${Date.now()}_${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    // Filtrado preliminar por MIME/extensión (rechazo temprano de SVG)
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (file.mimetype === 'image/svg+xml' || ext === '.svg') return cb(new Error('Solo PDF o imágenes'));
    const mimeOk = /^(application\/pdf|image\/(png|jpeg|gif|webp))$/.test(file.mimetype);
    const extOk = /\.(pdf|png|jpe?g|gif|webp)$/i.test(ext);
    if (!mimeOk || !extOk) return cb(new Error('Solo PDF o imágenes'));
    cb(null, true);
  },
});

// Mueve un archivo subido al destino final validado (H1: vid es entero > 0)
function moverADestino(tmpPath, vehiculoId) {
  const dir = path.join(config.storageDir, String(vehiculoId));
  fs.mkdirSync(dir, { recursive: true });
  const destino = path.join(dir, path.basename(tmpPath));
  fs.renameSync(tmpPath, destino);
  return path.join(String(vehiculoId), path.basename(tmpPath));
}

// Rate limit para GPT-4o Vision: 5 análisis cada 5 minutos por usuario
let _analizarTimestamps = [];
const _analizarCooldown = 5 * 60 * 1000; // 5 min
const _analizarMax = 5;

// POST /api/documentos/analizar — analizar documento con IA (visión)
// Recibe multipart con archivo temporal, lo procesa con IA, NO lo guarda
docsRouter.post('/analizar', upload.single('archivo'), async (req, res) => {
  const ahora = Date.now();
  _analizarTimestamps = _analizarTimestamps.filter(function(t) { return ahora - t < _analizarCooldown; });
  if (_analizarTimestamps.length >= _analizarMax) {
    if (req.file) fs.promises.unlink(req.file.path).catch(function() {});
    return res.status(429).json({ error: 'Límite de análisis IA alcanzado. Reintenta en unos minutos.' });
  }
  _analizarTimestamps.push(ahora);
  if (!req.file) {
    return res.status(400).json({ error: 'Debes subir un archivo para analizar' });
  }
  if (!(await iaDisponible(req.user.empresa_id))) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(503).json({ error: 'Análisis IA no disponible. Configura un proveedor en Configuración.' });
  }

  // Validar tipo de archivo (magic number)
  const head = fs.readFileSync(req.file.path, { encoding: null }).subarray(0, 16);
  const tipoReal = detectarTipo(head);
  if (!tipoReal) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Archivo corrupto o tipo no permitido' });
  }

  try {
    const resultado = await analizarDocumento(req.file.path, req.file.mimetype, req.user.empresa_id);
    res.json({ data: resultado });
  } catch (e) {
    console.error('[documentos] analizar error:', e.message);
    res.status(502).json({ error: e.message || 'No se pudo analizar el documento' });
  } finally {
    // Siempre borrar el archivo temporal
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

// GET /api/documentos?vehiculo_id=&incluir_historial=1
// Por defecto solo vigentes. incluir_historial=1 trae todo.
docsRouter.get('/', async (req, res) => {
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
  // Por defecto solo vigentes (es_vigente = TRUE)
  if (req.query.incluir_historial !== '1' && req.query.incluir_historial !== 'true') {
    where += ' AND es_vigente = TRUE';
  }
  const { rows } = await pool.query(
    `SELECT * FROM documentos WHERE 1=1 ${where} ORDER BY vence ASC NULLS LAST`,
    params
  );
  res.json({ data: rows });
});

// GET /api/documentos/:id/versiones — historial de versiones del grupo
docsRouter.get('/:id/versiones', async (req, res) => {
  const id = Number(req.params.id);
  const { rows: doc } = await pool.query('SELECT grupo_id, vehiculo_id FROM documentos WHERE id = $1', [id]);
  if (!doc[0]) return res.status(404).json({ error: 'No encontrado' });
  if (!(await puedeAccederVehiculo(req, doc[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });

  const { rows } = await pool.query(
    `SELECT id, tipo, descripcion, vence, archivo_path, es_vigente, creado_en
     FROM documentos WHERE grupo_id = $1
     ORDER BY es_vigente DESC, creado_en DESC`,
    [doc[0].grupo_id]
  );
  res.json({ data: rows });
});

// POST /api/documentos  (multipart: vehiculo_id, tipo, descripcion, vence, archivo)
docsRouter.post('/', upload.single('archivo'), async (req, res) => {
  const vid = Number(req.body.vehiculo_id);
  if (!Number.isInteger(vid) || vid <= 0) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'vehiculo_id inválido' });
  }
  if (!(await puedeAccederVehiculo(req, vid))) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  }
  if (!req.body.tipo) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'tipo es obligatorio' });
  }

  let archivoPath = null;
  if (req.file) {
    const head = fs.readFileSync(req.file.path, { encoding: null }).subarray(0, 16);
    const tipoReal = detectarTipo(head);
    if (!tipoReal) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Archivo corrupto o tipo no permitido' });
    }
    archivoPath = moverADestino(req.file.path, vid);
  }

  // H1: Versionado en TRANSACCIÓN para prevenir race condition (dos vigentes del mismo tipo)
  const client = await pool.connect();
  let rows;
  try {
    await client.query('BEGIN');

    // Lock + buscar vigente previo del mismo tipo + vehículo
    const { rows: previos } = await client.query(
      'SELECT id, grupo_id FROM documentos WHERE vehiculo_id = $1 AND tipo = $2 AND es_vigente = TRUE FOR UPDATE LIMIT 1',
      [vid, req.body.tipo]
    );
    const previo = previos[0];
    let grupoId;

    if (previo) {
      await client.query('UPDATE documentos SET es_vigente = FALSE WHERE id = $1', [previo.id]);
      grupoId = previo.grupo_id;
    }

    const insResult = await client.query(
      `INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence, archivo_path, grupo_id, es_vigente)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *`,
      [vid, req.body.tipo, req.body.descripcion || null, req.body.vence || null, archivoPath, grupoId || null]
    );
    rows = insResult.rows;

    if (!grupoId) {
      await client.query('UPDATE documentos SET grupo_id = id WHERE id = $1', [rows[0].id]);
      rows[0].grupo_id = rows[0].id;
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    // El UNIQUE parcial protege contra race: si otro proceso ya insertó, el INSERT falla aquí
    if (e.code === '23505') {
      return res.status(409).json({ error: 'Ya existe un documento vigente de este tipo. Intenta nuevamente.' });
    }
    throw e;
  } finally {
    client.release();
  }

  res.status(201).json({ data: rows[0] });
});

// PUT /api/documentos/:id  (multipart opcional)
// Si se reemplaza el archivo: crea NUEVA VERSIÓN (no borra la anterior)
// Si solo cambia metadata: UPDATE in-place del documento vigente
docsRouter.put('/:id', upload.single('archivo'), async (req, res) => {
  const id = Number(req.params.id);
  const { rows: exist } = await pool.query('SELECT * FROM documentos WHERE id = $1', [id]);
  if (!exist[0]) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(404).json({ error: 'No encontrado' });
  }
  if (!(await puedeAccederVehiculo(req, exist[0].vehiculo_id))) {
    if (req.file) fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  }

  // Si hay archivo nuevo → crear nueva versión (no borrar anterior)
  if (req.file) {
    const head = fs.readFileSync(req.file.path, { encoding: null }).subarray(0, 16);
    const tipoReal = detectarTipo(head);
    if (!tipoReal) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Archivo corrupto o tipo no permitido' });
    }
    const archivoPath = moverADestino(req.file.path, exist[0].vehiculo_id);

    // Archivar el documento actual
    await pool.query('UPDATE documentos SET es_vigente = FALSE WHERE id = $1', [id]);

    // Crear nueva versión con los datos actualizados
    const tipo = req.body.tipo || exist[0].tipo;
    const descripcion = req.body.descripcion !== undefined ? (req.body.descripcion || null) : exist[0].descripcion;
    const vence = req.body.vence !== undefined ? (req.body.vence || null) : exist[0].vence;

    const { rows } = await pool.query(
      `INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence, archivo_path, grupo_id, es_vigente)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE) RETURNING *`,
      [exist[0].vehiculo_id, tipo, descripcion, vence, archivoPath, exist[0].grupo_id]
    );
    return res.json({ data: rows[0] });
  }

  // Sin archivo nuevo: solo actualizar metadata del documento vigente
  const { rows } = await pool.query(
    `UPDATE documentos SET
       tipo = COALESCE($1, tipo),
       descripcion = COALESCE($2, descripcion),
       vence = COALESCE($3, vence)
     WHERE id = $4 RETURNING *`,
    [req.body.tipo, req.body.descripcion, req.body.vence || null, id]
  );
  res.json({ data: rows[0] });
});

// DELETE /api/documentos/:id
docsRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { rows: exist } = await pool.query('SELECT * FROM documentos WHERE id = $1', [id]);
  if (!exist[0]) return res.status(404).json({ error: 'No encontrado' });
  if (!(await puedeAccederVehiculo(req, exist[0].vehiculo_id))) return res.status(403).json({ error: 'Sin acceso a este vehículo' });
  if (exist[0].archivo_path) {
    fs.promises.unlink(path.join(config.storageDir, exist[0].archivo_path)).catch(() => {});
  }
  await pool.query('DELETE FROM documentos WHERE id = $1', [id]);
  res.json({ ok: true });
});

// GET /api/documentos/:id/archivo — descargar (H2: siempre attachment)
docsRouter.get('/:id/archivo', async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT * FROM documentos WHERE id = $1', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'No encontrado' });
  if (!(await puedeAccederVehiculo(req, d.vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  if (!d.archivo_path) return res.status(404).json({ error: 'Sin archivo adjunto' });
  const full = path.join(config.storageDir, d.archivo_path);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });
  res.setHeader('Content-Disposition', 'attachment');
  res.sendFile(path.resolve(full));
});

// POST /api/documentos/:id/analizar-ia — analiza el archivo existente en disco con GPT-4o
// (sin necesidad de re-subir el archivo) y actualiza el documento con los datos extraídos
docsRouter.post('/:id/analizar-ia', async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await pool.query('SELECT * FROM documentos WHERE id = $1', [id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: 'No encontrado' });
  if (!(await puedeAccederVehiculo(req, d.vehiculo_id))) return res.status(403).json({ error: 'Sin acceso' });
  if (!d.archivo_path) return res.status(400).json({ error: 'Este documento no tiene archivo para analizar' });

  const full = path.join(config.storageDir, d.archivo_path);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Archivo no encontrado en disco' });

  if (!(await iaDisponible(req.user.empresa_id))) {
    return res.status(503).json({ error: 'Análisis IA no disponible. Configura un proveedor en Configuración.' });
  }

  // Determinar MIME desde la extensión
  const ext = path.extname(d.archivo_path).toLowerCase();
  const mimeMap = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
  const mime = mimeMap[ext] || 'application/octet-stream';

  try {
    const resultado = await analizarDocumento(full, mime, req.user.empresa_id);

    // Actualizar el documento con los datos extraídos
    const updateBody = {};
    if (resultado.descripcion) updateBody.descripcion = resultado.descripcion;
    if (resultado.vence) updateBody.vence = resultado.vence;
    if (resultado.tipo && resultado.tipo !== 'otro') updateBody.tipo = resultado.tipo;

    if (Object.keys(updateBody).length > 0) {
      const sets = [];
      const params = [];
      let i = 1;
      for (const [k, v] of Object.entries(updateBody)) {
        sets.push(`${k} = $${i}`);
        params.push(v);
        i++;
      }
      params.push(id);
      await pool.query(`UPDATE documentos SET ${sets.join(', ')} WHERE id = $${i}`, params);
    }

    res.json({ data: resultado, actualizado: Object.keys(updateBody).length > 0 });
  } catch (e) {
    console.error('[documentos] analizar-ia error:', e.message);
    res.status(502).json({ error: e.message || 'No se pudo analizar el documento' });
  }
});
