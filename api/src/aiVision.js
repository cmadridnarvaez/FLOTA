// ============================================================================
// Análisis de documentos vehiculares con OpenAI GPT-4o Vision
// Recibe la ruta de un archivo de imagen/PDF, lo envía a GPT-4o y devuelve
// los datos estructurados del documento (tipo, vence, patente, etc.)
// ============================================================================
import fs from 'fs';
import { config } from './config.js';

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

export async function analizarDocumento(filePath, mimeType) {
  if (!config.openaiApiKey) {
    throw new Error('Análisis IA no disponible: OPENAI_API_KEY no configurada');
  }

  // Leer archivo
  let buffer = fs.readFileSync(filePath);
  let mime = mimeType || 'image/jpeg';

  // GPT-4o Vision NO acepta PDFs directamente. Convertir PDF a imagen.
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

  const body = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analiza este documento vehicular chileno y extrae los datos.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
        ],
      },
    ],
    max_tokens: 500,
    temperature: 0.1, // determinístico para extracción de datos
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + config.openaiApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!r.ok) {
    const errText = await r.text();
    console.error('[aiVision] OpenAI error:', r.status, errText.slice(0, 200));
    if (r.status === 429) {
      if (errText.includes('quota') || errText.includes('billing')) {
        throw new Error('La cuenta de OpenAI no tiene saldo. Recarga créditos en platform.openai.com');
      }
      throw new Error('OpenAI rate limit. Reintenta en unos segundos.');
    }
    throw new Error('Error al contactar OpenAI (HTTP ' + r.status + ')');
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
