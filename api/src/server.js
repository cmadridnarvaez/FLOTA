import express from './expressPatch.js';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { config } from './config.js';
import { pool } from './db.js';
import { ensureAdminSeed } from './seed.js';
import { revisarYEnviar } from './notifier.js';
import { authRouter } from './routes/auth.js';
import { vehiculosRouter } from './routes/vehiculos.js';
import { docsRouter } from './routes/documentos.js';
import { mantRouter } from './routes/mantenciones.js';
import { gastosRouter } from './routes/gastos.js';
import { usuariosRouter } from './routes/usuarios.js';
import { resumenRouter } from './routes/resumen.js';
import { chileRouter } from './routes/chile.js';
import { agentRouter } from './routes/agent.js';
import { empresasRouter } from './routes/empresas.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Trust proxy: detrás de Cloudflare Tunnel / nginx
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// CORS cerrado: mismo origen (web y api viven en el mismo host por nginx)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Rutas
app.use('/api/auth', authRouter);
app.use('/api/vehiculos', vehiculosRouter);
app.use('/api/documentos', docsRouter);
app.use('/api/mantenciones', mantRouter);
app.use('/api/gastos', gastosRouter);
app.use('/api/usuarios', usuariosRouter);
app.use('/api/resumen', resumenRouter);
app.use('/api/chile', chileRouter);
app.use('/api/agent', agentRouter);
app.use('/api/empresas', empresasRouter);

// 404 API
app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint no encontrado' }));

// Manejador de errores (C1: captura async errors vía asyncHandler + next)
app.use((err, req, res, next) => {
  // Errores esperados de multer (subida de archivos)
  if (err instanceof multer.MulterError || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Archivo demasiado grande o inválido' });
  }
  // Errores esperados del fileFilter de multer (tipo no permitido)
  if (err?.message && err.message.includes('Solo PDF o imágenes')) {
    return res.status(400).json({ error: 'Solo se permiten PDF o imágenes' });
  }
  // Errores de validación explícitos (lanzados con status)
  if (err?.status && err.status >= 400 && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  // Errores de PostgreSQL (constraint violations, syntax errors)
  if (err?.code && typeof err.code === 'string' && err.code.length === 5) {
    console.error('[api] DB error:', err.code, err.message);
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con esos datos' });
    if (err.code === '23503') return res.status(400).json({ error: 'Referencia inválida (el registro no existe)' });
    if (err.code === '23514') return res.status(400).json({ error: 'Valor fuera del rango permitido' });
    if (err.code === '22P02' || err.code === '22007') return res.status(400).json({ error: 'Formato de dato inválido' });
    return res.status(400).json({ error: 'Datos inválidos' });
  }
  // Resto: log completo interno, mensaje genérico al cliente
  console.error('[api] error no manejado:', err.message);
  res.status(500).json({ error: 'Error interno del servidor' });
});

// C1: capturar promise rejections no manejadas a nivel proceso (última línea de defensa)
process.on('unhandledRejection', (reason) => {
  console.error('[api] unhandledRejection:', reason?.message || reason);
});

// Arranque
async function start() {
  // Esperar DB lista
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch {
      console.log(`[api] esperando DB... (${i + 1}/30)`);
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  // Asegurar que el admin tenga su password real (no el placeholder del seed.sql)
  await ensureAdminSeed();

  // Limpieza periódica de refresh tokens expirados/revocados (L14)
  setInterval(() => {
    pool.query('DELETE FROM refresh_tokens WHERE expires_at < now() OR revocado')
      .then((r) => { if (r.rowCount > 0) console.log(`[db] purgados ${r.rowCount} refresh tokens viejos`); })
      .catch(() => {});
  }, 6 * 3600 * 1000); // cada 6h

  // Job diario: alertas de vencimientos por email (Resend)
  // Ejecuta al arranque y luego cada 24h
  async function ejecutarAlertas() {
    try {
      const r = await revisarYEnviar();
      if (r.enviados > 0) console.log(`[notifier] ${r.enviados} alerta(s) enviada(s)`);
    } catch (e) {
      console.error('[notifier] error en job de alertas:', e.message);
    }
  }
  // Ejecutar 30s después del arranque (para no competir con el startup)
  setTimeout(ejecutarAlertas, 30000);
  // Luego cada 24h
  setInterval(ejecutarAlertas, 24 * 3600 * 1000);

  app.listen(config.port, () => console.log(`[api] escuchando en :${config.port}`));
}

start().catch((e) => {
  console.error('[api] fallo crítico al iniciar:', e);
  process.exit(1);
});
