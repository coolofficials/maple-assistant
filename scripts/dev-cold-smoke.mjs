import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
rmSync(path.join(root, 'dist-electron'), { recursive: true, force: true });
const child = spawn('npm', ['run', 'dev'], { cwd: root, detached: process.platform !== 'win32', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
let done = false;
const finish = async (success, reason) => {
  if (done) return; done = true;
  if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  else if (child.pid) { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
  process.stdout.write(output);
  if (!success) { console.error(reason); process.exitCode = 1; }
};
for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => {
  output += chunk.toString();
  if (output.includes('VITE') && output.includes('Found 0 errors') && output.includes('MAPLE_EDITOR_READY')) void finish(true, '');
});
child.on('error', error => void finish(false, `개발 앱 시작 실패: ${error.message}`));
child.on('exit', code => { if (!done) void finish(false, `개발 앱이 editor ready 전 종료됨 (code ${code}).`); });
setTimeout(() => { if (!done) void finish(false, '60초 내 editor ready를 확인하지 못했습니다.'); }, 60_000).unref();
