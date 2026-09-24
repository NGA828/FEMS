/**
 * Development preview proxy.
 *
 * The Expo web build runs on 8081 and the FEMS API on 3000. A browser tab that
 * opened the app from a remote host cannot reach `127.0.0.1:3000`, so the app
 * always talks to the *same origin* it was served from and this proxy splits the
 * traffic:
 *
 *   /api/**  ->  FEMS API       (default http://127.0.0.1:3000)
 *   /**      ->  Expo dev server (default http://127.0.0.1:8081)
 *
 * WebSocket upgrades (Metro's hot-reload channel) are forwarded too, so the
 * preview behaves exactly like a local `expo start --web` session. Nothing here
 * is required in production: a released app points `EXPO_PUBLIC_API_URL` at the
 * deployed API and CORS is handled by the backend.
 */
import http from 'node:http';
import net from 'node:net';

const PORT = Number(process.env.PREVIEW_PORT ?? 8080);
const API_TARGET = process.env.PREVIEW_API_TARGET ?? 'http://127.0.0.1:3000';
const WEB_TARGET = process.env.PREVIEW_WEB_TARGET ?? 'http://127.0.0.1:8081';

const apiUrl = new URL(API_TARGET);
const webUrl = new URL(WEB_TARGET);

/** @param {import('node:http').IncomingMessage} req */
function pickTarget(req) {
  const path = req.url ?? '/';
  const isApi = path === '/api' || path.startsWith('/api/') || path.startsWith('/api?');
  return isApi ? apiUrl : webUrl;
}

const server = http.createServer((req, res) => {
  const target = pickTarget(req);
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `${target.hostname}:${target.port}` },
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    },
  );
  upstream.on('error', (error) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    res.end(
      JSON.stringify({
        success: false,
        statusCode: 502,
        error: {
          code: 'PREVIEW_PROXY_UNAVAILABLE',
          message: `Cannot reach ${target.origin} (${error.message}). Is the ${target === apiUrl ? 'API' : 'Expo dev server'} running?`,
        },
      }),
    );
  });
  req.pipe(upstream);
});

server.on('upgrade', (req, socket, head) => {
  const target = pickTarget(req);
  const upstream = net.connect(Number(target.port), target.hostname, () => {
    const headerLines = Object.entries(req.headers)
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
      .join('\r\n');
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headerLines}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

server.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[preview] http://0.0.0.0:${PORT}  →  web ${webUrl.origin} | api ${apiUrl.origin}`);
});
