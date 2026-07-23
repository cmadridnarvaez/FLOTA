// Helpers de validación de input (H1).
// Previene que datos inválidos lleguen a Postgres y causen crashes.
import { pool } from '../db.js';

// Valida que un valor sea un número finito válido
export function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// Valida fecha YYYY-MM-DD
export function fechaValida(v) {
  if (!v || typeof v !== 'string') return undefined;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const d = new Date(v + 'T12:00:00');
  return isNaN(d) ? undefined : v;
}

// Valida monto positivo
export function montoValido(v) {
  const n = num(v);
  if (n === undefined) return undefined;
  return n >= 0 ? n : undefined;
}

// Helper para PUT: construye SET dinámico solo con campos presentes en el body
// Resuelve C2: en vez de COALESCE($N, campo) con undefined, arma dinámicamente
// solo los campos que vienen en el body, permitiendo setear NULL explícitamente.
export function buildUpdate(body, allowedFields) {
  const sets = [];
  const params = [];
  let i = 1;
  for (const [field, transformer] of Object.entries(allowedFields)) {
    if (body[field] !== undefined) {
      const val = transformer ? transformer(body[field]) : body[field];
      // null explícito = borrar el campo. String/Number = setearlo.
      sets.push(`${field} = $${i}`);
      params.push(val === undefined ? null : val);
      i++;
    }
  }
  return { setClause: sets.join(', '), params, nextParamIndex: i };
}

export const CATEGORIAS_VALIDAS = ['combustible', 'seguro', 'patente', 'mantencion', 'peaje', 'repuestos', 'accesorios', 'otro'];
export const TIPOS_DOC_VALIDOS = ['soap', 'permiso_circulacion', 'revision_tecnica', 'seguro', 'registro', 'otro'];
