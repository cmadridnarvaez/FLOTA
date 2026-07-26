// ============================================================================
// Análisis de documentos vehiculares con IA (cualquier API OpenAI-compatible:
// OpenAI, OpenRouter, Groq, Ollama u otro endpoint definido por la empresa).
// Recibe la ruta de un archivo de imagen/PDF, lo envía al modelo con visión
// y devuelve los datos estructurados del documento (tipo, vence, patente...)
// ============================================================================
import fs from 'fs';
import { config } from './config.js';
import { getEmpresaConfig, AI_PROVIDERS } from './routes/config.js';

const TIPOS_VALIDOS = ['soap', 'permiso_circulacion', 'revision_tecnica', 'seguro', 'registro', 'otro'];

const SYSTEM_PROMPT = `Eres un asistente experto en documentos vehiculares de Chile.
Analiza la imagen del documento y extrae la siguiente información.

Responde ÚNICAMENTE con un objeto JSON válido (sin markdown, sin texto adicional) con esta estructura exacta:
{
  "tipo": "soap" | "permiso_circulacion" | "revision_tecnica" | "seguro" | "registro" | "otro",
  "vence": "YYYY-MM-DD" o null,
  "descripcion": "descripción breve del documento",
  "patente": "patente visible" o null,
  "titular": "nombre del titular" o null,
  "vin": "VIN/chasis visible" o null,
  "marca": "marca del vehículo" o null,
  "confianza": "alta" | "media" | "baja"
}

Reglas:
- "tipo": SOAP = Seguro Obligatorio de Accidentes Personales. permiso_circulacion = Permiso de Circulación municipal. revision_tecnica = Revisión Técnica o certificado de emisiones. seguro = Póliza de seguro voluntario. registro = Inscripción/Padrón del Registro Civil. otro = cualquier otro documento.
- "vence": fecha de vencimiento en formato YYYY-MM-DD. Si el documento no tiene vencimiento, usa null.
- "descripcion": máximo 80 caracteres, describiendo qué es el documento.
- Si la imagen no es un documento vehicular, responde {"tipo": "otro", "confianza": "baja", "descripcion": "No parece un documento vehicular"}.
- Si no puedes leer algún campo, pon null.`;

// Resuelve la configuración IA efectiva de una empresa:
// empresa_config (DB) → fallback del server (.env) solo para provider OpenAI.
// NUNCA se envía la OPENAI_API_KEY del servidor a un provider distinto de OpenAI.
export async function resolverConfigIA(empresaId) {
  let ec = {};
  if (empresaId) {
    try { ec = await getEmpresaConfig(empresaId); } catch {}
  }
  const provider = ec.ai_provider || 'openai';
  const providerInfo = AI_PROVIDERS[provider] || AI_PROVIDERS.openai;
  const baseUrl = (provider === 'custom')
    ? (ec.ai_base_url || '')
    : (providerInfo.baseUrl || ec.ai_base_url || '');
  const modelo = ec.ai_model || providerInfo.modelos[0] || 'gpt-4o';
  const apiKey = ec.openai_api_key || (provider === 'openai' ? config.openaiApiKey : '');
  return {
    provider,
    nombre: providerInfo.nombre || provider,
    baseUrl: baseUrl.replace(/\/$/, ''),
    modelo,
    apiKey,
    requiereKey: !providerInfo.sinKey,
  };
}

// ¿La empresa puede usar el análisis IA con su config actual?
export async function iaDisponible(empresaId) {
  const c = await resolverConfigIA(empresaId);
  return !!(c.baseUrl && (c.apiKey || !c.requiereKey));
}

export async function analizarDocumento(filePath, mimeType, empresaId) {
  const ia = await resolverConfigIA(empresaId);
  if (!ia.baseUrl) {
    throw new Error('Análisis IA no disponible. Configura la URL del proveedor en Configuración.');
  }
  if (ia.requiereKey && !ia.apiKey) {
    throw new Error('Análisis IA no disponible. Configura tu API key de ' + ia.nombre + ' en Configuración.');
  }

  // Leer archivo
  let buffer = fs.readFileSync(filePath);
  let mime = mimeType || 'image/jpeg';

  // Los endpoints de visión no aceptan PDFs directamente. Convertir PDF a imagen.
  if (mime === 'application/pdf' || filePath.toLowerCase().endsWith('.pdf')) {
    const { execFileSync } = await import('child_process');
    const outPrefix = filePath.replace(/\.pdf$/i, '') + '_page1';
    try {
      execFileSync('pdftoppm', ['-png', '-f', '1', '-l', '1', '-r', '200', filePath, outPrefix], { timeout: 15000 });
      // pdftoppm genera archivos como archivo_page1-1.png
      const convertedFile = outPrefix + '-1.png';
      if (!fs.existsSync(convertedFile)) {
        // Algunas versiones nombran distinto
        const dir = require('path').dirname(filePath);
        const files = fs.readdirSync(dir).filter(f => f.startsWith(require('path').basename(outPrefix)) && f.endsWith('.png'));
        if (files.length === 0) throw new Error('No se pudo convertir el PDF');
        buffer = fs.readFileSync(require('path').join(dir, files[0]));
      } else {
        buffer = fs.readFileSync(convertedFile);
      }
      mime = 'image/png';
    } catch (e) {
      console.error('[aiVision] PDF conversion error:', e.message);
      throw new Error('No se pudo convertir el PDF a imagen. Intenta subir una foto del documento.');
    }
  }

  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mime};base64,${base64}`;

  // "detail: high" es un parámetro específico de OpenAI; otros providers lo omiten
  const imagePayload = { url: dataUrl };
  if (ia.provider === 'openai') imagePayload.detail = 'high';

  const body = {
    model: ia.modelo,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analiza este documento vehicular chileno y extrae los datos.' },
          { type: 'image_url', image_url: imagePayload },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.1,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (ia.apiKey) headers.Authorization = 'Bearer ' + ia.apiKey;
  // Headers opcionales recomendados por OpenRouter (ranking de apps)
  if (ia.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/cmadridnarvaez/FLOTA';
    headers['X-Title'] = 'FLOTA';
  }

  const r = await fetch(ia.baseUrl + '/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('[aiVision] ' + ia.nombre + ' error:', r.status, errText.slice(0, 200));
    if (r.status === 401 || r.status === 403) {
      throw new Error('API key de ' + ia.nombre + ' inválida o sin permisos. Revísala en Configuración.');
    }
    if (r.status === 429) {
      if (errText.includes('quota') || errText.includes('billing') || errText.includes('insufficient')) {
        throw new Error('La cuenta de ' + ia.nombre + ' no tiene saldo/créditos disponibles.');
      }
      throw new Error(ia.nombre + ' rate limit. Reintenta en unos segundos.');
    }
    throw new Error('Error al contactar ' + ia.nombre + ' (HTTP ' + r.status + ')');
  }

  const data = await r.json();
  const content = data.choices?.[0]?.message?.content || '';

  // Parsear el JSON de la respuesta (GPT puede añadir markdown)
  let resultado;
  try {
    // Limpiar markdown si existe (```json ... ```)
    const limpio = content.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    resultado = JSON.parse(limpio);
  } catch {
    console.error('[aiVision] No se pudo parsear respuesta:', content.slice(0, 200));
    throw new Error('No se pudo interpretar el documento. Intenta con otra foto.');
  }

  // Validar tipo contra los valores permitidos
  if (resultado.tipo && !TIPOS_VALIDOS.includes(resultado.tipo)) {
    resultado.tipo = 'otro';
  }

  return resultado;
}
