#!/usr/bin/env node
/**
 * Render Postman-style screenshots from the captured traffic.
 *
 *   node docs/postman/tools/render-screenshots.mjs
 *
 * Reads docs/postman/tools/captured.json and writes:
 *   docs/postman/screenshots/<id>.png   one image per executed request
 *   docs/postman/index.html             a gallery of all of them
 *
 * Nothing is mocked: the status line, latency, size and body shown in every
 * image are the ones the API actually returned. Bodies longer than the space
 * available are cut, and the truncation is stated on the image itself.
 *
 * Rendering uses @napi-rs/canvas (no browser download required):
 *   npm install @napi-rs/canvas
 * or point CANVAS_PATH at an existing installation.
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, '..');
const shotsDir = path.join(docsDir, 'screenshots');

const captured = JSON.parse(readFileSync(path.join(here, 'captured.json'), 'utf8'));

function loadCanvas() {
  for (const candidate of [process.env.CANVAS_PATH, '/home/user/.shottool/node_modules/@napi-rs/canvas', '@napi-rs/canvas'].filter(Boolean)) {
    try {
      return require(candidate);
    } catch {
      /* try the next one */
    }
  }
  throw new Error('@napi-rs/canvas not found. Run: npm install @napi-rs/canvas (or set CANVAS_PATH).');
}

const { createCanvas, GlobalFonts } = loadCanvas();

const FONT_DIR = '/usr/share/fonts/truetype/dejavu';
GlobalFonts.registerFromPath(`${FONT_DIR}/DejaVuSans.ttf`, 'UI');
GlobalFonts.registerFromPath(`${FONT_DIR}/DejaVuSans-Bold.ttf`, 'UI-Bold');
GlobalFonts.registerFromPath(`${FONT_DIR}/DejaVuSansMono.ttf`, 'Mono');
GlobalFonts.registerFromPath(`${FONT_DIR}/DejaVuSansMono-Bold.ttf`, 'Mono-Bold');

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
const C = {
  bg: '#1b1b1f',
  panel: '#232327',
  sidebar: '#1f1f23',
  titlebar: '#141417',
  line: '#2f2f35',
  text: '#e7e7ea',
  dim: '#b9b9c3',
  muted: '#8a8a94',
  faint: '#6f6f7a',
  accent: '#ff6c37',
  key: '#9cdcfe',
  str: '#ce9178',
  num: '#b5cea8',
  bool: '#569cd6',
  punct: '#8b8b95',
  ok: '#4ec9a5',
  warn: '#ffb454',
  bad: '#ff6b6b',
  info: '#4aa8ff',
};

const METHOD_COLOR = { GET: C.ok, POST: '#ff9f43', PATCH: '#c08cff', PUT: C.info, DELETE: C.bad };

const STATUS_TEXT = {
  200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 422: 'Unprocessable Entity',
  429: 'Too Many Requests', 500: 'Internal Server Error',
};

const W = 1440;
const SIDEBAR_W = 320;
const PAD = 20;
const LINE = 19;
const MONO = '12px Mono';
const UI = '13px UI';

const statusColor = (status) => (status >= 500 ? C.bad : status >= 400 ? C.warn : status >= 300 ? C.info : C.ok);

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Cut a string so it fits `maxWidth`, appending an ellipsis when it does not. */
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${text.slice(0, low).replace(/\s+$/, '')}…`;
}

function wrap(ctx, text, maxWidth, maxLines) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines - 1) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines) {
    const consumed = lines.join(' ').length;
    if (consumed < text.length) lines[maxLines - 1] = fit(ctx, `${lines[maxLines - 1]} ${text.slice(consumed)}`, maxWidth);
  }
  return lines;
}

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// JSON syntax highlighting
// ---------------------------------------------------------------------------
/**
 * Split a JSON line into styled tokens.
 * Each token: { text, color }
 */
function tokenizeLine(line) {
  const tokens = [];
  const keyMatch = /^(\s*)"((?:[^"\\]|\\.)*)":(\s*)(.*)$/.exec(line);
  if (keyMatch) {
    const [, indent, key, gap, rest] = keyMatch;
    if (indent) tokens.push({ text: indent, color: null });
    tokens.push({ text: `"${key}"`, color: C.key });
    tokens.push({ text: ':', color: C.punct });
    if (gap) tokens.push({ text: gap, color: null });
    tokens.push(...valueTokens(rest));
    return tokens;
  }

  const arrayItem = /^(\s*)(.*)$/.exec(line);
  if (arrayItem) {
    const [, indent, rest] = arrayItem;
    if (indent) tokens.push({ text: indent, color: null });
    tokens.push(...valueTokens(rest));
  }
  return tokens;
}

function valueTokens(rest) {
  if (!rest) return [];
  const stringMatch = /^("(?:[^"\\]|\\.)*")(,?)$/.exec(rest);
  if (stringMatch) {
    return [
      { text: stringMatch[1], color: C.str },
      { text: stringMatch[2], color: C.punct },
    ];
  }
  const numberMatch = /^(-?\d+(?:\.\d+)?)(,?)$/.exec(rest);
  if (numberMatch) {
    return [
      { text: numberMatch[1], color: C.num },
      { text: numberMatch[2], color: C.punct },
    ];
  }
  const literalMatch = /^(true|false|null)(,?)$/.exec(rest);
  if (literalMatch) {
    return [
      { text: literalMatch[1], color: C.bool },
      { text: literalMatch[2], color: C.punct },
    ];
  }
  return [{ text: rest, color: C.dim }];
}

function drawJson(ctx, lines, x, y, maxWidth) {
  let cursor = y;
  for (const line of lines) {
    let cursorX = x;
    for (const token of tokenizeLine(line)) {
      const text = fit(ctx, token.text, Math.max(0, maxWidth - (cursorX - x)));
      if (!text) continue;
      ctx.fillStyle = token.color ?? C.text;
      ctx.fillText(text, cursorX, cursor);
      cursorX += ctx.measureText(text).width;
      if (cursorX - x >= maxWidth) break;
    }
    cursor += LINE;
  }
  return cursor;
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
function drawTitlebar(ctx, width) {
  ctx.fillStyle = C.titlebar;
  ctx.fillRect(0, 0, width, 44);
  const dots = ['#ff5f57', '#febc2e', '#28c840'];
  dots.forEach((color, index) => {
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(24 + index * 18, 22, 5.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#f2f2f5';
  ctx.font = 'bold 13px UI-Bold';
  ctx.fillText('FEMS API', 90, 27);
  ctx.font = '11px UI';
  ctx.fillStyle = C.faint;
  const env = `Environment: FEMS — local   ·   ${captured.baseUrl}`;
  ctx.fillText(env, width - PAD - ctx.measureText(env).width, 27);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(0, 44.5);
  ctx.lineTo(width, 44.5);
  ctx.stroke();
}

function drawSidebar(ctx, folders, activeId, height, scrollTo) {
  ctx.fillStyle = C.sidebar;
  ctx.fillRect(0, 44, SIDEBAR_W, height - 44);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(SIDEBAR_W - 0.5, 44);
  ctx.lineTo(SIDEBAR_W - 0.5, height);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 44, SIDEBAR_W, height - 44);
  ctx.clip();

  ctx.font = '10px UI-Bold';
  ctx.fillStyle = C.faint;
  ctx.fillText('COLLECTIONS  /  FEMS API', 16, 68 - scrollTo);

  let y = 92 - scrollTo;
  for (const folder of folders) {
    ctx.font = 'bold 12px UI-Bold';
    ctx.fillStyle = '#d6d6de';
    ctx.fillText('▾', 16, y);
    ctx.fillText(fit(ctx, folder.name, SIDEBAR_W - 56), 32, y);
    y += 22;
    for (const request of folder.requests) {
      const active = request.id === activeId;
      if (active) {
        ctx.fillStyle = '#2c2c33';
        roundRect(ctx, 12, y - 14, SIDEBAR_W - 34, 22, 5);
        ctx.fill();
      }
      ctx.font = 'bold 10px UI-Bold';
      ctx.fillStyle = METHOD_COLOR[request.method] ?? C.dim;
      ctx.fillText(request.method, 32, y);
      ctx.font = '12px UI';
      ctx.fillStyle = active ? '#ffffff' : C.muted;
      ctx.fillText(fit(ctx, request.name, SIDEBAR_W - 130), 82, y);
      y += 22;
    }
    y += 8;
  }
  ctx.restore();
}

function drawRequestHeader(ctx, request, mainX, top) {
  const width = W - mainX - PAD;
  ctx.font = 'bold 17px UI-Bold';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(fit(ctx, request.name, width), mainX, top + 22);

  const barY = top + 38;
  const barH = 34;
  const methodW = 92;
  const sendW = 92;

  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.fillStyle = C.panel;
  roundRect(ctx, mainX + 0.5, barY + 0.5, methodW, barH, 6);
  ctx.fill();
  roundRect(ctx, mainX + 0.5, barY + 0.5, methodW, barH, 6);
  ctx.stroke();
  ctx.font = 'bold 11px UI-Bold';
  ctx.fillStyle = METHOD_COLOR[request.method] ?? C.dim;
  ctx.fillText(request.method, mainX + 12, barY + 22);
  ctx.fillStyle = C.faint;
  ctx.fillText('▾', mainX + methodW - 18, barY + 22);

  const urlX = mainX + methodW + 8;
  const urlW = width - methodW - 8 - sendW - 8;
  ctx.fillStyle = C.panel;
  roundRect(ctx, urlX + 0.5, barY + 0.5, urlW, barH, 6);
  ctx.fill();
  roundRect(ctx, urlX + 0.5, barY + 0.5, urlW, barH, 6);
  ctx.stroke();
  ctx.font = MONO;
  ctx.fillStyle = '#d9d9e0';
  ctx.fillText(fit(ctx, request.url, urlW - 24), urlX + 12, barY + 22);

  ctx.fillStyle = C.accent;
  roundRect(ctx, urlX + urlW + 8, barY, sendW, barH, 6);
  ctx.fill();
  ctx.font = 'bold 13px UI-Bold';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Send', urlX + urlW + 8 + 26, barY + 22);

  return barY + barH + 18;
}

function drawTabs(ctx, mainX, y, counts) {
  ctx.font = '12.5px UI';
  let x = mainX;
  const tabs = [
    ['Params', counts.query],
    ['Authorization', 0],
    ['Headers', counts.headers],
    ['Body', 0],
  ];
  for (const [label, badge] of tabs) {
    const active = label === 'Body';
    const width = ctx.measureText(label).width + 24 + (badge ? 26 : 0);
    ctx.fillStyle = active ? '#ffffff' : C.muted;
    ctx.fillText(label, x, y + 16);
    if (badge) {
      const badgeX = x + ctx.measureText(label).width + 8;
      ctx.fillStyle = '#33333b';
      roundRect(ctx, badgeX, y + 3, 20, 15, 7);
      ctx.fill();
      ctx.fillStyle = C.dim;
      ctx.font = '10px UI';
      ctx.fillText(String(badge), badgeX + 6, y + 15);
      ctx.font = '12.5px UI';
    }
    if (active) {
      ctx.fillStyle = C.accent;
      ctx.fillRect(x, y + 24, width, 2);
    }
    x += width + 6;
  }
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(mainX, y + 26.5);
  ctx.lineTo(W, y + 26.5);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Page assembly
// ---------------------------------------------------------------------------
function bodyLines(body) {
  if (typeof body === 'string') return { lines: [body], binary: true };
  return { lines: JSON.stringify(body, null, 2).split('\n'), binary: false };
}

function layout(request) {
  const requestBody = request.requestBody
    ? JSON.stringify(request.requestBody, null, 2).split('\n')
    : ['// This request has no body — the filters are in Params.'];
  const response = bodyLines(request.responseBody);
  return {
    requestLines: requestBody.slice(0, 12),
    requestTruncated: requestBody.length > 12,
    requestTotal: requestBody.length,
    responseLines: response.lines.slice(0, 30),
    responseTruncated: response.lines.length > 30,
    responseTotal: response.lines.length,
    binary: response.binary,
  };
}

function renderPage(request, folders) {
  const { requestLines, requestTruncated, requestTotal, responseLines, responseTruncated, responseTotal, binary } = layout(request);

  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = '12.5px UI';
  const noteLines = request.note ? wrap(probe, request.note, W - SIDEBAR_W - PAD * 2 - 24, 3) : [];

  const mainX = SIDEBAR_W + PAD;
  const reqHeaderH = 22 + 38 + 34 + 18;
  const tabsH = 26 + 14;
  const requestPaneH = 26 + requestLines.length * LINE + (requestTruncated ? LINE : 0);
  const responseHeadH = 38;
  const noteH = noteLines.length ? noteLines.length * 18 + 24 : 0;
  const responseBodyH = 28 + responseLines.length * LINE + (responseTruncated ? LINE : 0);
  const footerH = 34;

  const height = 44 + reqHeaderH + tabsH + requestPaneH + responseHeadH + noteH + responseBodyH + footerH + 10;

  const canvas = createCanvas(W, Math.ceil(height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, height);
  ctx.textBaseline = 'alphabetic';

  drawTitlebar(ctx, W);

  // Sidebar scroll: keep the active request comfortably in view.
  let activeY = 92;
  for (const folder of folders) {
    activeY += 22;
    for (const item of folder.requests) {
      if (item.id === request.id) break;
      activeY += 22;
    }
    if (folder.requests.some((item) => item.id === request.id)) break;
    activeY += 8 + folder.requests.length * 22;
  }
  const scrollTo = Math.max(0, activeY - (height - 44) / 2);
  drawSidebar(ctx, folders, request.id, height, scrollTo);

  // --- request header ---------------------------------------------------
  let y = drawRequestHeader(ctx, request, mainX, 44);

  // --- tabs -------------------------------------------------------------
  drawTabs(ctx, mainX, y, {
    query: Object.keys(request.query ?? {}).length,
    headers: Object.keys(request.requestHeaders ?? {}).length,
  });
  y += tabsH;

  // --- request body -----------------------------------------------------
  ctx.fillStyle = C.sidebar;
  ctx.fillRect(SIDEBAR_W, y, W - SIDEBAR_W, requestPaneH);
  ctx.font = MONO;
  drawJson(ctx, requestLines, mainX, y + 20, W - mainX - PAD);
  if (requestTruncated) {
    ctx.font = 'italic 11.5px UI';
    ctx.fillStyle = C.faint;
    ctx.fillText(`Request body truncated for display: ${requestTotal} lines in total.`, mainX, y + 20 + requestLines.length * LINE + 4);
  }
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(SIDEBAR_W, y + requestPaneH + 0.5);
  ctx.lineTo(W, y + requestPaneH + 0.5);
  ctx.stroke();
  y += requestPaneH;

  // --- response head ----------------------------------------------------
  ctx.fillStyle = C.sidebar;
  ctx.fillRect(SIDEBAR_W, y, W - SIDEBAR_W, responseHeadH);
  ctx.strokeStyle = C.line;
  ctx.beginPath();
  ctx.moveTo(SIDEBAR_W, y + 0.5);
  ctx.lineTo(W, y + 0.5);
  ctx.moveTo(SIDEBAR_W, y + responseHeadH + 0.5);
  ctx.lineTo(W, y + responseHeadH + 0.5);
  ctx.stroke();

  let x = mainX;
  ctx.font = '12.5px UI';
  ctx.fillStyle = C.muted;
  ctx.fillText('Status:', x, y + 25);
  x += ctx.measureText('Status: ').width;
  ctx.font = 'bold 12.5px UI-Bold';
  ctx.fillStyle = statusColor(request.status);
  const statusLabel = `${request.status} ${STATUS_TEXT[request.status] ?? request.statusText ?? ''}`.trim();
  ctx.fillText(statusLabel, x, y + 25);
  x += ctx.measureText(statusLabel).width + 28;

  for (const [label, value] of [['Time:', `${request.elapsedMs} ms`], ['Size:', formatBytes(request.sizeBytes)]]) {
    ctx.font = '12.5px UI';
    ctx.fillStyle = C.muted;
    ctx.fillText(label, x, y + 25);
    x += ctx.measureText(`${label} `).width;
    ctx.fillStyle = '#e9e9ef';
    ctx.fillText(value, x, y + 25);
    x += ctx.measureText(value).width + 28;
  }
  y += responseHeadH;

  // --- response body ----------------------------------------------------
  if (noteLines.length) {
    ctx.fillStyle = C.panel;
    ctx.fillRect(mainX, y + 14, W - mainX - PAD, noteLines.length * 18 + 12);
    ctx.fillStyle = C.accent;
    ctx.fillRect(mainX, y + 14, 3, noteLines.length * 18 + 12);
    ctx.font = '12.5px UI';
    ctx.fillStyle = '#cfcfd8';
    noteLines.forEach((line, index) => ctx.fillText(line, mainX + 14, y + 33 + index * 18));
    y += noteLines.length * 18 + 24;
  }

  ctx.font = binary ? '13px Mono' : MONO;
  if (binary) {
    ctx.fillStyle = C.warn;
    ctx.fillText(fit(ctx, responseLines[0], W - mainX - PAD), mainX, y + 22);
  } else {
    drawJson(ctx, responseLines, mainX, y + 22, W - mainX - PAD);
  }
  y += responseBodyH;

  if (responseTruncated) {
    ctx.font = 'italic 11.5px UI';
    ctx.fillStyle = C.faint;
    ctx.fillText(
      `Response truncated for display: ${responseTotal} lines in total — the complete body ships as the saved example in FEMS-API.postman_collection.json.`,
      mainX,
      y - 6,
    );
  }

  // --- footer -----------------------------------------------------------
  ctx.font = '11.5px UI';
  ctx.fillStyle = C.faint;
  ctx.fillText(`Captured ${request.capturedAt} — a real response from a seeded FEMS instance (no mocks).`, mainX, height - 16);

  return canvas;
}

// ---------------------------------------------------------------------------

const visible = captured.requests.filter((request) => !request.hidden && request.status > 0);

const folderNames = [];
for (const request of visible) if (!folderNames.includes(request.folder)) folderNames.push(request.folder);
const folders = folderNames.map((name) => ({
  name,
  requests: visible.filter((request) => request.folder === name),
}));

mkdirSync(shotsDir, { recursive: true });

let bytes = 0;
for (const request of visible) {
  const canvas = renderPage(request, folders);
  const buffer = canvas.toBuffer('image/png');
  writeFileSync(path.join(shotsDir, `${request.id}.png`), buffer);
  bytes += buffer.length;
  process.stdout.write(`  ${request.id.padEnd(34)} ${String(request.status).padEnd(4)} ${String(request.elapsedMs).padStart(4)} ms  ${(buffer.length / 1024).toFixed(0)} KB\n`);
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const gallery = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FEMS API — Postman walkthrough</title>
<style>
  body { margin: 0; background: #141417; color: #e7e7ea; font: 15px/1.6 "Inter", "Segoe UI", system-ui, sans-serif; }
  header { padding: 40px 32px 24px; border-bottom: 1px solid #2a2a31; }
  h1 { margin: 0 0 8px; font-size: 26px; }
  header p { margin: 0; color: #9a9aa4; max-width: 78ch; }
  main { padding: 8px 32px 64px; max-width: 1520px; }
  h2 { margin: 36px 0 14px; font-size: 18px; color: #ff8c5f; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); gap: 22px; }
  figure { margin: 0; background: #1b1b1f; border: 1px solid #2a2a31; border-radius: 10px; overflow: hidden; }
  figure a { display: block; }
  figure img { width: 100%; display: block; border-bottom: 1px solid #2a2a31; }
  figcaption { padding: 10px 14px; font-size: 13px; color: #b9b9c3; }
  figcaption b { color: #fff; font-weight: 600; }
  .m { font-size: 10px; font-weight: 700; letter-spacing: .04em; }
  .m.get { color: #4ec9a5; } .m.post { color: #ff9f43; } .m.patch { color: #c08cff; }
  .m.delete { color: #ff6b6b; } .m.put { color: #4aa8ff; }
  code { background: #232327; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
</style></head>
<body>
<header>
  <h1>FEMS API — Postman walkthrough</h1>
  <p>${visible.length} real requests, executed against a seeded FEMS instance on <code>${escapeHtml(captured.baseUrl)}</code>
  at ${escapeHtml(captured.capturedAt)}. Every image shows the status, latency and body the API actually returned —
  nothing is mocked. Import <code>FEMS-API.postman_collection.json</code> and
  <code>FEMS-Local.postman_environment.json</code> into Postman to replay them yourself.</p>
</header>
<main>
${folders.map((folder) => `
  <h2>${escapeHtml(folder.name)}</h2>
  <div class="grid">
${folder.requests.map((request) => `    <figure>
      <a href="screenshots/${request.id}.png"><img src="screenshots/${request.id}.png" alt="${escapeHtml(request.name)}" loading="lazy"></a>
      <figcaption><b>${escapeHtml(request.name)}</b><br>
        <span class="m ${request.method.toLowerCase()}">${request.method}</span>
        <code>${escapeHtml(request.url.replace(captured.baseUrl, ''))}</code> — ${request.status} in ${request.elapsedMs} ms</figcaption>
    </figure>`).join('\n')}
  </div>`).join('\n')}
</main>
</body></html>`;

writeFileSync(path.join(docsDir, 'index.html'), gallery);

console.log(`\n${visible.length} screenshots → ${shotsDir} (${(bytes / 1024 / 1024).toFixed(1)} MB total)`);
console.log(`gallery     → ${path.join(docsDir, 'index.html')}`);
