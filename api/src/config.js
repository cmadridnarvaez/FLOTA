// Configuración central. Todas las variables vienen del entorno (.env en docker-compose).

// Fail-fast: en producción no arrancar sin los secretos obligatorios (M3)
if (!process.env.JWT_SECRET) {
  console.error('[config] FATAL: JWT_SECRET no definido en el entorno. Rehusando arrancar.');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET,
  jwtAccessTtl: process.env.JWT_ACCESS_TTL || '15m',
  jwtRefreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  // boostr
  boostrApiKey: process.env.BOOSTR_API_KEY || '', // vacío = deshabilitado
  // storage
  storageDir: process.env.STORAGE_DIR || '/data/storage',
  // Resend (email alertas)
  resendApiKey: process.env.RESEND_API_KEY || '',
  alertaFrom: process.env.ALERTA_FROM || 'flota@tudominio.com',
  alertaTo: process.env.ALERTA_TO || '',
  // OpenAI (análisis de documentos con GPT-4o Vision)
  openaiApiKey: process.env.OPENAI_API_KEY || '',
};

export const TIPOS_DOCUMENTO = {
  soap: 'SOAP',
  permiso_circulacion: 'Permiso de Circulación',
  revision_tecnica: 'Revisión Técnica',
  seguro: 'Seguro',
  registro: 'Registro',
  otro: 'Otro',
};

export const CATS_GASTO = {
  combustible: 'Combustible',
  seguro: 'Seguro',
  patente: 'Patente',
  mantencion: 'Mantención',
  peaje: 'Peaje',
  otro: 'Otro',
};
