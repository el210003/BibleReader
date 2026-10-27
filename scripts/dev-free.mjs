// Frees port 5173 by killing whatever is listening on it. Windows-first, with a
// POSIX fallback so this also works from WSL/Git-Bash on other platforms.

import { execSync } from 'node:child_process';

const PORT = 5173;

function pidsWindows() {
  const out = execSync(`netstat -ano | findstr :${PORT}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  const pids = new Set();
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const pid = cols[cols.length - 1];
    if (pid && /^\d+$/.test(pid)) pids.add(pid);
  }
  return [...pids];
}

function pidsPosix() {
  try {
    const out = execSync(`lsof -ti tcp:${PORT} -sTCP:LISTEN`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

const pids = process.platform === 'win32' ? pidsWindows() : pidsPosix();

if (!pids.length) {
  console.log(`[dev:free] nothing listening on ${PORT}`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    execSync(process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    console.log(`[dev:free] killed pid ${pid}`);
  } catch (e) {
    console.log(`[dev:free] could not kill pid ${pid}: ${String(e).slice(0, 80)}`);
  }
}
