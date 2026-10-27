// Publishes this repo to GitHub and attaches the built installer as a release asset.
// Usage (token comes from the local git credential store, never printed):
//   node scripts/publish-github.mjs repo
//   node scripts/publish-github.mjs release <owner> <repo> <tag> <installer-path>

import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';
const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error('[publish] GITHUB_TOKEN is not set');
  process.exit(1);
}

const baseHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'BibleReader-publish',
};

async function api(url, { method = 'GET', body, headers } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...baseHeaders, ...(headers || {}) },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const err = new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

const mode = process.argv[2];

if (mode === 'repo') {
  const me = await api(`${API}/user`);
  console.log('[publish] authenticated as', me.login);

  const name = process.argv[3] || 'BibleReader';
  try {
    const repo = await api(`${API}/user/repos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        private: true,
        description:
          'Windows Bible reader with highlight-to-speak TTS (Traditional Chinese, English, Spanish, French).',
        has_issues: true,
        has_wiki: false,
        has_projects: false,
        auto_init: false,
      }),
    });
    console.log('[publish] created', repo.full_name, '| private:', repo.private);
    console.log('[publish] clone url:', repo.clone_url);
  } catch (e) {
    if (e.status === 422) {
      const existing = await api(`${API}/repos/${me.login}/${name}`);
      console.log('[publish] repo already exists:', existing.full_name, '| private:', existing.private);
      console.log('[publish] clone url:', existing.clone_url);
    } else {
      throw e;
    }
  }
}

if (mode === 'release') {
  const [owner, repo, tag, file] = process.argv.slice(3);
  if (!owner || !repo || !tag || !file) {
    console.error('[publish] usage: release <owner> <repo> <tag> <file>');
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error('[publish] missing asset:', file);
    process.exit(1);
  }

  let release;
  try {
    release = await api(`${API}/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: `BibleReader ${tag}`,
        draft: false,
        prerelease: false,
        body: [
          'Windows desktop Bible reader with highlight-to-speak TTS.',
          '',
          '**Languages:** Traditional Chinese (default, Mandarin + Cantonese voices), English, Spanish, French.',
          '',
          '**Features:** full 66-book canon, select-text-to-speak with word-level karaoke highlighting,',
          'continuous chapter playback, on-disk cache with offline reads, OS-voice fallback, light/dark themes.',
          '',
          '**Note:** the installer is unsigned, so Windows SmartScreen will warn on first run',
          '(More info → Run anyway).',
        ].join('\n'),
      }),
    });
    console.log('[publish] created release', release.tag_name, release.html_url);
  } catch (e) {
    if (e.status === 422) {
      const all = await api(`${API}/repos/${owner}/${repo}/releases`);
      release = all.find((r) => r.tag_name === tag);
      console.log('[publish] release already exists:', release?.html_url);
    } else {
      throw e;
    }
  }
  if (!release) throw new Error('could not resolve release');

  const existing = await api(`${API}/repos/${owner}/${repo}/releases/${release.id}/assets`);
  const assetName = path.basename(file);
  if (existing.some((a) => a.name === assetName)) {
    console.log('[publish] asset already uploaded:', assetName);
  } else {
    const buf = fs.readFileSync(file);
    console.log('[publish] uploading', assetName, (buf.length / 1048576).toFixed(1), 'MB');
    const asset = await api(
      `${UPLOADS}/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(assetName)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: buf,
      }
    );
    console.log('[publish] uploaded:', asset.name, asset.state, asset.browser_download_url);
  }
}
