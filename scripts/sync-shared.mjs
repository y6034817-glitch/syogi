// src/game のルールエンジンを、Edge Function の共有フォルダへコピーする。
// ルールを変更したら `npm run sync:functions` を実行してからデプロイしてください。
//   src/game/*.ts  →  supabase/functions/_shared/game/*.ts

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = ['types.ts', 'position.ts', 'movegen.ts', 'notation.ts', 'session.ts', 'replay.ts'];
const outDir = join(root, 'supabase/functions/_shared/game');
mkdirSync(outDir, { recursive: true });

for (const f of files) {
  copyFileSync(join(root, 'src/game', f), join(outDir, f));
}

// 共有ファイルが、共有対象外のファイル（clock.ts など）を読み込んでいないことを確認する
for (const f of files) {
  const src = readFileSync(join(outDir, f), 'utf8');
  for (const m of src.matchAll(/from\s+'(\.[^']+)'/g)) {
    const dep = m[1].replace('./', '');
    if (!files.includes(dep)) {
      console.error(`NG: ${f} が共有対象外の ${dep} を読み込んでいます`);
      process.exit(1);
    }
  }
}
console.log(`OK: ${files.length} ファイルを ${outDir} にコピーしました`);
