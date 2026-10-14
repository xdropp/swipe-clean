// Swipe Clean — detecção de jogos (Steam, Epic e jogos instalados por outros meios).
// Roda dentro da worker thread (scanner.js). Só lê arquivos; nunca altera nada.

const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { spawn } = require('child_process');

// ---------------------------------------------------------------- VDF (formato de texto da Steam)

function parseVDF(text) {
  const tokens = [];
  const re = /"((?:[^"\\]|\\.)*)"|([{}])|\/\/[^\n]*/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) tokens.push({ s: m[1].replace(/\\\\/g, '\\').replace(/\\"/g, '"') });
    else if (m[2]) tokens.push({ b: m[2] });
  }
  let i = 0;
  function obj() {
    const o = {};
    while (i < tokens.length) {
      const t = tokens[i++];
      if (t.b === '}') return o;
      if (t.s === undefined) continue;
      const next = tokens[i];
      if (!next) break;
      if (next.b === '{') {
        i++;
        o[t.s] = obj();
      } else if (next.s !== undefined) {
        i++;
        o[t.s] = next.s;
      }
    }
    return o;
  }
  return obj();
}

// chave sem diferenciar maiúsculas (a Steam às vezes muda "LastPlayed"/"lastplayed")
const get = (o, k) => {
  if (!o) return undefined;
  if (k in o) return o[k];
  const f = Object.keys(o).find((x) => x.toLowerCase() === k.toLowerCase());
  return f ? o[f] : undefined;
};

async function readText(p) {
  try {
    return await fsp.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

function regQuery(key, value) {
  return new Promise((resolve) => {
    const child = spawn('reg.exe', ['query', key, '/v', value], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const m = out.match(new RegExp(value + '\\s+REG_\\w+\\s+(.+)', 'i'));
      resolve(m ? m[1].trim() : null);
    });
  });
}

// ---------------------------------------------------------------- Steam

// apps da Steam que não são jogos (runtimes, redistribuíveis, ferramentas)
const STEAM_SKIP = new Set(['228980', '1070560', '1391110', '1628350', '1493710', '1826330', '2180100', '2805730', '1054830', '1161040', '1245040', '1420170', '1580130', '1887720', '2348590', '3658110']);
const STEAM_SKIP_NAME = /^(steamworks common|steam linux runtime|proton\b|steamvr\b.*(beta|driver)|steam audio)/i;

async function steamRoot() {
  const candidates = [];
  const reg = await regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath');
  if (reg) candidates.push(reg.replace(/\//g, '\\'));
  const reg2 = await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath');
  if (reg2) candidates.push(reg2);
  candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  for (const c of candidates) if (await exists(path.join(c, 'steamapps'))) return c;
  return null;
}

async function findSteamCover(root, appid) {
  const cache = path.join(root, 'appcache', 'librarycache');
  const prefer = [/^library_600x900(_2x)?\.jpg$/i, /^library_capsule(_2x)?\.jpg$/i, /^library_header(_2x)?\.jpg$/i, /^header\.jpg$/i];
  // formato novo: librarycache/<appid>/<hash>/library_600x900.jpg (ou direto na pasta)
  const found = [];
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isFile()) found.push(p);
      else if (e.isDirectory() && depth < 2) await walk(p, depth + 1);
    }
  }
  await walk(path.join(cache, String(appid)), 0);
  for (const re of prefer) {
    const hit = found.find((f) => re.test(path.basename(f)));
    if (hit) return { path: hit, portrait: /600x900|capsule/i.test(hit) };
  }
  // formato antigo: librarycache/<appid>_library_600x900.jpg
  for (const [suffix, portrait] of [['_library_600x900.jpg', true], ['_header.jpg', false]]) {
    const p = path.join(cache, appid + suffix);
    if (await exists(p)) return { path: p, portrait };
  }
  return null;
}

async function listSteamGames(ctx) {
  const root = await steamRoot();
  if (!root) {
    ctx.log('Steam não encontrada');
    return [];
  }
  const vdf = await readText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
  // o Windows não diferencia maiúsculas: "c:\program files (x86)\steam" e "C:\Program Files (x86)\Steam" são a mesma pasta
  const libs = new Map();
  const addLib = (p) => {
    const k = path.resolve(p).toLowerCase().replace(/[\\/]+$/, '');
    if (!libs.has(k)) libs.set(k, p);
  };
  addLib(root);
  if (vdf) {
    const data = parseVDF(vdf);
    const lf = get(data, 'libraryfolders') || {};
    for (const k of Object.keys(lf)) {
      const p = get(lf[k], 'path');
      if (p) addLib(p);
    }
  }
  ctx.log(`Steam em ${root}, ${libs.size} biblioteca(s): ${[...libs.values()].join(' | ')}`);

  const games = [];
  const seenApps = new Set();
  for (const lib of libs.values()) {
    const sa = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = (await fsp.readdir(sa)).filter((f) => /^appmanifest_\d+\.acf$/i.test(f));
    } catch {
      continue;
    }
    for (const f of files) {
      const manifestPath = path.join(sa, f);
      const text = await readText(manifestPath);
      if (!text) continue;
      const st = get(parseVDF(text), 'AppState');
      if (!st) continue;
      const appid = String(get(st, 'appid') || '');
      const name = get(st, 'name') || `App ${appid}`;
      if (!appid || seenApps.has(appid) || STEAM_SKIP.has(appid) || STEAM_SKIP_NAME.test(name)) continue;
      seenApps.add(appid);
      const installdir = get(st, 'installdir') || '';
      const location = path.join(sa, 'common', installdir);
      let size = Number(get(st, 'SizeOnDisk') || 0);
      if (!size && installdir && (await exists(location))) size = await ctx.dirSize(location);
      const lastPlayed = Number(get(st, 'LastPlayed') || 0);
      const lastUpdated = Number(get(st, 'LastUpdated') || 0);
      const cover = await findSteamCover(root, appid);
      games.push({
        id: 'g:steam:' + appid,
        kind: 'game',
        platform: 'steam',
        name,
        publisher: '',
        appid,
        location,
        manifestPath,
        size,
        lastUsed: lastPlayed > 0 ? lastPlayed * 1000 : null,
        neverPlayed: lastPlayed === 0,
        updated: lastUpdated ? lastUpdated * 1000 : null,
        coverPath: cover ? cover.path : null,
        coverPortrait: cover ? cover.portrait : false,
      });
    }
  }
  return games;
}

// ---------------------------------------------------------------- Epic Games

async function listEpicGames(ctx) {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.item'));
  } catch {
    ctx.log('Epic Games não encontrada');
    return [];
  }
  const games = [];
  for (const f of files) {
    const manifestPath = path.join(dir, f);
    let d;
    try {
      d = JSON.parse((await readText(manifestPath)).replace(/^\uFEFF/, ''));
    } catch {
      continue;
    }
    // DLCs e conteúdos extras ficam de fora (são removidos junto com o jogo principal)
    if (d.MainGameAppName || d.bIsApplication === false) continue;
    if ((d.AppCategories || []).includes('hidden') && !(d.AppCategories || []).includes('games')) continue;
    if (!d.InstallLocation || !(await exists(d.InstallLocation))) continue;
    const exe = d.LaunchExecutable ? path.basename(d.LaunchExecutable).toUpperCase() : null;
    let lastUsed = exe ? ctx.prefetch.map.get(exe) || null : null;
    if (!lastUsed) {
      // procura qualquer .exe do jogo no histórico do Windows
      const exes = await ctx.findExes(d.InstallLocation, 4, 200);
      for (const x of exes) {
        const t = ctx.prefetch.map.get(path.basename(x).toUpperCase());
        if (t && (!lastUsed || t > lastUsed)) lastUsed = t;
      }
    }
    let installed = null;
    try {
      installed = (await fsp.stat(d.InstallLocation)).birthtimeMs || null;
    } catch {}
    games.push({
      id: 'g:epic:' + String(d.AppName || f).toLowerCase(),
      kind: 'game',
      platform: 'epic',
      name: d.DisplayName || d.AppName,
      publisher: '',
      location: d.InstallLocation,
      manifestPath,
      size: Number(d.InstallSize || 0) || (await ctx.dirSize(d.InstallLocation)),
      lastUsed,
      installed,
      epicApp: d.AppName,
      epicNamespace: d.CatalogNamespace,
      epicItem: d.CatalogItemId,
    });
  }
  return games;
}

// ---------------------------------------------------------------- jogos instalados por outros meios

const GAME_PUBLISHERS =
  /(riot games|electronic arts|\bea\b|ubisoft|activision|blizzard|rockstar games|bethesda|cd projekt|grinding gear|mojang|bungie|square enix|capcom|bandai namco|sega|2k games|take-two|wizards of the coast|hoyoverse|mihoyo|cognosphere|krafton|nexon|garena|hi-rez|paradox interactive|focus entertainment|deep silver|warner bros\. games|wb games|epic games inc|insomniac|naughty dog|sony interactive|playstation pc|arrowhead|kojima|remedy|larian|fromsoftware|devolver|team17|thq nordic|plaion|koei tecmo|netease games|tencent games|level infinite|smilegate|pearl abyss|gaijin|wargaming|innersloth|supercell|mediatonic|respawn|digital extremes|gearbox|xbox game studios)/i;
const GAME_FOLDERS = /\\(steamapps|epic games|riot games|ea games|ea app games|origin games|ubisoft game launcher\\games|gog galaxy\\games|gog games|xboxgames|games|jogos|battle\.net\\games|rockstar games)\\/i;
// launchers, anti-cheats e ferramentas de jogos são "aplicativos", não jogos
const NOT_GAME =
  /(launcher|client|app\b|desktop app|store|overlay|anti-?cheat|easyanticheat|battleye|vanguard|redistributable|runtime|directx|physx|driver|toolkit|sdk|editor|server|mod manager|helper|updater|uplay|ubisoft connect|ea app|origin\b|battle\.net|gog galaxy|steam\b|discord|geforce|nvidia|radeon|afterburner|rivatuner|controller|ds4windows|overwolf|medal|obs studio)/i;

function isGameProgram(p) {
  const name = p.name || '';
  if (NOT_GAME.test(name)) return false;
  const loc = (p.location || '') + '\\';
  if (GAME_FOLDERS.test(loc)) return true;
  if (GAME_PUBLISHERS.test(p.publisher || '')) return true;
  return false;
}

module.exports = { parseVDF, listSteamGames, listEpicGames, isGameProgram };
