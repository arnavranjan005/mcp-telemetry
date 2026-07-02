#!/usr/bin/env node
// Publishes each workspace independently, skipping any whose current
// package.json version is already live on the registry — `npm publish
// --workspaces` publishes every workspace unconditionally and aborts the
// whole command on the first failure, so if only one package actually
// changed version (the common case in this repo — a release can bump just
// the server, or just the sdk), publishing the OTHER unchanged package
// 403s and the one that actually changed never gets attempted at all.

import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesDir = path.join(rootDir, 'packages');

for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const pkgDir = path.join(packagesDir, dir.name);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const spec = `${pkg.name}@${pkg.version}`;

  let alreadyPublished = false;
  try {
    execFileSync('npm', ['view', spec, 'version'], { stdio: 'pipe' });
    alreadyPublished = true;
  } catch {
    // npm view exits non-zero (E404) when the version isn't published yet — expected, not an error.
  }

  if (alreadyPublished) {
    console.log(`${spec} already published — skipping`);
    continue;
  }

  console.log(`Publishing ${spec}`);
  const args = ['publish'];
  if (process.env.NPM_PUBLISH_PROVENANCE === 'true') args.push('--provenance');
  execFileSync('npm', args, { cwd: pkgDir, stdio: 'inherit' });
}
