// ============================================================================
// Configuración por empresa — API keys y modelo IA
// ============================================================================
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

export const configRouter = Router();
configRouter.use(requireAuth);

// Helper: enmascarar API key (solo últimos 4 chars)
function mask(key) {
  if (!key || key.length < 8) return key ? '****' : null;
  return key.slice(0, 3) + '...' + key.slice(-4);
}

// Helper: obtener config efectiva de una empresa (propia o fallback del server)
export async function getEmpresaConfig(empresaId) {
  const { rows } = await pool.query('SELECT * FROM empresa_config WHERE empresa_id = $1', [empresaId]);
  const ec = rows[0];
  return {
    openai_api_key: ec?.openai_api_key || null,
    openai_model: ec?.openai_model || 'gpt-4o',
    resend_api_key: ec?.resend_api_key || null,
    resend_from: ec?.resend_from || null,
    resend_to: ec?.resend_to || null,
  };
}

// GET /api/config — devuelve config de la empresa (keys enmascaradas)
configRouter.get('/', requireAdmin, async (req, res) => {
  const empresaId = req.user.empresa_id;
  const { rows } = await pool.query('SELECT * FROM empresa_config WHERE empresa_id = $1', [empresaId]);
  const ec = rows[0];

  // Devolver keys enmascaradas + estado (propia vs server default)
  res.json({
    data: {
      openai_api_key: ec?.openai_api_key ? mask(ec.openai_api_key) : null,
      openai_api_key_set: !!ec?.openai_api_key,
      openai_model: ec?.openai_model || 'gpt-4o',
      resend_api_key: ec?.resend_api_key ? mask(ec.resend_api_key) : null,
      resend_api_key_set: !!ec?.resend_api_key,
      resend_from: ec?.resend_from || '',
      resend_to: ec?.resend_to || '',
    },
  });
});

// PUT /api/config — guardar config (solo admin)
configRouter.put('/', requireAdmin, async (req, res) => {
  const empresaId = req.user.empresa_id;
  const b = req.body || {};

  // Si un campo viene vacío, no sobreescribir el existente (salvo que sea explícito)
  const { rows: existing } = await pool.query('SELECT * FROM empresa_config WHERE empresa_id = $1', [empresaId]);
  const ec = existing[0];

  const openaiKey = b.openai_api_key !== undefined ? (b.openai_api_key || null) : ec?.openai_api_key;
  const openaiModel = b.openai_model || ec?.openai_model || 'gpt-4o';
  const resendKey = b.resend_api_key !== undefined ? (b.resend_api_key || null) : ec?.resend_api_key;
  const resendFrom = b.resend_from !== undefined ? (b.resend_from || null) : ec?.resend_from;
  const resendTo = b.resend_to !== undefined ? (b.resend_to || null) : ec?.resend_to;

  await pool.query(
    `INSERT INTO empresa_config (empresa_id, openai_api_key, openai_model, resend_api_key, resend_from, resend_to, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (empresa_id) DO UPDATE SET
       openai_api_key = EXCLUDED.openai_api_key,
       openai_model = EXCLUDED.openai_model,
       resend_api_key = EXCLUDED.resend_api_key,
       resend_from = EXCLUDED.resend_from,
       resend_to = EXCLUDED.resend_to,
       actualizado_en = now()`,
    [empresaId, openaiKey, openaiModel, resendKey, resendFrom, resendTo]
  );

  res.json({ ok: true });
});
