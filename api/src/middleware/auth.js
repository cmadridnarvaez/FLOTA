import { verifyAccessToken } from '../auth.js';
import { pool } from '../db.js';

// Middleware: requiere sesión válida. Carga req.user.
export function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const claims = token ? verifyAccessToken(token) : null;
  if (!claims) return res.status(401).json({ error: 'No autenticado' });
  req.user = {
    id: claims.sub,
    email: claims.email,
    rol: claims.rol,
    nombre: claims.nombre,
    empresa_id: claims.empresa_id,
  };
  next();
}

// Middleware: requiere rol admin o super_admin
export function requireAdmin(req, res, next) {
  if (req.user?.rol !== 'admin' && req.user?.rol !== 'super_admin') {
    return res.status(403).json({ error: 'Requiere rol admin' });
  }
  next();
}

// Middleware: requiere rol super_admin (gestión de empresas)
export function requireSuperAdmin(req, res, next) {
  if (req.user?.rol !== 'super_admin') return res.status(403).json({ error: 'Requiere rol super_admin' });
  next();
}

// Devuelve los ids de vehículos visibles para el usuario:
//  - super_admin: NULL = ver todos (todas las empresas)
//  - admin: NULL con filtro de empresa aplicado por el caller
//  - usuario: array de ids asignados dentro de su empresa
export async function vehiculosVisibles(userId, rol, empresaId) {
  if (rol === 'super_admin') return null; // ve todo

  if (rol === 'admin') {
    // Solo vehículos de su empresa
    const { rows } = await pool.query(
      'SELECT id FROM vehiculos WHERE empresa_id = $1',
      [empresaId]
    );
    return rows.map((r) => r.id);
  }

  // usuario normal: vehículos asignados dentro de su empresa
  const { rows } = await pool.query(
    `SELECT av.vehiculo_id FROM acceso_vehiculo av
     JOIN vehiculos v ON v.id = av.vehiculo_id
     WHERE av.usuario_id = $1 AND v.empresa_id = $2`,
    [userId, empresaId]
  );
  return rows.map((r) => r.vehiculo_id);
}

// Verifica que el usuario actual pueda acceder a un vehiculo_id
export async function puedeAccederVehiculo(req, vehiculoId) {
  if (req.user.rol === 'super_admin') return true;

  if (req.user.rol === 'admin') {
    // Verificar que el vehículo pertenece a su empresa
    const { rows } = await pool.query(
      'SELECT 1 FROM vehiculos WHERE id = $1 AND empresa_id = $2',
      [vehiculoId, req.user.empresa_id]
    );
    return rows.length > 0;
  }

  // usuario normal: acceso asignado dentro de su empresa
  const { rows } = await pool.query(
    `SELECT 1 FROM acceso_vehiculo av
     JOIN vehiculos v ON v.id = av.vehiculo_id
     WHERE av.usuario_id = $1 AND av.vehiculo_id = $2 AND v.empresa_id = $3`,
    [req.user.id, vehiculoId, req.user.empresa_id]
  );
  return rows.length > 0;
}
