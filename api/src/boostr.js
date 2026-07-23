// Cliente de consulta de patentes Chile.
// Fuente principal: AutoRiesgo (api.autoriesgo.cl) — gratuita, sin API key.
// Fallback: Boostr (api.boostr.cl) — requiere API key (BOOSTR_API_KEY en .env).
// Rate limit AutoRiesgo: 1 consulta cada 60s por patente+IP. Gestionado acá.

import { config } from './config.js';

// Cache en memoria de consultas por patente (60s = rate limit de AutoRiesgo)
const cacheLookup = new Map();
const TTL_CACHE = 60 * 1000;

// Throttle: AutoRiesgo permite 1 consulta cada 60s por patente+IP.
// Controlamos que no se haga spam desde la app.
let ultimaConsultaTs = 0;
const MIN_ENTRE_CONSULTAS = 5000; // 5s mínimo entre consultas desde la app

function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Normaliza respuesta al formato interno de la app
function normalizar(source, raw) {
  if (source === 'autoriesgo') {
    const d = raw?.vehicle_data?.data || raw?.data || {};
    return {
      marca: d.make || null,
      modelo: d.model || null,
      anio: d.year ? Number(d.year) : null,
      vin: d.chassis || d.vin || null,
      motor: d.engine || null,
      color: d.color || null,
      titular: d.owner?.fullname || null,
      tipo_vehiculo: d.type || null,
      combustible: d.gas_type || null,
      kilometraje: d.kilometers || null,
      revision_tecnica: d.prt ? {
        vence: d.prt.due_date || null,
        estado: d.prt.status || null,
        gases_vence: d.prt.gases_due_date || null,
        gases_estado: d.prt.gases_status || null,
      } : null,
      fuente: 'autoriesgo',
      crudo: raw,
    };
  }
  if (source === 'boostr') {
    const d = raw?.data || raw || {};
    return {
      marca: d.make || null,
      modelo: d.model || null,
      anio: d.year ? Number(d.year) : null,
      vin: d.vin || null,
      motor: d.engine || null,
      color: d.color || null,
      titular: d.owner?.fullname || null,
      tipo_vehiculo: d.type || null,
      combustible: d.gas_type || null,
      kilometraje: d.kilometers || null,
      fuente: 'boostr',
      crudo: raw,
    };
  }
  return {};
}

export async function lookupPatente(patente) {
  // Throttle
  const ahora = Date.now();
  const espera = Math.max(0, MIN_ENTRE_CONSULTAS - (ahora - ultimaConsultaTs));
  if (espera > 0) await esperar(espera);
  ultimaConsultaTs = Date.now();

  // Cache
  const cached = cacheLookup.get(patente);
  if (cached && Date.now() - cached.ts < TTL_CACHE) return cached.data;

  // Fuente 1: AutoRiesgo (gratuita, sin key)
  try {
    const url = `https://api.autoriesgo.cl/api/v1/report/lookup?patente=${encodeURIComponent(patente)}`;
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'User-Agent': 'autos-cmdspa/1.0' },
      signal: AbortSignal.timeout(12000),
    });
    if (r.status === 429) {
      const retry = r.headers.get('Retry-After') || 60;
      throw new Error(`Rate limit AutoRiesgo. Reintenta en ${retry}s`);
    }
    if (r.ok) {
      const raw = await r.json();
      const data = normalizar('autoriesgo', raw);
      if (data.marca || data.vin || data.motor) {
        cacheLookup.set(patente, { data, ts: Date.now() });
        return data;
      }
    }
  } catch (e) {
    // Si es rate limit, propagar el error
    if (e.message?.includes('Rate limit')) throw e;
    // Si no, continuar al fallback
  }

  // Fuente 2: Boostr (requiere API key)
  if (config.boostrApiKey) {
    try {
      const url = `https://api.boostr.cl/vehicle/${encodeURIComponent(patente)}.json`;
      const r = await fetch(url, {
        headers: {
          accept: 'application/json',
          'User-Agent': 'autos-cmdspa/1.0',
          'X-API-KEY': config.boostrApiKey,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (r.status === 404) throw new Error('Patente no encontrada');
      if (r.status === 429) throw new Error('Rate limit Boostr excedido');
      if (r.ok) {
        const raw = await r.json();
        const data = normalizar('boostr', raw);
        cacheLookup.set(patente, { data, ts: Date.now() });
        return data;
      }
      throw new Error(`Boostr HTTP ${r.status}`);
    } catch (e) {
      if (e.message?.includes('no encontrada')) throw e;
      // Si Boostr también falla y AutoRiesgo no respondió nada
    }
  }

  throw new Error('No se pudo consultar la patente. Intenta nuevamente en unos segundos.');
}
