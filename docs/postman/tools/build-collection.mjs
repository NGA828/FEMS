#!/usr/bin/env node
/**
 * Build the Postman collection and environment from real traffic.
 *
 *   node docs/postman/tools/build-collection.mjs
 *
 * Inputs
 *   docs/postman/tools/openapi.json  — GET /api/v1/docs-json, saved (every route)
 *   docs/postman/tools/captured.json — output of capture.mjs (real responses)
 *
 * Outputs
 *   docs/postman/FEMS-API.postman_collection.json
 *   docs/postman/FEMS-Local.postman_environment.json
 *
 * Every route in the OpenAPI document becomes a request, so the collection
 * covers 100% of the API. Requests that were executed by capture.mjs also carry
 * the real response as a saved example, plus the request body that produced it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(here, '..');
const openapi = JSON.parse(readFileSync(path.join(here, 'openapi.json'), 'utf8'));
const captured = JSON.parse(readFileSync(path.join(here, 'captured.json'), 'utf8'));

/** The OpenAPI document carries the `/api/v1` prefix; the capture does not. */
const stripPrefix = (value) => value.replace(/^\/api\/v1/, '') || '/';
const pathRegex = (value) => new RegExp(`^${value.replace(/\{[^}]+\}/g, '[^/]+')}$`);

const METHODS = ['get', 'post', 'patch', 'put', 'delete'];

const specOperations = [];
for (const [specPath, operations] of Object.entries(openapi.paths)) {
  const template = stripPrefix(specPath);
  for (const [method, operation] of Object.entries(operations)) {
    if (!METHODS.includes(method)) continue;
    specOperations.push({
      method: method.toUpperCase(),
      template,
      operation,
      regex: pathRegex(template),
    });
  }
}

function findSpecOperation(method, template) {
  return specOperations.find((entry) => entry.method === method && entry.regex.test(template));
}

/** Every captured login becomes its own request: each stores a different token. */
const capturedLogins = captured.requests.filter((request) => request.path === '/auth/login');

// Match each spec route to the captured request that exercised it. Static routes
// win over parameterised ones: `/permits/statistics` must not be claimed by the
// `/permits/{id}` template.
const staticTemplates = new Set(specOperations.map((entry) => `${entry.method} ${entry.template}`));
const exampleFor = new Map();
for (const spec of specOperations) {
  const same = (request) => request.method === spec.method && request.path !== '/auth/login';
  const exact = captured.requests.find((request) => same(request) && request.path === spec.template);
  const match = exact
    ?? captured.requests.find(
      (request) => same(request)
        && spec.regex.test(request.path)
        && !staticTemplates.has(`${request.method} ${request.path}`),
    );
  if (match) exampleFor.set(`${spec.method} ${spec.template}`, match);
}

// ---------------------------------------------------------------------------
// Environment variables: every id the walkthrough discovered, pre-filled
// ---------------------------------------------------------------------------
const ID_ORDER = [
  'forestId', 'zoneId', 'speciesId', 'protectedAreaId', 'inventoryId', 'companyId',
  'companyDocumentId', 'permitId', 'activePermitId', 'permitDocumentId', 'paymentId',
  'settledPaymentId', 'inspectionId', 'activityId', 'equipmentId', 'observationId',
  'violationId', 'alertId', 'analysisId', 'conversationId', 'reportId', 'notificationId',
  'userId', 'adminUserId', 'mediaId', 'createdForestId', 'createdZoneId', 'createdPermitId',
  'createdPermitFee', 'createdPaymentId', 'createdObservationId', 'createdInspectionId',
  'createdViolationId', 'generatedReportId',
];

/** Path/query parameter names that are record ids -> environment variable name. */
const PLACEHOLDER = {
  id: 'recordId',
  forestId: 'forestId',
  forestid: 'forestId',
  zoneId: 'zoneId',
  zoneid: 'zoneId',
  speciesId: 'speciesId',
  protectedAreaId: 'protectedAreaId',
  companyId: 'companyId',
  permitId: 'permitId',
  paymentId: 'paymentId',
  inspectionId: 'inspectionId',
  activityId: 'activityId',
  equipmentId: 'equipmentId',
  observationId: 'observationId',
  violationId: 'violationId',
  documentId: 'documentId',
  documentid: 'documentId',
  sessionId: 'sessionId',
  alertId: 'alertId',
  analysisId: 'analysisId',
  conversationId: 'conversationId',
  reportId: 'reportId',
  notificationId: 'notificationId',
  userId: 'userId',
  roleName: 'roleName',
  name: 'roleName',
  action: 'action',
};

// ---------------------------------------------------------------------------
// Sample body generation (for routes the walkthrough did not execute)
// ---------------------------------------------------------------------------
function resolveSchema(schema, depth = 0) {
  if (!schema || depth > 6) return {};
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop();
    return resolveSchema(openapi.components?.schemas?.[name], depth + 1);
  }
  return schema;
}

function sampleValue(schema, depth = 0) {
  const resolved = resolveSchema(schema, depth);
  if (!resolved) return '';
  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;
  if (resolved.enum?.length) return resolved.enum[0];
  if (resolved.allOf?.length) {
    return Object.assign({}, ...resolved.allOf.map((part) => sampleValue(part, depth + 1)));
  }
  switch (resolved.type) {
    case 'array':
      return [];
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'object':
    default: {
      const properties = resolved.properties ?? {};
      const out = {};
      for (const [name, child] of Object.entries(properties)) out[name] = sampleValue(child, depth + 1);
      return out;
    }
  }
}

function sampleBody(operation) {
  const schema = operation.requestBody?.content?.['application/json']?.schema;
  if (!schema) return undefined;
  const resolved = resolveSchema(schema);
  const properties = resolved.properties ?? {};
  const required = new Set(resolved.required ?? []);
  const body = {};
  for (const [name, child] of Object.entries(properties)) {
    if (!required.has(name)) continue;
    body[name] = sampleValue(child);
  }
  return Object.keys(body).length ? body : undefined;
}

// ---------------------------------------------------------------------------
// URL + query building
// ---------------------------------------------------------------------------
function toVariablePath(template) {
  return template.replace(/\{(\w+)\}/g, (_, rawName) => `{{${PLACEHOLDER[rawName] ?? rawName}}}`);
}

function buildUrl(method, template, operation, capturedRequest) {
  const rawPath = toVariablePath(template);
  const query = [];

  if (capturedRequest) {
    // Use exactly the query string that produced the captured response.
    for (const [key, value] of Object.entries(queryFromUrl(capturedRequest.url))) {
      query.push({ key, value, description: 'Used in the captured example' });
    }
  } else {
    for (const parameter of operation.parameters ?? []) {
      if (parameter.in !== 'query') continue;
      const value = parameter.schema?.example ?? parameter.schema?.default ?? '';
      query.push({
        key: parameter.name,
        value: value === '' ? '' : String(value),
        description: parameter.description ?? '',
        disabled: !parameter.required,
      });
    }
  }

  const search = query
    .filter((entry) => !entry.disabled && entry.value !== '')
    .map((entry) => `${entry.key}=${entry.value}`)
    .join('&');

  return {
    raw: `{{baseUrl}}${rawPath}${search ? `?${search}` : ''}`,
    host: ['{{baseUrl}}'],
    path: rawPath.replace(/^\//, '').split('/'),
    query,
    variable: (template.match(/\{(\w+)\}/g) ?? []).map((token) => {
      const rawName = token.slice(1, -1);
      const variableName = PLACEHOLDER[rawName] ?? rawName;
      return {
        key: variableName,
        value: captured.variables?.[variableName] ?? captured.variables?.[rawName] ?? '',
        description: `Pre-filled from the captured walkthrough (${rawName})`,
      };
    }),
  };
}

function queryFromUrl(url) {
  const index = url.indexOf('?');
  if (index < 0) return {};
  const out = {};
  for (const [key, value] of new URL(url).searchParams.entries()) out[key] = value;
  return out;
}

function roleForRequest(operation, capturedRequest) {
  if (capturedRequest) return capturedRequest.role;
  const description = `${operation.description ?? ''} ${operation.summary ?? ''}`;
  if (/public/i.test(description)) return 'none';
  return 'admin';
}

const tokenVariableFor = (role) => captured.tokenVariables?.[role] ?? null;

function describe(operation, capturedRequest, method, template) {
  const lines = [`**${method} ${template}**`];
  if (operation?.summary) lines.push(operation.summary);
  if (operation?.description) lines.push('', operation.description);
  if (capturedRequest?.note) lines.push('', `_${capturedRequest.note}_`);
  if (capturedRequest) {
    lines.push(
      '',
      `Captured example: **${capturedRequest.status}** in ${capturedRequest.elapsedMs} ms. `
      + `Rendered in \`docs/postman/screenshots/${capturedRequest.id}.png\`.`,
    );
  } else if (operation) {
    lines.push('', '_Not executed by the walkthrough — the body above is a generated sample._');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Item building
// ---------------------------------------------------------------------------
function buildItem({ name, method, template, operation, capturedRequest, tokenVariable }) {
  const role = capturedRequest ? capturedRequest.role : roleForRequest(operation, null);
  const token = tokenVariable ?? tokenVariableFor(role);

  const headers = [{ key: 'Accept', value: 'application/json' }];
  const body = capturedRequest?.requestBody ?? sampleBody(operation ?? {});
  if (body !== undefined) headers.push({ key: 'Content-Type', value: 'application/json' });
  if (token) headers.push({ key: 'Authorization', value: `Bearer {{${token}}}` });

  const item = {
    name,
    request: {
      method,
      header: headers,
      url: buildUrl(method, template, operation ?? {}, capturedRequest),
      description: describe(operation, capturedRequest, method, template),
    },
  };

  if (body !== undefined) {
    item.request.body = {
      mode: 'raw',
      raw: JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  if (capturedRequest) {
    item.request.response = [{
      id: `${capturedRequest.id}-example`,
      name: `${capturedRequest.status} — captured ${capturedRequest.capturedAt.slice(0, 10)}`,
      originalRequest: {
        method,
        header: headers,
        url: { raw: capturedRequest.url.replace(captured.baseUrl, '{{baseUrl}}') },
        body: capturedRequest.requestBody
          ? {
            mode: 'raw',
            raw: JSON.stringify(capturedRequest.requestBody, null, 2),
            options: { raw: { language: 'json' } },
          }
          : undefined,
      },
      responseTime: `${capturedRequest.elapsedMs} ms`,
      status: capturedRequest.statusText || '',
      code: capturedRequest.status,
      _postman_previewlanguage: 'json',
      header: [
        { key: 'Content-Type', value: capturedRequest.contentType || 'application/json; charset=utf-8' },
        { key: 'X-Response-Time', value: `${capturedRequest.elapsedMs}ms` },
      ],
      body: typeof capturedRequest.responseBody === 'string'
        ? capturedRequest.responseBody
        : JSON.stringify(capturedRequest.responseBody, null, 2),
    }];
  }

  if (capturedRequest?.tokenVariable) {
    item.event = [{
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          'const response = pm.response.json();',
          '',
          'pm.test("HTTP 200/201", () => pm.expect(pm.response.code).to.be.oneOf([200, 201]));',
          'pm.test("access token returned", () => {',
          '  pm.expect(response.data.tokens.accessToken).to.be.a("string");',
          '});',
          '',
          `pm.environment.set("${capturedRequest.tokenVariable}", response.data.tokens.accessToken);`,
          'pm.environment.set("refreshToken", response.data.tokens.refreshToken);',
        ],
      },
    }];
  }

  return item;
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------
const FOLDER_ORDER = [
  'Auth', 'System', 'Users & roles', 'Forests & GIS', 'Companies', 'Permits',
  'Payments', 'Inspections', 'Exploitation', 'Observations', 'Environmental',
  'AI Forest Intelligence', 'Reports', 'Notifications', 'Audit', 'Media',
  'Write operations',
];

const TAG_TO_FOLDER = {
  auth: 'Auth',
  health: 'System',
  settings: 'System',
  users: 'Users & roles',
  roles: 'Users & roles',
  forests: 'Forests & GIS',
  zones: 'Forests & GIS',
  'protected-areas': 'Forests & GIS',
  'tree-species': 'Forests & GIS',
  inventory: 'Forests & GIS',
  gis: 'Forests & GIS',
  companies: 'Companies',
  permits: 'Permits',
  payments: 'Payments',
  inspections: 'Inspections',
  exploitation: 'Exploitation',
  equipment: 'Exploitation',
  observations: 'Observations',
  environmental: 'Environmental',
  ai: 'AI Forest Intelligence',
  reports: 'Reports',
  notifications: 'Notifications',
  audit: 'Audit',
  media: 'Media',
};

const folders = new Map(FOLDER_ORDER.map((name) => [name, []]));

/** A captured request whose folder is known keeps the folder used in the guide. */
function folderFor(operation, capturedRequest) {
  if (capturedRequest?.folder && folders.has(capturedRequest.folder)) return capturedRequest.folder;
  return TAG_TO_FOLDER[operation?.tags?.[0] ?? ''] ?? 'Other';
}

// 1. Every route of the API.
for (const { method, template, operation } of specOperations) {
  const capturedRequest = exampleFor.get(`${method} ${template}`);
  const folder = folderFor(operation, capturedRequest);
  const item = buildItem({
    name: capturedRequest?.name ?? operation.summary ?? template,
    method,
    template,
    operation,
    capturedRequest,
  });
  folders.get(folder)?.push(item);
}

// 2. One login request per demonstration account: each stores its own token.
for (const login of capturedLogins) {
  const item = buildItem({
    name: login.name,
    method: login.method,
    template: login.path,
    operation: openapi.paths['/api/v1/auth/login']?.post,
    capturedRequest: login,
  });
  folders.get('Auth')?.push(item);
}

// 3. The concrete state-machine steps walked by the guide (SUBMIT, APPROVE, …):
//    they share one route in the spec but each is a distinct, useful request.
for (const request of captured.requests) {
  if (request.id.startsWith('auth-login')) continue;
  if (request.path === '/auth/login') continue;
  const lastSegment = request.path.split('/').pop() ?? '';
  const isConcreteAction = /\/actions\/[A-Z_]+$/.test(request.path) && lastSegment === lastSegment.toUpperCase();
  if (!isConcreteAction) continue;
  // Skip the step that already carries the parameterised route's example.
  const spec = findSpecOperation(request.method, request.path);
  if (spec && exampleFor.get(`${spec.method} ${spec.template}`)?.id === request.id) continue;
  folders.get(request.folder)?.push(buildItem({
    name: request.name,
    method: request.method,
    template: request.path,
    operation: spec,
    capturedRequest: request,
  }));
}

// Most folders read better alphabetically; the write-operations folder follows
// the order of the walkthrough (register a forest -> file a permit -> pay -> activate).
const captureOrder = new Map(captured.requests.map((request, index) => [request.id, index]));
for (const [name, items] of folders) {
  if (name === 'Write operations') {
    items.sort((a, b) => {
      const left = captureOrder.get(a.request.response?.[0]?.id?.replace(/-example$/, '') ?? '') ?? Number.MAX_SAFE_INTEGER;
      const right = captureOrder.get(b.request.response?.[0]?.id?.replace(/-example$/, '') ?? '') ?? Number.MAX_SAFE_INTEGER;
      return left - right || a.name.localeCompare(b.name);
    });
  } else {
    items.sort((a, b) => a.name.localeCompare(b.name));
  }
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------
const visibleCaptures = captured.requests.filter((request) => !request.hidden && request.status > 0);
const collection = {
  info: {
    _postman_id: 'f2f0c1de-6f4e-4f7f-9c1e-8a0f3b6d5a11',
    name: 'FEMS API — Forest Exploitation Management System',
    description: [
      'Complete FEMS REST API collection: every route of the NestJS backend, organised by module.',
      '',
      '## Getting started',
      '',
      '1. Import **FEMS-Local.postman_environment.json** next to this collection and select it as the active environment.',
      '2. Set `baseUrl` (default `http://localhost:3000/api/v1`).',
      '3. Run **Auth → Login — administrator**. Its test script saves the access token into `tokenAdmin`;',
      '   the other six login requests save `tokenOfficer`, `tokenInspector`, … the same way.',
      '4. Every other request already carries `Authorization: Bearer {{token…}}` and the record ids captured',
      '   during the walkthrough, so you can press **Send** on anything.',
      '',
      '## What is real and what is generated',
      '',
      `* **${visibleCaptures.length} requests** were executed against a seeded FEMS instance by`,
      '  `docs/postman/tools/capture.mjs`. They ship the **actual** response as a saved example',
      '  (status, body, latency) and are the ones rendered in `docs/postman/screenshots/`.',
      '* The remaining requests cover the rest of the API. Their bodies are generated from the',
      '  OpenAPI schema and say “Not executed by the walkthrough” in the description — ready to',
      '  edit and send, but not recordings.',
      '',
      '## Conventions',
      '',
      '* Authentication: `Authorization: Bearer <access token>` (15-minute access token, 30-day refresh token).',
      '* Errors answer `{ "success": false, "error": { "code", "message", "details" } }` — see the 400/401/403',
      '  examples in **Auth** and **Write operations**.',
      '* Every list endpoint is paginated (`page`, `limit`) and answers `{ success, data, meta, timestamp }`.',
      '* Rate limiting: 120 requests/minute by default, and a stricter 10/minute on the authentication',
      '  routes. A 429 means slow down — wait a minute and retry.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: FOLDER_ORDER
    .filter((name) => folders.get(name).length)
    .map((name) => ({ name, item: folders.get(name) })),
  variable: [{ key: 'baseUrl', value: 'http://localhost:3000/api/v1', type: 'string' }],
};

writeFileSync(
  path.join(docsDir, 'FEMS-API.postman_collection.json'),
  `${JSON.stringify(collection, null, 2)}\n`,
);

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const values = [{ key: 'baseUrl', value: captured.baseUrl, type: 'default', enabled: true }];
for (const variable of Object.values(captured.tokenVariables ?? {})) {
  values.push({ key: variable, value: '', type: 'secret', enabled: true });
}
values.push({ key: 'refreshToken', value: '', type: 'secret', enabled: true });
for (const id of ID_ORDER) {
  if (captured.variables?.[id] === undefined) continue;
  values.push({ key: id, value: String(captured.variables[id]), type: 'default', enabled: true });
}
for (const [key, value] of Object.entries(captured.variables)) {
  if (values.some((entry) => entry.key === key)) continue;
  values.push({ key, value: String(value), type: 'default', enabled: true });
}
values.push({ key: 'recordId', value: '', type: 'default', enabled: true });
values.push({ key: 'documentId', value: '', type: 'default', enabled: true });
values.push({ key: 'sessionId', value: '', type: 'default', enabled: true });
values.push({ key: 'roleName', value: 'ADMINISTRATOR', type: 'default', enabled: true });
values.push({ key: 'action', value: 'SUBMIT', type: 'default', enabled: true });

const environment = {
  id: '9c1d0f22-5f27-4a5e-9a2e-6d4b1f0c7a33',
  name: 'FEMS — local (XAMPP / sandbox)',
  values,
  _postman_variable_scope: 'environment',
};

writeFileSync(
  path.join(docsDir, 'FEMS-Local.postman_environment.json'),
  `${JSON.stringify(environment, null, 2)}\n`,
);

const total = collection.item.reduce((sum, folder) => sum + folder.item.length, 0);
const withExamples = collection.item.reduce(
  (sum, folder) => sum + folder.item.filter((entry) => entry.request.response?.length).length,
  0,
);
console.log(`collection : ${total} requests in ${collection.item.length} folders (${withExamples} with a real saved example)`);
console.log(`environment: ${values.length} variables`);
