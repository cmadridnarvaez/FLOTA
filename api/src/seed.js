import bcrypt from 'bcryptjs';
import fs from 'fs';
import { pool } from './db.js';
import { config } from './config.js';

// Reemplaza el hash placeholder del admin por un hash bcrypt real.
// Si ADMIN_PASSWORD viene en el entorno, lo usa; si no, genera uno aleatorio
// y lo imprime en los logs UNA sola vez (para que el operador lo recupere).
export async function ensureAdminSeed() {
  const adminEmail = (process.env.ADMIN_EMAIL || 'cmadrid@cmdspa.com').toLowerCase();
  const { rows } = await pool.query("SELECT * FROM usuarios WHERE lower(email) = lower($1)", [adminEmail]);
  const admin = rows[0];

  if (!admin) {
    console.warn(`[seed] No se encontró admin '${adminEmail}'. Se creará.`);
  const pass = config.adminPassword || generarPass();
    const hash = await bcrypt.hash(pass, 10);
    await pool.query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol, activo)
       VALUES ($1, $2, $3, 'admin', TRUE)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [adminEmail, process.env.ADMIN_NOMBRE || 'Administrador', hash]
    );
    if (!config.adminPassword) {
      // L12: no imprimir la contraseña en logs persistentes. Escribir a archivo efímero.
      const f = '/tmp/.admin-onetime';
      fs.writeFileSync(f, `${adminEmail}:${pass}\n`, { mode: 0o600 });
      console.log(`[seed] Admin creado. Credencial temporal en ${f} (leer y borrar).`);
    }
    return;
  }

  // Si la app ya fijó el hash (no es placeholder), respetar — salvo que venga ADMIN_PASSWORD
  if (!admin.password_hash.startsWith('__') && !config.adminPassword) return;

  const pass = config.adminPassword || generarPass();
  const hash = await bcrypt.hash(pass, 10);
  await pool.query('UPDATE usuarios SET password_hash = $1 WHERE id = $2', [hash, admin.id]);
  if (config.adminPassword) {
    console.log(`[seed] Contraseña del admin '${adminEmail}' fijada desde ADMIN_PASSWORD`);
  } else {
    // L12: escribir a archivo efímero, no a logs persistentes
    const f = '/tmp/.admin-onetime';
    fs.writeFileSync(f, `${adminEmail}:${pass}\n`, { mode: 0o600 });
    console.log(`[seed] Admin actualizado. Credencial temporal en ${f} (leer y borrar).`);
  }
}

function generarPass(len = 16) {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}

// Cargar config.adminPassword si está en entorno
config.adminPassword = process.env.ADMIN_PASSWORD || '';
