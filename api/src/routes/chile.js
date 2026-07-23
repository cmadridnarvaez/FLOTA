// Integración de APIs públicas chilenas para la app de vehículos.
// Proxy en el backend para evitar CORS y cachear resultados (reducir carga externa).
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';

export const chileRouter = Router();
chileRouter.use(requireAuth);

// Cache en memoria simple (5 min para indicadores, 10 min para sismos)
const cache = new Map();
function getCached(key, ttlMs) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < ttlMs) return entry.data;
  return null;
}
function setCached(key, data) {
  cache.set(key, { data, ts: Date.now() });
}

// GET /api/chile/indicadores — UF, UTM, dólar, euro (mindicador.cl)
chileRouter.get('/indicadores', async (req, res) => {
  const cached = getCached('indicadores', 5 * 60 * 1000);
  if (cached) return res.json({ data: cached, source: 'cache' });

  try {
    const r = await fetch('https://mindicador.cl/api', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'autos-cmdspa/1.0' },
    });
    if (!r.ok) throw new Error('mindicador.cl no respondió');
    const raw = await r.json();
    // Extraer solo lo relevante
    const data = {
      uf:    { valor: raw.uf?.valor,    fecha: raw.uf?.fecha,    nombre: 'Unidad de Fomento (UF)' },
      utm:   { valor: raw.utm?.valor,   fecha: raw.utm?.fecha,   nombre: 'Unidad Tributaria Mensual (UTM)' },
      dolar: { valor: raw.dolar?.valor, fecha: raw.dolar?.fecha, nombre: 'Dólar observado' },
      euro:  { valor: raw.euro?.valor,  fecha: raw.euro?.fecha,  nombre: 'Euro' },
      ipc:   { valor: raw.ipc?.valor,   fecha: raw.ipc?.fecha,   nombre: 'IPC último mes (%)' },
    };
    setCached('indicadores', data);
    res.json({ data, source: 'mindicador.cl' });
  } catch (e) {
    res.status(502).json({ error: 'No se pudieron obtener los indicadores' });
  }
});

// GET /api/chile/sismos — últimos sismos (api.gael.cloud)
chileRouter.get('/sismos', async (req, res) => {
  const cached = getCached('sismos', 10 * 60 * 1000);
  if (cached) return res.json({ data: cached, source: 'cache' });

  try {
    const r = await fetch('https://api.gael.cloud/general/public/sismos', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'autos-cmdspa/1.0' },
    });
    if (!r.ok) throw new Error('api.gael.cloud no respondió');
    const raw = await r.json();
    // Tomar los últimos 5 y limpiar campos
    const data = (raw || []).slice(0, 5).map((s) => ({
      fecha: s.Fecha,
      magnitud: s.Magnitud,
      profundidad: s.Profundidad,
      ref: s.RefGeografica,
      lat: s.Latitud,
      lon: s.Longitud,
    }));
    setCached('sismos', data);
    res.json({ data, source: 'api.gael.cloud' });
  } catch (e) {
    res.status(502).json({ error: 'No se pudieron obtener los sismos' });
  }
});

// GET /api/chile/feriados — feriados del año (date.nager.at, incluye Chile)
chileRouter.get('/feriados', async (req, res) => {
  const anio = req.query.anio || new Date().getFullYear();
  const cacheKey = 'feriados-' + anio;
  const cached = getCached(cacheKey, 60 * 60 * 1000); // 1 hora
  if (cached) return res.json({ data: cached, source: 'cache' });

  try {
    const r = await fetch('https://date.nager.at/api/v3/PublicHolidays/' + anio + '/CL', {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'autos-cmdspa/1.0' },
    });
    if (!r.ok) throw new Error('date.nager.at no respondió');
    const raw = await r.json();
    const hoy = new Date().toISOString().slice(0, 10);
    const data = (raw || [])
      .filter((f) => f.date >= hoy) // solo futuros
      .slice(0, 8)
      .map((f) => ({
        fecha: f.date,
        nombre: f.localName,
        tipo: f.types && f.types.length ? f.types.join(', ') : 'Feriado',
        irrenunciable: f.global === false,
      }));
    setCached(cacheKey, data);
    res.json({ data, source: 'date.nager.at' });
  } catch (e) {
    res.status(502).json({ error: 'No se pudieron obtener los feriados' });
  }
});
