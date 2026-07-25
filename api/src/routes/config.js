// ============================================================================
// Configuración por empresa — API keys, proveedor IA y email
// ============================================================================
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { config } from '../config.js';

export const configRouter = Router();
configRouter.use(requireAuth);

function mask(key) {
  if (!key || key.length < 8) return key ? '****' : null;
  return key.slice(0, 3) + '...' + key.slice(-4);
}

// Catálogo de proveedores IA (OpenAI-compatible)
export const AI_PROVIDERS = {
  openai:     { nombre: 'OpenAI',          baseUrl: 'https://api.openai.com/v1',      modelos: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini'] },
  openrouter: { nombre: 'OpenRouter',      baseUrl: 'https://openrouter.ai/api/v1',   modelos: ['anthropic/claude-3.5-sonnet', 'google/gemini-2.5-flash', 'meta-llama/llama-3.3-70b-instruct'] },
  groq:       { nombre: 'Groq (gratis)',   baseUrl: 'https://api.groq.com/openai/v1', modelos: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  ollama:     { nombre: 'Ollama (local)',  baseUrl: 'http://localhost:11434/v1',      modelos: ['llama3.2', 'qwen2.5', 'llava'] },
  custom:     { nombre: 'Personalizado',   baseUrl: '',                                modelos: [] },
};

// Helper: obtener config efectiva de una empresa (propia o fallback del server)
export async function getEmpresaConfig(empresaId) {
  const { rows } = await pool.query('SELECT * FROM empresa_config WHERE empresa_id = $1', [empresaId]);
  const ec = rows[0];
  const provider = ec?.ai_provider || 'openai';
  const providerInfo = AI_PROVIDERS[provider] || AI_PROVIDERS.openai;
  return {
    openai_api_key: ec?.openai_api_key || null,
    ai_provider: provider,
    ai_base_url: ec?.ai_base_url || providerInfo.baseUrl,
    ai_model: ec?.ai_model || 'gpt-4o',
    resend_api_key: ec?.resend_api_key || null,
    resend_from: ec?.resend_from || null,
    resend_to: ec?.resend_to || null,
  };
}

// GET /api/config — muestra config de empresa + estado efectivo (lo que realmente se usa)
configRouter.get('/', requireAdmin, async (req, res) => {
  const empresaId = req.user.empresa_id;
  const { rows } = await pool.query('SELECT * FROM empresa_config WHERE empresa_id = $1', [empresaId]);
  const ec = rows[0];

  // Estado efectivo: ¿qué se está usando realmente?
  const hasOwnOpenAI = !!ec?.openai_api_key;
  const hasServerOpenAI = !!config.openaiApiKey;
  const hasOwnResend = !!ec?.resend_api_key;
  const hasServerResend = !!config.resendApiKey;

  res.json({
    data: {
      // Keys enmascaradas (lo que la empresa configuró)
      openai_api_key: ec?.openai_api_key ? mask(ec.openai_api_key) : null,
      openai_api_key_set: hasOwnOpenAI,
      ai_provider: ec?.ai_provider || 'openai',
      ai_base_url: ec?.ai_base_url || '',
      ai_model: ec?.ai_model || 'gpt-4o',
      resend_api_key: ec?.resend_api_key ? mask(ec.resend_api_key) : null,
      resend_api_key_set: hasOwnResend,
      resend_from: ec?.resend_from || '',
      resend_to: ec?.resend_to || '',

      // Estado efectivo (lo que realmente se usa al analizar/enviar)
      effective: {
        ai_source: hasOwnOpenAI ? 'empresa' : (hasServerOpenAI ? 'server' : 'none'),
        ai_active: hasOwnOpenAI || hasServerOpenAI,
        ai_key_masked: mask(hasOwnOpenAI ? ec.openai_api_key : (hasServerOpenAI ? config.openaiApiKey : null)),
        resend_source: hasOwnResend ? 'empresa' : (hasServerResend ? 'server' : 'none'),
        resend_active: hasOwnResend || hasServerResend,
        resend_key_masked: mask(hasOwnResend ? ec.resend_api_key : (hasServerResend ? config.resendApiKey : null)),
        resend_from: ec?.resend_from || config.alertaFrom || '',
        resend_to: ec?.resend_to || config.alertaTo || '',
      },
    },
    providers: AI_PROVIDERS,
  });
});

// PUT /api/config
configRouter.put('/', requireAdmin, async (req, res) => {
  const empresaId = req.user.empresa_id;
  const b = req.body || {};
  const { rows: existing } = await pool.query('SELECT * FROM empresa_config WHERE empresa_id = $1', [empresaId]);
  const ec = existing[0];

  const openaiKey = b.openai_api_key !== undefined ? (b.openai_api_key || null) : ec?.openai_api_key;
  const aiProvider = b.ai_provider || ec?.ai_provider || 'openai';
  const aiBaseUrl = b.ai_base_url !== undefined ? (b.ai_base_url || null) : ec?.ai_base_url;
  const aiModel = b.ai_model || ec?.ai_model || 'gpt-4o';
  const resendKey = b.resend_api_key !== undefined ? (b.resend_api_key || null) : ec?.resend_api_key;
  const resendFrom = b.resend_from !== undefined ? (b.resend_from || null) : ec?.resend_from;
  const resendTo = b.resend_to !== undefined ? (b.resend_to || null) : ec?.resend_to;

  await pool.query(
    `INSERT INTO empresa_config (empresa_id, openai_api_key, ai_provider, ai_base_url, ai_model, resend_api_key, resend_from, resend_to, actualizado_en)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
     ON CONFLICT (empresa_id) DO UPDATE SET
       openai_api_key = EXCLUDED.openai_api_key,
       ai_provider = EXCLUDED.ai_provider,
       ai_base_url = EXCLUDED.ai_base_url,
       ai_model = EXCLUDED.ai_model,
       resend_api_key = EXCLUDED.resend_api_key,
       resend_from = EXCLUDED.resend_from,
       resend_to = EXCLUDED.resend_to,
       actualizado_en = now()`,
    [empresaId, openaiKey, aiProvider, aiBaseUrl, aiModel, resendKey, resendFrom, resendTo]
  );

  res.json({ ok: true });
});
