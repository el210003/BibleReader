// Preflight for `npm run dev`: a stale Vite server holding 5173 makes the dev script die
// with a cryptic "Port 5173 is already in use" while concurrently kills Electron, leaving
// no window at all. Detect that first and say what to do.

import net from 'node:net';

const PORT = 5173;

function probe(host) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: PORT, timeout: 600 });
    const done = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
  });
}

const busyV4 = await probe('127.0.0.1');
const busyV6 = busyV4 ? true : await probe('::1');

if (busyV4 || busyV6) {
  console.error('');
  console.error(`[dev] Port ${PORT} is already in use.`);
  console.error('      A Vite dev server from a previous session is probably still running.');
  console.error('');
  console.error('      Free it:   npm run dev:free');
  console.error('      Or skip the dev server entirely:   npm start');
  console.error('');
  process.exit(1);
}

process.exit(0);
