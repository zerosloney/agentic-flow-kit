import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const MANIFEST_REL = '.agents/install-manifest.json';

export function readManifest(target) {
  const file = path.join(target, MANIFEST_REL);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function writeManifest(target, manifest) {
  const file = path.join(target, MANIFEST_REL);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha256File(abs) {
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
}

export function emptyManifest({ kitVersion, language, hosts, stack }) {
  return {
    kit: 'agentic-flow-kit',
    version: kitVersion,
    installedAt: new Date().toISOString(),
    language,
    hosts,
    stack,
    files: {},
  };
}
