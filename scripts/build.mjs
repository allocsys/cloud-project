// next/font/google downloads Roboto at build time. A network hiccup makes
// that fetch throw and fails the whole build. Retry only for that error;
// any other failure exits immediately.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');
const MAX = 3;
const FONT_FLAKE = /next\/font|fonts\.googleapis|fonts\.gstatic|google\/loader/i;

function run() {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(process.execPath, [nextBin, 'build'], {
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => { out += d; process.stderr.write(d); });
    child.on('close', (code) => resolve({ code: code ?? 1, out }));
  });
}

for (let i = 1; i <= MAX; i++) {
  const { code, out } = await run();
  if (code === 0) process.exit(0);
  if (i === MAX || !FONT_FLAKE.test(out)) process.exit(code);
  console.log(`\nGoogle font fetch failed, retrying build (${i + 1}/${MAX}) in ${i * 3}s...\n`);
  await new Promise((r) => setTimeout(r, i * 3000));
}
