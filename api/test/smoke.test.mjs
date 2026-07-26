// Smoke tests — sin Postgres ni red real (mock de pool.query + mock HTTP).
// Corren con: npm test  (desde api/). No requiere .env.
process.env.JWT_SECRET = process.env.JWT_SECRET || 'smoke-test';
process.env.OPENAI_API_KEY = 'sk-server-openai';

import http from 'http';
import fs from 'fs';

// Imports dinámicos para que el default de env de arriba aplique antes de
// cargar config.js (que hace fail-fast si falta JWT_SECRET).
const { resolverConfigIA, iaDisponible, analizarDocumento, probarConfigIA } =
  await import('../src/aiVision.js');
const { pool } = await import('../src/db.js');

let passed = 0, failed = 0;
const ok = (name, cond) => {
  if (cond) { passed++; console.log('  \u2713', name); }
  else { failed++; console.log('  \u2717 FALLA:', name); }
};
const mockDb = (row) => { pool.query = async () => ({ rows: row ? [row] : [] }); };

// ---------------------------------------------------------------------------
console.log('Resolver de config multi-provider:');
mockDb(null);
let c = await resolverConfigIA(1);
ok('sin config → provider openai', c.provider === 'openai');
ok('sin config → fallback key servidor (openai)', c.apiKey === 'sk-server-openai');
ok('sin config → disponible', await iaDisponible(1) === true);

mockDb({ ai_provider: 'openrouter', openai_api_key: 'sk-or-123', ai_model: null });
c = await resolverConfigIA(1);
ok('openrouter → baseUrl', c.baseUrl === 'https://openrouter.ai/api/v1');
ok('openrouter → key propia', c.apiKey === 'sk-or-123');
ok('openrouter → modelo default con prefijo', c.modelo === 'openai/gpt-4o-mini');

mockDb({ ai_provider: 'openrouter', openai_api_key: null });
c = await resolverConfigIA(1);
ok('SEGURIDAD: openrouter sin key NO recibe key del server', c.apiKey === '');
ok('openrouter sin key → no disponible', await iaDisponible(1) === false);

mockDb({ ai_provider: 'ollama', openai_api_key: null });
c = await resolverConfigIA(1);
ok('ollama → no requiere key', c.requiereKey === false);
ok('ollama → disponible sin key', await iaDisponible(1) === true);
ok('ollama → host.docker.internal', c.baseUrl === 'http://host.docker.internal:11434/v1');

mockDb({ ai_provider: 'custom', ai_base_url: 'https://llm.local/v1/', openai_api_key: null, ai_model: 'm' });
c = await resolverConfigIA(1);
ok('custom → baseUrl sin slash final', c.baseUrl === 'https://llm.local/v1');
ok('custom con URL → disponible', await iaDisponible(1) === true);

mockDb({ ai_provider: 'custom', ai_base_url: null });
ok('custom sin URL → no disponible', await iaDisponible(1) === false);

// ---------------------------------------------------------------------------
// Mock HTTP server (endpoint OpenAI-compatible)
function mockServer(port, status, payload) {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      lastReq = { headers: req.headers, body: body ? JSON.parse(body) : {} };
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });
}
let lastReq = null;

console.log('analizarDocumento (mock endpoint):');
const PORT = 18930;
fs.writeFileSync('/tmp/smoke-doc.jpg', Buffer.from('ffd8ffe000104a4649460000', 'hex'));

const srv = mockServer(PORT, 200, {
  choices: [{ message: { content: '```json\n{"tipo":"soap","vence":"2026-03-01","descripcion":"SOAP 2026","patente":"ABCD12","titular":"Juan","vin":null,"marca":"Toyota","confianza":"alta"}\n```' } }],
});
await new Promise((r) => srv.listen(PORT, r));

mockDb({ ai_provider: 'custom', openai_api_key: 'sk-x', ai_model: 'gpt-4o-mini', ai_base_url: 'http://127.0.0.1:' + PORT + '/v1' });
const r = await analizarDocumento('/tmp/smoke-doc.jpg', 'image/jpeg', 1);
ok('parsea respuesta (limpia markdown)', r.tipo === 'soap' && r.vence === '2026-03-01');
ok('Authorization enviado', lastReq.headers.authorization === 'Bearer sk-x');
ok('sin detail para provider no-openai', lastReq.body.messages[1].content[1].image_url.detail === undefined);
ok('modelo enviado', lastReq.body.model === 'gpt-4o-mini');

mockDb({ ai_provider: 'custom', openai_api_key: null, ai_model: 'llava', ai_base_url: 'http://127.0.0.1:' + PORT + '/v1' });
await analizarDocumento('/tmp/smoke-doc.jpg', 'image/jpeg', 1);
ok('sin key → sin Authorization', !lastReq.headers.authorization);

// Error del provider → mensaje con nombre
const srv401 = mockServer(PORT + 1, 401, { error: 'bad' });
await new Promise((r) => srv401.listen(PORT + 1, r));
mockDb({ ai_provider: 'custom', openai_api_key: 'mala', ai_model: 'x', ai_base_url: 'http://127.0.0.1:' + (PORT + 1) + '/v1' });
try { await analizarDocumento('/tmp/smoke-doc.jpg', 'image/jpeg', 1); ok('401 → lanza', false); }
catch (e) { ok('401 → error con nombre del provider', e.message.includes('Personalizado')); }

// ---------------------------------------------------------------------------
console.log('probarConfigIA (mock endpoint):');
// Reusa el srv (200) del paso anterior
let probe = await probarConfigIA({ provider: 'custom', baseUrl: 'http://127.0.0.1:' + PORT + '/v1', modelo: 'gpt-4o-mini', apiKey: 'sk-x' });
ok('probe OK', probe.ok === true && /Conexión OK/.test(probe.message));

probe = await probarConfigIA({ provider: 'custom', baseUrl: 'http://127.0.0.1:' + (PORT + 1) + '/v1', modelo: 'x', apiKey: 'mala' });
ok('probe 401 → ok:false + mensaje', probe.ok === false && /inválida/.test(probe.message));

probe = await probarConfigIA({ provider: 'openai', baseUrl: '', modelo: 'gpt-4o', apiKey: '' });
ok('probe sin URL → ok:false', probe.ok === false);

probe = await probarConfigIA({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', modelo: 'openai/gpt-4o-mini', apiKey: '' });
ok('probe openrouter sin key → ok:false + nombre', probe.ok === false && /OpenRouter/.test(probe.message));

// Ollama (sinKey): no exige key. Forzamos conexión a puerto cerrado y
// verificamos que el rechazo NO sea por "falta API key" (sinKey respetaado).
probe = await probarConfigIA({ provider: 'ollama', baseUrl: 'http://127.0.0.1:1/v1', modelo: 'llava', apiKey: '' });
ok('probe ollama sin key → no rechaza por falta de key', probe.ok === false && !/API key/i.test(probe.message));

srv.close(); srv401.close();
fs.unlinkSync('/tmp/smoke-doc.jpg');

console.log('\n' + passed + ' pasaron, ' + failed + ' fallaron');
process.exit(failed ? 1 : 0);
