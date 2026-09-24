#!/usr/bin/env node
/** Validate prisma/schema.prisma using the WASM schema engine (no network needed). */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { schemaPath, log } from './lib/schema-tools.mjs';

const require = createRequire(import.meta.url);
const { getConfig, getDMMF } = require('@prisma/internals');
const datamodel = fs.readFileSync(schemaPath, 'utf8');
try {
  const config = await getConfig({ datamodel, schemaPath });
  const dmmf = await getDMMF({ datamodel });
  log('prisma', 'schema is valid');
  log('prisma', `datasource: ${config.datasources.map((d) => d.provider).join(', ')}`);
  log('prisma', `models: ${dmmf.datamodel.models.length}, enums: ${dmmf.datamodel.enums.length}`);
} catch (error) {
  console.error('[prisma] schema validation failed:\n' + String(error.message || error));
  process.exit(1);
}
