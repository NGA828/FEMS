#!/usr/bin/env node
/**
 * Generate the Prisma Client.
 *
 * 1. Preferred: the standard Prisma CLI (`prisma generate`) when the engine
 *    binaries are reachable.
 * 2. Fallback: the WASM toolchain (DMMF + official @prisma/client-generator-js),
 *    which produces the identical client without downloading native engines.
 *
 * Set FEMS_FORCE_OFFLINE_GENERATE=1 to skip the CLI attempt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { backendRoot, schemaPath, log } from './lib/schema-tools.mjs';

function tryCliGenerate() {
  if (process.env.FEMS_FORCE_OFFLINE_GENERATE === '1') return false;
  const bin = path.join(backendRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
  if (!fs.existsSync(bin)) return false;
  try {
    execFileSync(bin, ['generate', '--schema', schemaPath], { stdio: 'pipe', timeout: 90_000 });
    log('prisma', 'client generated with the Prisma CLI');
    return true;
  } catch (error) {
    const detail = String((error.stderr && error.stderr.toString()) || error.message).split('\n')[0];
    log('prisma', `CLI generation unavailable (${detail.slice(0, 120)}) — using the offline WASM generator`);
    return false;
  }
}

async function offlineGenerate() {
  const require = createRequire(import.meta.url);
  const { getConfig, getDMMF } = require('@prisma/internals');
  const { generateClient } = require('@prisma/client-generator-js');
  const enginesVersion = require('@prisma/engines-version');
  const clientPkgPath = path.join(backendRoot, 'node_modules', '@prisma', 'client', 'package.json');
  const clientVersion = JSON.parse(fs.readFileSync(clientPkgPath, 'utf8')).version;
  const datamodel = fs.readFileSync(schemaPath, 'utf8');
  const config = await getConfig({ datamodel, schemaPath });
  const dmmf = await getDMMF({ datamodel });
  const generator = config.generators.find((g) => g.provider.value === 'prisma-client-js') || config.generators[0];
  const outputDir = path.join(backendRoot, 'node_modules', '.prisma', 'client');
  fs.mkdirSync(outputDir, { recursive: true });
  await generateClient({
    datamodel,
    schemaPath,
    outputDir,
    generator,
    dmmf,
    datasources: config.datasources,
    binaryPaths: {},
    runtimeSourcePath: path.join(path.dirname(clientPkgPath), 'runtime'),
    engineVersion: enginesVersion,
    clientVersion,
    activeProvider: config.datasources[0].provider,
    compilerBuild: 'fast',
    copyRuntime: true,
  });
  log('prisma', `Client generated offline -> ${path.relative(backendRoot, outputDir)}`);
}

if (!tryCliGenerate()) {
  await offlineGenerate();
}
