import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const isFile = (p) => existsSync(p) && statSync(p).isFile();

export async function resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context);
  if (specifier.startsWith('@/')) {
    const base = join(root, specifier.slice(2));
    for (const p of [base, `${base}.js`, join(base, 'index.js')]) {
      if (isFile(p)) return next(pathToFileURL(p).href, context);
    }
  }
  return next(specifier, context);
}
