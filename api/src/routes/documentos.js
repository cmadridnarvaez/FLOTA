import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { pool } from '../db.js';
import { requireAuth, vehiculosVisibles, puedeAccederVehiculo } from '../middleware/auth.js';
import { config } from '../config.js';
import { analizarDocumento } from '../aiVision.js';

export const docsRouter = Router();
docsRouter.use(requireAuth);

// --- Validación de magic numbers (H2): no confiar solo en el MIME del cliente ---
const MAGIC = {
  pdf:  Buffer.from('%PDF', 'latin1'),
  png:  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  jpg:  Buffer.from([0xff, 0xd8, 0xff]),
  gif:  Buffer.from('GIF87a', 'latin1'),
  webp: Buffer.from('RIFF', 'latin1'),
};
function detectarTipo(buf) {
  for (const [t, sig] of Object.entries(MAGIC)) {
    if (buf.subarray(0, sig.length).equals(sig)) return t;
  }
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

// POST /api/documentos/analizar — analizar documento con GPT-4o Vision
// Recibe multipart con archivo temporal, lo procesa con IA, NO lo guarda
docsRouter.post('/analizar', upload.single('archivo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Debes subir un archivo para analizar' });
  }
  if (!config.openaiApiKey) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(503).json({ error: 'Análisis IA no disponible. Contacta al administrador.' });
  }

  // Validar tipo de archivo (magic number)
  const head = fs.readFileSync(req.file.path, { encoding: null }).subarray(0, 16);
  const tipoReal = detectarTipo(head);
  if (!tipoReal) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Archivo corrupto o tipo no permitido' });
  }

  try {
    const resultado = await analizarDocumento(req.file.path, req.file.mimetype);
    res.json({ data: resultado });
  } catch (e) {
    console.error('[documentos] analizar error:', e.message);
    res.status(502).json({ error: e.message || 'No se pudo analizar el documento' });
  } finally {
    // Siempre borrar el archivo temporal
    fs.promises.unlink(req.file.path).catch(() => {});
  }
});

// GET /api/documentos?vehiculo_id=
docsRouter.get('/', async (req, res) => {
  const visibles = await vehiculosVisibles(req.user.id, req.user.rol);
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
    `SELECT * FROM documentos WHERE 1=1 ${where} ORDER BY vence ASC NULLS LAST`,
    params
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
    // H2: validar magic number real del archivo
    const head = fs.readFileSync(req.file.path, { encoding: null }).subarray(0, 16);
    const tipoReal = detectarTipo(head);
    if (!tipoReal) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Archivo corrupto o tipo no permitido' });
    }
    archivoPath = moverADestino(req.file.path, vid);
  }

  const { rows } = await pool.query(
    `INSERT INTO documentos (vehiculo_id, tipo, descripcion, vence, archivo_path)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [vid, req.body.tipo, req.body.descripcion || null, req.body.vence || null, archivoPath]
  );
  res.status(201).json({ data: rows[0] });
});

// PUT /api/documentos/:id  (multipart opcional)
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

  let archivoPath = exist[0].archivo_path;
  if (req.file) {
    const head = fs.readFileSync(req.file.path, { encoding: null }).subarray(0, 16);
    const tipoReal = detectarTipo(head);
    if (!tipoReal) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: 'Archivo corrupto o tipo no permitido' });
    }
    archivoPath = moverADestino(req.file.path, exist[0].vehiculo_id);
    // Borrar archivo físico anterior (L4)
    if (exist[0].archivo_path && exist[0].archivo_path !== archivoPath) {
      fs.promises.unlink(path.join(config.storageDir, exist[0].archivo_path)).catch(() => {});
    }
  }

  const { rows } = await pool.query(
    `UPDATE documentos SET
       tipo = COALESCE($1, tipo),
       descripcion = COALESCE($2, descripcion),
       vence = COALESCE($3, vence),
       archivo_path = $4
     WHERE id = $5 RETURNING *`,
    [req.body.tipo, req.body.descripcion, req.body.vence || null, archivoPath, id]
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
