// Swipe Clean — atualização automática pelo GitHub Releases.
//
// 1. Consulta a versão mais nova em api.github.com (só o número da versão, nada sobre o PC).
// 2. Versão instalada: baixa o SwipeClean-Setup, confere o SHA-256 publicado no Release
//    (SHA256SUMS.txt) e roda o instalador em modo silencioso, que reabre o app no fim.
// 3. Versão portátil ou de desenvolvimento: só avisa e abre a página de download.

const { app, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'xdropp/swipe-clean';
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

// "v1.10.0" > "1.9.3"
function parseVersion(v) {
  return String(v || '')
    .replace(/^v/i, '')
    .split(/[.+-]/)
    .slice(0, 3)
    .map((n) => parseInt(n, 10) || 0);
}
function isNewer(remote, local) {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

// Como o app está rodando: instalado (pode se atualizar sozinho), portátil ou código-fonte
function installKind() {
  if (!app.isPackaged) return 'dev';
  if (process.windowsStore) return 'store'; // a Microsoft Store atualiza sozinha
  if (process.env.PORTABLE_EXECUTABLE_FILE) return 'portable';
  return 'installed';
}

async function fetchJSON(url) {
  const res = await net.fetch(url, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SwipeClean-Updater' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function check() {
  if (installKind() === 'store') return { current: app.getVersion(), version: app.getVersion(), available: false, kind: 'store', canInstall: false };
  const rel = await fetchJSON(`https://api.github.com/repos/${REPO}/releases/latest`);
  const version = String(rel.tag_name || '').replace(/^v/i, '');
  const setup = (rel.assets || []).find((a) => /^SwipeClean-Setup-.*\.exe$/i.test(a.name));
  const sums = (rel.assets || []).find((a) => /^SHA256SUMS\.txt$/i.test(a.name));
  const kind = installKind();
  return {
    current: app.getVersion(),
    version,
    available: !!version && isNewer(version, app.getVersion()),
    notesUrl: rel.html_url || RELEASES_PAGE,
    kind,
    canInstall: kind === 'installed' && !!setup && !!sums,
    setupUrl: setup ? setup.browser_download_url : null,
    setupName: setup ? setup.name : null,
    setupSize: setup ? setup.size : 0,
    sumsUrl: sums ? sums.browser_download_url : null,
  };
}

async function download(url, file, total, onProgress) {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
  const size = Number(res.headers.get('content-length')) || total || 0;
  const out = fs.createWriteStream(file);
  const hash = crypto.createHash('sha256');
  const reader = res.body.getReader();
  let got = 0;
  let last = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      got += chunk.length;
      const pct = size ? Math.floor((got / size) * 100) : 0;
      if (pct !== last) {
        last = pct;
        onProgress && onProgress(pct);
      }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  return hash.digest('hex');
}

// Baixa, confere e instala. Só retorna se algo falhar (em caso de sucesso o app fecha).
async function install(info, { onProgress, log, beforeQuit }) {
  if (!info || !info.canInstall) throw new Error('not-installable');
  const sumsText = await (await net.fetch(info.sumsUrl, { signal: AbortSignal.timeout(15000) })).text();
  const line = sumsText.split(/\r?\n/).find((l) => l.toLowerCase().includes(info.setupName.toLowerCase()));
  const expected = line ? line.trim().split(/\s+/)[0].toLowerCase() : null;
  if (!expected || !/^[0-9a-f]{64}$/.test(expected)) throw new Error('checksum-missing');

  const dir = path.join(app.getPath('temp'), 'swipe-clean-update');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, info.setupName);
  log && log(`Atualização: baixando ${info.setupName}`);
  const actual = await download(info.setupUrl, file, info.setupSize, onProgress);
  if (actual !== expected) {
    try {
      fs.unlinkSync(file);
    } catch {}
    throw new Error('checksum-mismatch');
  }
  log && log(`Atualização: SHA-256 conferido (${actual.slice(0, 12)}…), abrindo o instalador`);

  // /S = silencioso; --updated e --force-run fazem o instalador do electron-builder reabrir o app no fim
  const child = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' });
  child.unref();
  beforeQuit && beforeQuit();
  setTimeout(() => app.quit(), 400);
}

module.exports = { check, install, isNewer, parseVersion, RELEASES_PAGE, openReleases: () => shell.openExternal(RELEASES_PAGE) };
