// ============================================================================
// Notificador de vencimientos por email vía Resend
// Detecta documentos por vencer y envía alertas con dedupe anti-spam.
// ============================================================================
import { pool } from './db.js';
import { config } from './config.js';
import { getEmpresaConfig } from './routes/config.js';

const TIPOS_DOC = {
  soap: 'SOAP',
  permiso_circulacion: 'Permiso de Circulación',
  revision_tecnica: 'Revisión Técnica',
  seguro: 'Seguro',
  registro: 'Registro',
  otro: 'Otro',
};

// Ventanas de aviso: tipo → días antes del vencimiento
const VENTANAS = [
  { tipo: '30d', dias: 30, label: '🟡 Alerta temprana', color: '#fbbf24', urgencia: '30 días' },
  { tipo: '14d', dias: 14, label: '🟠 Alerta urgente', color: '#f97316', urgencia: '14 días' },
  { tipo: '7d', dias: 7, label: '🔴 Última oportunidad', color: '#ef4444', urgencia: '7 días' },
  { tipo: 'vencido', dias: 0, label: '❌ Vencido', color: '#dc2626', urgencia: 'vencido' },
];

// ----------------------------------------------------------------------------
// Query: detectar documentos que necesitan alerta HOY (sin haber sido enviados)
// ----------------------------------------------------------------------------
async function detectarPendientes() {
  const condiciones = VENTANAS.map((v) => {
    if (v.tipo === 'vencido') {
      return `WHEN d.vence = CURRENT_DATE AND NOT EXISTS (SELECT 1 FROM alerta_envios ae WHERE ae.documento_id = d.id AND ae.tipo_aviso = 'vencido') THEN 'vencido'`;
    }
    return `WHEN d.vence = CURRENT_DATE + ${v.dias} AND NOT EXISTS (SELECT 1 FROM alerta_envios ae WHERE ae.documento_id = d.id AND ae.tipo_aviso = '${v.tipo}') THEN '${v.tipo}'`;
  }).join('\n            ');

  const { rows } = await pool.query(`
    SELECT d.id as doc_id, d.tipo, d.descripcion, d.vence,
           v.id as vehiculo_id, v.nombre as veh_nombre, v.patente,
           CASE
            ${condiciones}
           END as tipo_aviso
    FROM documentos d
    JOIN vehiculos v ON v.id = d.vehiculo_id
    WHERE d.vence IS NOT NULL
      AND (
        ${VENTANAS.map((v) => v.tipo === 'vencido'
          ? `d.vence = CURRENT_DATE`
          : `d.vence = CURRENT_DATE + ${v.dias}`
        ).join(' OR ')}
      )
      AND CASE ${condiciones} END IS NOT NULL
    ORDER BY d.vence ASC
  `);

  return rows.filter((r) => r.tipo_aviso); // solo los que tienen un tipo asignado
}

// ----------------------------------------------------------------------------
// Template HTML del email
// ----------------------------------------------------------------------------
function templateHTML(alertas) {
  const total = alertas.length;
  const vencidos = alertas.filter((a) => a.tipo_aviso === 'vencido').length;
  const urgentes = alertas.filter((a) => a.tipo_aviso === '7d' || a.tipo_aviso === '14d').length;

  const filas = alertas.map((a) => {
    const ventana = VENTANAS.find((v) => v.tipo === a.tipo_aviso);
    const color = ventana?.color || '#6b7280';
    const label = ventana?.label || a.tipo_aviso;
    const fecha = new Date(a.vence).toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const tipoNombre = TIPOS_DOC[a.tipo] || a.tipo;

    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
          <div style="font-weight:600;color:#111827;font-size:14px;">${esc(a.veh_nombre)}</div>
          <div style="color:#6b7280;font-size:12px;">${esc(a.patente || 'sin patente')}</div>
        </td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;">${esc(tipoNombre)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;">${fecha}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;">
          <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${color}20;color:${color};">${label}</span>
        </td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f6fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb;padding:20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#0e1320;padding:24px 32px;">
            <div style="font-family:'Orbitron',sans-serif;font-size:18px;font-weight:700;color:#00eaff;letter-spacing:0.05em;">CMD SERVICIOS TECNOLÓGICOS SpA</div>
            <div style="color:#7c89a8;font-size:13px;margin-top:4px;">Sistema de Gestión de Flota Vehicular</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <h1 style="margin:0 0 8px;font-size:22px;color:#111827;">🚨 Alerta de Vencimientos</h1>
            <p style="margin:0 0 20px;color:#4b5563;font-size:15px;line-height:1.6;">
              Tienes <strong style="color:#111827;">${total} documento${total !== 1 ? 's' : ''}</strong>
              ${vencidos > 0 ? `<span style="color:#dc2626;font-weight:600;">(${vencidos} vencido${vencidos !== 1 ? 's' : ''})</span>` : ''}
              ${urgentes > 0 ? `<span style="color:#f97316;font-weight:600;">(${urgentes} urgente${urgentes !== 1 ? 's' : ''})</span>` : ''}
              que requieren atención.
            </p>

            <!-- Tabla de documentos -->
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
              <thead>
                <tr style="background:#f9fafb;">
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.04em;">Vehículo</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.04em;">Documento</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.04em;">Vence</th>
                  <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6b7280;letter-spacing:0.04em;">Estado</th>
                </tr>
              </thead>
              <tbody>${filas}</tbody>
            </table>

            <!-- CTA -->
            <div style="margin-top:24px;text-align:center;">
              <a href="https://autos.cmdspa.com" style="display:inline-block;background:#00eaff;color:#001018;font-weight:700;font-size:14px;padding:12px 32px;border-radius:8px;text-decoration:none;">Ver flota completa</a>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f9fafb;padding:16px 32px;border-top:1px solid #e5e7eb;">
            <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
              Este es un mensaje automático del sistema de gestión de flota de CMD Servicios Tecnológicos SpA.<br>
              Las alertas se envían 30 días, 14 días y 7 días antes del vencimiento, y el día que vence.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ----------------------------------------------------------------------------
// Enviar email vía Resend API (con fallback a config de empresa)
// ----------------------------------------------------------------------------
async function enviarEmail(html, asunto, empresaId) {
  // Resolver keys: empresa_config → server .env
  let apiKey = config.resendApiKey;
  let from = config.alertaFrom;
  let to = config.alertaTo;
  if (empresaId) {
    try {
      const ec = await getEmpresaConfig(empresaId);
      if (ec.resend_api_key) apiKey = ec.resend_api_key;
      if (ec.resend_from) from = ec.resend_from;
      if (ec.resend_to) to = ec.resend_to;
    } catch {}
  }
  if (!apiKey || !from || !to) {
    console.log('[notifier] Resend no configurado — saltando envío');
    return { skipped: true };
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: from,
      to: to,
      subject: asunto,
      html: html,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error('Resend API error ' + r.status + ': ' + err);
  }

  const data = await r.json();
  return data;
}

// ----------------------------------------------------------------------------
// Función principal: detectar + enviar + registrar
// ----------------------------------------------------------------------------
export async function revisarYEnviar() {
  const pendientes = await detectarPendientes();

  if (pendientes.length === 0) {
    console.log('[notifier] Sin documentos pendientes de alerta');
    return { enviados: 0, pendientes: 0 };
  }

  console.log(`[notifier] ${pendientes.length} documento(s) requieren alerta`);

  // H4: INSERT en alerta_envios ANTES de enviar email (previene race condition)
  // Si dos procesos corren concurrentes, solo uno logrará el INSERT (UNIQUE constraint)
  const realmentePendientes = [];
  for (const p of pendientes) {
    try {
      await pool.query(
        'INSERT INTO alerta_envios (documento_id, tipo_aviso) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id',
        [p.doc_id, p.tipo_aviso]
      ).then((r) => { if (r.rows.length > 0) realmentePendientes.push(p); });
    } catch { /* si falla el INSERT, no enviar */ }
  }

  if (realmentePendientes.length === 0) {
    console.log('[notifier] Alertas ya enviadas por otro proceso (dedupe)');
    return { enviados: 0, pendientes: 0 };
  }

  // Agrupar por tipo de aviso para el asunto
  const tieneVencido = realmentePendientes.some((p) => p.tipo_aviso === 'vencido');
  const tiene7d = realmentePendientes.some((p) => p.tipo_aviso === '7d');

  let asunto = '🚨 Alerta de Vencimientos — Flota CMD';
  if (tieneVencido) asunto = `❌ ${realmentePendientes.length} documento(s) VENCIDO(S) — Requiere acción inmediata`;
  else if (tiene7d) asunto = `🔴 ${realmentePendientes.length} documento(s) por vencer en 7 días`;

  // Enviar email
  const html = templateHTML(realmentePendientes);
  const result = await enviarEmail(html, asunto);

  console.log('[notifier] Email enviado a', config.alertaTo, '· ID:', result.id || 'skip');
  return { enviados: pendientes.length, pendientes: pendientes.length, emailId: result.id };
}

// ----------------------------------------------------------------------------
// Email de prueba (para verificar configuración)
// ----------------------------------------------------------------------------
export async function enviarEmailPrueba() {
  const sample = [{
    veh_nombre: 'Audi A3 (ejemplo)',
    patente: 'DPFZ72',
    tipo: 'permiso_circulacion',
    vence: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    tipo_aviso: '7d',
  }];

  const html = templateHTML(sample);
  const result = await enviarEmail(html, '🧪 Email de prueba — Sistema de Alertas CMD');
  return result;
}
