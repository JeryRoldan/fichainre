const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname, dataRoot = path.join(root, 'registros'), limit = 100 * 1024 * 1024;

const safe = value => String(value || '').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'archivo';
const csv = value => '"' + String(value ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
function parseMultipart(buffer, boundary) {
  const result = { fields: {}, files: [] }, marker = Buffer.from('--' + boundary); let cursor = buffer.indexOf(marker) + marker.length;
  while (cursor >= marker.length) {
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    cursor += 2; const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor); if (headerEnd < 0) break;
    const headers = buffer.subarray(cursor, headerEnd).toString('utf8'), next = buffer.indexOf(marker, headerEnd + 4); if (next < 0) break;
    const content = buffer.subarray(headerEnd + 4, next - 2), name = /name="([^"]+)"/.exec(headers)?.[1], filename = /filename="([^"]*)"/.exec(headers)?.[1];
    if (name && filename) result.files.push({ name, filename, content }); else if (name) result.fields[name] = content.toString('utf8'); cursor = next + marker.length;
  }
  return result;
}
function send(response, status, body, type = 'text/plain; charset=utf-8') { response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' }); response.end(body); }
function serveFile(response, file) {
  fs.readFile(file, (error, content) => { if (error) return send(response, 404, 'No encontrado'); const ext = path.extname(file).toLowerCase(); const types = { '.html':'text/html; charset=utf-8','.png':'image/png','.js':'text/javascript; charset=utf-8','.csv':'text/csv; charset=utf-8' }; response.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' }); response.end(content); });
}
function saveSubmission(parsed) {
  const company = parsed.fields.empresa_formulario === 'informaperu' ? 'informaperu' : 'inre', stamp = new Date(), id = stamp.toISOString().replace(/\D/g, '').slice(0, 14) + '-' + safe(parsed.fields.documento).slice(0, 20);
  const companyDir = path.join(dataRoot, company), docsDir = path.join(companyDir, 'documentos', id); fs.mkdirSync(docsDir, { recursive: true });
  const fileNames = {};
  for (const file of parsed.files) { if (!file.filename.toLowerCase().endsWith('.pdf')) throw new Error('Todos los documentos deben ser PDF.'); const output = safe(file.name) + '-' + safe(file.filename); fs.writeFileSync(path.join(docsDir, output), file.content); fileNames[file.name] = output; }
  const required = ['archivo_cv','archivo_dni','archivo_certijoven','archivo_recibo','archivo_estudios','archivo_trabajo']; if (required.some(name => !fileNames[name])) throw new Error('Falta uno o más documentos PDF obligatorios.');
  const record = { id, fecha_registro: stamp.toLocaleString('es-PE'), empresa: company, ...parsed.fields, ...fileNames }, columns = Object.keys(record), excelFile = path.join(companyDir, `fichas-${company}.csv`);
  if (!fs.existsSync(excelFile)) fs.writeFileSync(excelFile, '\ufeff' + columns.map(csv).join(';') + '\r\n', 'utf8'); fs.appendFileSync(excelFile, columns.map(key => csv(record[key])).join(';') + '\r\n', 'utf8');
  fs.writeFileSync(path.join(companyDir, `ficha-${id}.json`), JSON.stringify(record, null, 2), 'utf8'); return { id, company };
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  if (request.method === 'POST' && url.pathname === '/api/guardar') {
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(request.headers['content-type'] || '')?.slice(1).find(Boolean); if (!boundary) return send(response, 400, JSON.stringify({ error:'Solicitud inválida.' }), 'application/json');
    const chunks = []; let size = 0, stopped = false; request.on('data', chunk => { size += chunk.length; if (size > limit) { stopped = true; request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => { if (stopped) return; try { send(response, 200, JSON.stringify({ ok:true, ...saveSubmission(parseMultipart(Buffer.concat(chunks), boundary)) }), 'application/json'); } catch (error) { send(response, 400, JSON.stringify({ error:error.message }), 'application/json'); } }); return;
  }
  if (url.pathname.startsWith('/descargar-excel/')) { const company = url.pathname.endsWith('informaperu') ? 'informaperu' : 'inre'; return serveFile(response, path.join(dataRoot, company, `fichas-${company}.csv`)); }
  if (['/','/inre','/inre/','/informaperu','/informaperu/'].includes(url.pathname)) return serveFile(response, path.join(root, 'index.html'));
  if (/^\/(inre|informaperu)\/assets\//.test(url.pathname)) return serveFile(response, path.join(root, url.pathname.replace(/^\/(inre|informaperu)\//, '')));
  const file = path.resolve(root, decodeURIComponent(url.pathname).replace(/^\/+/, '')); if (!file.startsWith(path.resolve(root) + path.sep)) return send(response, 403, 'Acceso denegado'); serveFile(response, file);
});
server.listen(8000, '0.0.0.0', () => console.log('INRE: http://192.168.1.10:8000/inre/\nInformaPerú: http://192.168.1.10:8000/informaperu/'));
