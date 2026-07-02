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

// shell: true — execFileSync('npm', ...) fails with ENOENT on Windows
// without it, since npm is a .cmd/.ps1 shim there, not a directly
// executable binary. This script runs both in CI (Linux) and via `npm run
// release` locally (which may be Windows), so it needs to work on both.
function npm(args, opts = {}) {
  return execFileSync('npm', args, { shell: true, ...opts });
}

for (const dir of readdirSync(packagesDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const pkgDir = path.join(packagesDir, dir.name);
  const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  const spec = `${pkg.name}@${pkg.version}`;

  let alreadyPublished = false;
  try {
    npm(['view', spec, 'version'], { stdio: 'pipe' });
    alreadyPublished = true;
  } catch (err) {
    // npm view exits non-zero with E404 when the version genuinely isn't
    // published yet — that's the expected, "go ahead and publish" case.
    // Any OTHER failure (network blip, auth, registry outage) must not be
    // silently treated the same way: doing so would attempt to publish a
    // version that likely already exists, fail there instead, and — since
    // that failure is intentionally NOT caught (see below) — abort the
    // whole script before later, genuinely-changed packages are attempted,
    // recreating the exact bug this script exists to fix.
    const output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    if (!output.includes('E404')) throw err;
  }

  if (alreadyPublished) {
    console.log(`${spec} already published — skipping`);
    continue;
  }

  console.log(`Publishing ${spec}`);
  const args = ['publish'];
  if (process.env.NPM_PUBLISH_PROVENANCE === 'true') args.push('--provenance');
  npm(args, { cwd: pkgDir, stdio: 'inherit' });
}
