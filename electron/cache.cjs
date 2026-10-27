// Filesystem cache for chapters and synthesized audio, with LRU eviction.
// Deliberately no native modules: everything is JSON + blobs under the app data dir,
// so there is no better-sqlite3 rebuild step per Electron/Node ABI.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHAPTER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_CAP_MB = Number(process.env.BIBLEREADER_CACHE_MB || 500);

let root = null;
let dirs = null;
let index = null;

function init() {
  if (root) return;
  // Electron's app path when available; env override keeps this testable outside Electron.
  let base = process.env.BIBLEREADER_CACHE_DIR;
  if (!base) {
    try {
      base = require('electron').app.getPath('userData');
    } catch {
      base = path.join(process.cwd(), '.cache');
    }
  }
  root = path.join(base, 'cache');
  dirs = {
    chapters: path.join(root, 'chapters'),
    audio: path.join(root, 'audio'),
    index: path.join(root, 'index.json'),
  };
  for (const d of [root, dirs.chapters, dirs.audio]) fs.mkdirSync(d, { recursive: true });
  index = loadIndex();
}

function loadIndex() {
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(dirs.index, 'utf8'));
  } catch {
    obj = { entries: {}, totalBytes: 0 };
  }
  // If the index was lost or truncated but blobs remain, rebuild from the filesystem so
  // LRU accounting and the size cap keep working.
  if (!obj.entries || Object.keys(obj.entries).length === 0) {
    const rebuilt = rebuildIndex();
    if (rebuilt) return rebuilt;
  }
  return obj;
}

function rebuildIndex() {
  const entries = {};
  let total = 0;
  try {
    for (const f of fs.readdirSync(dirs.audio)) {
      if (!f.endsWith('.mp3')) continue;
      const key = f.slice(0, -4);
      const p = path.join(dirs.audio, f);
      const mp = path.join(dirs.audio, `${key}.json`);
      const st = fs.statSync(p);
      const metaBytes = fs.existsSync(mp) ? fs.statSync(mp).size : 0;
      entries[`audio:${key}`] = {
        type: 'audio',
        path: p,
        metaPath: mp,
        bytes: st.size + metaBytes,
        createdAt: st.mtimeMs,
        lastUsed: st.mtimeMs,
      };
      total += st.size + metaBytes;
    }
    for (const f of fs.readdirSync(dirs.chapters)) {
      if (!f.endsWith('.json')) continue;
      const p = path.join(dirs.chapters, f);
      const st = fs.statSync(p);
      entries[`chapter:${f.slice(0, -5)}`] = {
        type: 'chapter',
        path: p,
        bytes: st.size,
        createdAt: st.mtimeMs,
        lastUsed: st.mtimeMs,
      };
      total += st.size;
    }
  } catch {
    return null;
  }
  if (!Object.keys(entries).length) return null;
  return { entries, totalBytes: total };
}

let saveTimer = null;
function saveIndex() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.writeFileSync(dirs.index, JSON.stringify(index));
    } catch {
      /* index is a cache of a cache; losing it is recoverable */
    }
  }, 50);
}

function touch(key) {
  const e = index.entries[key];
  if (e) {
    e.lastUsed = Date.now();
    saveIndex();
  }
}

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function chapterPath(translation, book, chapter) {
  return path.join(dirs.chapters, `${translation}-${book}-${chapter}.json`);
}

// ---------------- chapters ----------------
function getChapter(translation, book, chapter) {
  init();
  const p = chapterPath(translation, book, chapter);
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const obj = JSON.parse(raw);
    if (Date.now() - obj.fetchedAt > CHAPTER_TTL_MS) return null;
    return { verses: obj.verses, fetchedAt: obj.fetchedAt, fromCache: true };
  } catch {
    return null;
  }
}

function putChapter(translation, book, chapter, verses) {
  init();
  const p = chapterPath(translation, book, chapter);
  const obj = { translation, book, chapter, verses, fetchedAt: Date.now() };
  try {
    fs.writeFileSync(p, JSON.stringify(obj));
  } catch {
    return;
  }
  const key = `chapter:${translation}-${book}-${chapter}`;
  index.entries[key] = {
    type: 'chapter',
    path: p,
    bytes: Buffer.byteLength(JSON.stringify(obj)),
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };
  recount();
  evict();
  saveIndex();
}

// ---------------- audio ----------------
function audioKey({ voice, rate, text }) {
  return sha256(`${voice}|${rate || 'default'}|${text}`);
}

function audioPaths(key) {
  return { audio: path.join(dirs.audio, `${key}.mp3`), meta: path.join(dirs.audio, `${key}.json`) };
}

function getAudio(key) {
  init();
  const { audio, meta } = audioPaths(key);
  try {
    const m = JSON.parse(fs.readFileSync(meta, 'utf8'));
    const buf = fs.readFileSync(audio);
    touch(`audio:${key}`);
    return { ...m, buffer: buf, fromCache: 'disk' };
  } catch {
    return null;
  }
}

function putAudio(key, buffer, meta) {
  init();
  const { audio, meta: metaPath } = audioPaths(key);
  try {
    fs.writeFileSync(audio, buffer);
    fs.writeFileSync(metaPath, JSON.stringify(meta));
  } catch {
    return;
  }
  index.entries[`audio:${key}`] = {
    type: 'audio',
    path: audio,
    metaPath,
    bytes: buffer.length + Buffer.byteLength(JSON.stringify(meta)),
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };
  recount();
  evict();
  saveIndex();
}

// ---------------- maintenance ----------------
function recount() {
  index.totalBytes = Object.values(index.entries).reduce((a, e) => a + (e.bytes || 0), 0);
}

function evict() {
  const cap = DEFAULT_CAP_MB * 1024 * 1024;
  if (index.totalBytes <= cap) return;
  const victims = Object.entries(index.entries).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [key, e] of victims) {
    if (index.totalBytes <= cap) break;
    try {
      fs.rmSync(e.path, { force: true });
      if (e.metaPath) fs.rmSync(e.metaPath, { force: true });
    } catch {
      /* ignore */
    }
    delete index.entries[key];
    index.totalBytes -= e.bytes || 0;
  }
  saveIndex();
}

function stats() {
  init();
  const entries = Object.values(index.entries);
  return {
    root,
    capBytes: DEFAULT_CAP_MB * 1024 * 1024,
    totalBytes: index.totalBytes,
    chapters: entries.filter((e) => e.type === 'chapter').length,
    audio: entries.filter((e) => e.type === 'audio').length,
  };
}

function clearAll() {
  init();
  for (const d of [dirs.chapters, dirs.audio]) {
    for (const f of fs.readdirSync(d)) fs.rmSync(path.join(d, f), { force: true });
  }
  index = { entries: {}, totalBytes: 0 };
  saveIndex();
}

module.exports = {
  getChapter,
  putChapter,
  getAudio,
  putAudio,
  audioKey,
  stats,
  clearAll,
  CHAPTER_TTL_MS,
};
