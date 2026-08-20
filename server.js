/**
 * Server untuk Dashboard Keuangan di VPS.
 * Serve static files + route /api/* ke Vercel-style handlers.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env file
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf-8');
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) process.env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  console.log('[server] .env loaded');
}

// Initialize database schema
const pg = require('./lib/pg-connector');
pg.initSchema().then(() => console.log('[server] Database schema initialized')).catch(e => console.error('[server] Schema init failed:', e.message));

const ROOT = __dirname;
const PORT = process.env.PORT || 3001;
const STATIC_DIR = path.join(ROOT, 'static');

// Load API handlers
const handlers = {};
const apiFiles = [
  'config', 'summary', 'upload', 'ad-spend', 'accounting',
  'data-quality', 'health', 'stores', 'skus',
  'telegram-daily', 'telegram-test', 'import-samples',
  'folder-monitor', 'folder-run', 'split-data',
  'debug',
];

for (const name of apiFiles) {
  try {
    handlers[name] = require(path.join(ROOT, 'api', name));
  } catch (e) {
    console.error(`[server] Failed to load api/${name}.js:`, e.message);
  }
}

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

function serveStatic(url, res) {
  // Strip /static/ prefix — files are directly in STATIC_DIR
  const cleanUrl = url.startsWith('/static/') ? url.slice(7).replace(/^\//, '') : (url === '/' ? 'index.html' : url.slice(1));
  let filePath = path.join(STATIC_DIR, cleanUrl);

  // Fallback untuk SPA: semua route selain /api/ serve index.html
  if (!url.startsWith('/api/') && !url.startsWith('/static/')) {
    if (!fs.existsSync(filePath)) {
      filePath = path.join(STATIC_DIR, 'index.html');
    }
  }
  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    // Cache-Control: JS/CSS/HTML selalu fresh (jangan di-cache Cloudflare),
    // aset statis (gambar, font) boleh di-cache lama karena jarang berubah
    const noCacheExts = ['.js', '.css', '.html'];
    const cacheHeader = noCacheExts.includes(ext)
      ? 'no-store, no-cache, must-revalidate'
      : 'public, max-age=31536000, immutable'; // 1 tahun untuk aset statis
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': cacheHeader,
    });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Owner-Pin, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routing
  const apiMatch = pathname.match(/^\/api\/([^/]+)/);
  if (apiMatch) {
    const handlerName = apiMatch[1];
    const handler = handlers[handlerName];
    if (handler) {
      // Clone headers untuk Vercel API compatibility
      const vercelReq = Object.assign(req, {
        query: Object.fromEntries(url.searchParams),
        body: null,
      });

      // Parse body untuk POST
      if (req.method === 'POST') {
        const buffers = [];
        for await (const chunk of req) buffers.push(chunk);
        const rawBuffer = Buffer.concat(buffers);
        // For multipart uploads (file), keep as Buffer; for JSON, parse as string
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('multipart/form-data')) {
          vercelReq.body = rawBuffer;  // Keep as Buffer for file upload
        } else if (rawBuffer.length > 0) {
          const rawBody = rawBuffer.toString('utf-8');
          try {
            vercelReq.body = JSON.parse(rawBody);
          } catch {
            vercelReq.body = rawBody;
          }
        }
      }

      try {
        await handler(vercelReq, res);
      } catch (e) {
        console.error(`[server] Error in /api/${handlerName}:`, e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message || 'Internal server error' }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'API endpoint tidak ditemukan' }));
    return;
  }

  // Static files
  if (serveStatic(pathname, res)) return;

  // Fallback
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'Not found' }));
});

server.listen(PORT, () => {
  console.log(`[server] Dashboard Keuangan running on http://0.0.0.0:${PORT}`);
  console.log(`[server] Static: ${STATIC_DIR}`);
  console.log(`[server] API handlers loaded: ${Object.keys(handlers).length}`);
});