import { verifyAccessToken } from '../auth.js';
import { pool } from '../db.js';

// Middleware: requiere sesión válida. Carga req.user.
export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) return res.status(401).json({ error: 'No autenticado' });
  req.user = { id: claims.sub, email: claims.email, rol: claims.rol, nombre: claims.nombre };
  next();
}

// Middleware: requiere rol admin
export function requireAdmin(req, res, next) {
  if (req.user?.rol !== 'admin') return res.status(403).json({ error: 'Requiere rol admin' });
  next();
}

// Devuelve los ids de vehículos visibles para el usuario:
//  - admin: NULL = ver todos
//  - usuario: array de ids asignados
export async function vehiculosVisibles(userId, rol) {
  if (rol === 'admin') return null; // null = sin filtro
  const { rows } = await pool.query(
    'SELECT vehiculo_id FROM acceso_vehiculo WHERE usuario_id = $1',
    [userId]
  );
  return rows.map((r) => r.vehiculo_id);
}

// Verifica que el usuario actual pueda acceder a un vehiculo_id
export async function puedeAccederVehiculo(req, vehiculoId) {
  if (req.user.rol === 'admin') return true;
  const { rows } = await pool.query(
    'SELECT 1 FROM acceso_vehiculo WHERE usuario_id = $1 AND vehiculo_id = $2',
    [req.user.id, vehiculoId]
  );
  return rows.length > 0;
}
