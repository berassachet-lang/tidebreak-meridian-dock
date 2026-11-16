// TIDEBREAK — Meridian Dock: hands the game in.
// Copies game/ and screenshots/ from this repository into the output
// directory and writes /output/dossier.json with buildDossier from the
// kit's vendor/makefun-threejs.ts. Node 22, standard library only; no
// network, no installs, deterministic bytes on every run.
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const caps = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

function main(): void {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(join(repoRoot, 'game'), join(outDir, 'game'), { recursive: true });
  cpSync(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
  const dossier = buildDossier(outDir, caps);
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const parsed = JSON.parse(new TextDecoder('utf-8').decode(dossier)) as {
    text: string;
    images: unknown[];
  };
  console.log(`tidebreak: dossier ${dossier.length} bytes, text ${Buffer.byteLength(parsed.text, 'utf8')} bytes, ` +
    `${parsed.images.length} screenshots`);
}

main();
