// Wrapper para handlers async de Express 4.
// Express 4 no captura promesas rechazadas automáticamente.
// Esto asegura que cualquier throw/reject llegue al middleware de errores.
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
