/**
 * dist → extension.zip 패키징 — Chrome Web Store 업로드용.
 * 외부 zip 바이너리 대신 Node 내장 + archiver 없이 순수 zip spec 구현은 과하므로,
 * 사용자 환경에 `zip`(Git Bash/WSL)이 있다고 가정. 없으면 수동으로 PowerShell
 * `Compress-Archive dist extension.zip` 사용.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dist = resolve('dist');
if (!existsSync(dist)) {
  console.error('dist/ not found. Run `pnpm build` first.');
  process.exit(1);
}
const out = resolve('extension.zip');
if (existsSync(out)) rmSync(out);

const r = spawnSync('zip', ['-r', out, '.'], { cwd: dist, stdio: 'inherit' });
if (r.status !== 0) {
  console.error(
    'zip command failed. On Windows without Git Bash, run manually:\n  powershell Compress-Archive dist/* extension.zip',
  );
  process.exit(r.status ?? 1);
}
console.log('packaged →', out);
