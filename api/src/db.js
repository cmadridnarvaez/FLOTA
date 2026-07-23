import pg from 'pg';

const { Pool } = pg;

// PostgreSQL devuelve BIGINT/BIGSERIAL como strings por defecto (pueden exceder
// el rango seguro de Number). Para esta app los IDs nunca exceden int32, así que
// los parseamos a número para que el frontend JS los maneje sin mismatch de tipos.
pg.types.setTypeParser(pg.types.builtins.INT8, (val) => (val === null ? null : Number(val)));

// Devolver fechas como strings (no como objetos Date de JS que se rompen en JSON).
// DATE → "2026-07-18", TIMESTAMPTZ → "2026-07-20 11:47:15.877-04" (legible)
pg.types.setTypeParser(pg.types.builtins.DATE, (val) => val);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (val) => val);
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (val) => val);

export const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'autos',
  user: process.env.DB_USER || 'autos',
  password: process.env.DB_PASSWORD || 'autos',
  // Pool conservador: es una app de pocos usuarios
  max: 8,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('[db] error inesperado en pool pg:', err.message);
});
