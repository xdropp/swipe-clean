// Swipe Clean — interface (resumo, cartas, revisão, progresso e configurações)
// Tudo fica dentro de uma função para nenhum nome colidir com variáveis globais da janela.
(() => {
'use strict';

const api = window.swipeApi;
const logToFile = (t) => {
  try {
    if (api && api.log) api.log(t);
  } catch {}
};
window.addEventListener('error', (e) => logToFile(`Erro: ${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => logToFile('Promise rejeitada: ' + ((e.reason && e.reason.stack) || e.reason)));
const DEMO = !api || api.platform !== 'win32';
const $ = (s) => document.querySelector(s);

// ---------------------------------------------------------------- idioma
const I18N = window.SwipeI18n;
const demoLang = () => new URLSearchParams(location.search).get('lang') || navigator.language;
let lang = I18N.resolve(demoLang());
let t = I18N.createT(lang);
let loc = I18N.locale(lang);
let nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });

function setLanguage(l) {
  lang = l;
  t = I18N.createT(lang);
  loc = I18N.locale(lang);
  nf = new Intl.NumberFormat(loc, { maximumFractionDigits: 1 });
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)));
  document.querySelectorAll('[data-i18n-title]').forEach((el) => (el.title = t(el.dataset.i18nTitle)));
}
setLanguage(lang);

const state = {
  items: [],
  decided: new Map(), // id -> 'keep' | 'remove'
  history: [], // ids na ordem em que foram decididos
  front: null, // id que deve voltar ao topo (desfazer)
  cat: 'games',
  kept: {}, // decisões "manter" salvas entre sessões
  settings: { onlineCovers: true, showKept: false, showSystem: false, autoUpdate: true },
  info: { version: '', admin: false },
  donate: { enabled: false },
  update: null, // resultado da última verificação de atualização
  updateStatus: '', // texto mostrado nas Configurações
  donateIdx: 0,
  disk: null,
  prefetchAvailable: true,
  maxSize: 1,
  animating: false,
};

// ---------------------------------------------------------------- formatação

function fmtBytes(b) {
  if (!b) return { n: '?', u: '' };
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024;
    i++;
  }
  return { n: nf.format(b), u: units[i] };
}
const bytes = (b) => {
  const f = fmtBytes(b);
  return f.u ? `${f.n} ${f.u}` : t('size.unknown');
};
const items = (n) => t('n.items', { n });

function fmtInstallDate(s) {
  if (!s || !/^\d{8}$/.test(s)) return null;
  return new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)).toLocaleDateString(loc);
}
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString(loc) : null);
function ago(ms) {
  if (!ms) return null;
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return t('ago.today');
  if (d === 1) return t('ago.yesterday');
  if (d < 30) return t('ago.days', { n: d });
  const m = Math.floor(d / 30);
  if (m < 12) return t('ago.months', { n: m });
  return t('ago.years', { n: Math.floor(d / 365) });
}
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shortPath = (p) => {
  if (!p) return '—';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? '…\\' + parts.slice(-2).join('\\') : p;
};
const OLD = 90 * 86400000;

// ---------------------------------------------------------------- categorias e tipos

const CAT_EMOJI = { games: '🎮', apps: '🧩', folders: '📁' };
const CATS = new Proxy(
  {},
  { get: (_o, c) => ({ label: t('cat.' + c), emoji: CAT_EMOJI[c], empty: t('cat.' + c + '.empty') }) }
);
const CAT_ORDER = ['games', 'apps', 'folders'];

const catOf = (it) => (it.kind === 'game' || it.isGame ? 'games' : it.kind === 'program' || it.kind === 'store' ? 'apps' : 'folders');

const PLATFORM_LABEL = { steam: 'Steam', epic: 'Epic Games', pc: 'PC' };
const PLATFORM_ACTION = { steam: 'action.steam', epic: 'action.epic', pc: 'action.uninstaller' };
const PLATFORM = new Proxy({}, { get: (_o, p) => ({ label: PLATFORM_LABEL[p], action: t(PLATFORM_ACTION[p]) }) });
const platformOf = (it) => (it.kind === 'game' ? it.platform : 'pc');

const KIND_DEF = {
  game: ['🎮', null],
  program: ['🧩', 'action.uninstaller'],
  store: ['🛍️', 'action.store'],
  temp: ['🧹', 'action.wipe'],
  cache: ['♻️', 'action.wipe'],
  download: ['⬇️', 'action.trash'],
  user: ['🗂️', 'action.trash'],
  appdata: ['🗃️', 'action.trash'],
};
const KIND = new Proxy(
  {},
  { get: (_o, k) => ({ label: t('kind.' + k), emoji: KIND_DEF[k][0], action: KIND_DEF[k][1] ? t(KIND_DEF[k][1]) : '' }) }
);
const actionOf = (it) => (catOf(it) === 'games' ? PLATFORM[platformOf(it)].action : KIND[it.kind].action);
const kindLabel = (it) =>
  catOf(it) === 'games' ? (it.kind === 'game' ? t('kind.gameOn', { platform: PLATFORM[it.platform].label }) : t('kind.game')) : KIND[it.kind].label;

const iconHTML = (it) => {
  if (it.cover) return `<img class="thumb-cover" src="${it.cover}" alt="" />`;
  if (it.icon) return `<img src="${it.icon}" alt="" />`;
  if (catOf(it) === 'games') return fallbackCover(it);
  return it.isDir === false && it.kind !== 'temp' ? '📄' : KIND[it.kind].emoji;
};

// capa genérica quando não há imagem: gradiente estável por nome + iniciais
function hueOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function initials(name) {
  const words = String(name)
    .replace(/[™®©:]/g, '')
    .split(/[\s\-_]+/)
    .filter((w) => /[a-z0-9]/i.test(w) && !/^(de|da|do|das|dos|e|of|the|a|o|and|&)$/i.test(w));
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2)).toUpperCase();
}
function fallbackCover(it) {
  const h = hueOf(it.name);
  return `<div class="cover-fallback" style="--h1:${h};--h2:${(h + 50) % 360}"><span>${esc(initials(it.name))}</span></div>`;
}

// só conta para a barra do disco o que está na mesma unidade do Windows
const onSystemDrive = (it) => {
  const p = it.path || it.location;
  if (!p || !state.disk) return true;
  return p.slice(0, 2).toUpperCase() === state.disk.root.slice(0, 2).toUpperCase();
};

// ---------------------------------------------------------------- telas e topo

function show(name) {
  document.querySelectorAll('.screen').forEach((s) => (s.hidden = s.id !== 'screen-' + name));
}

const removeList = () => state.items.filter((it) => state.decided.get(it.id) === 'remove');

function updateTop() {
  const d = state.disk;
  const queue = removeList();
  const pendingBytes = queue.reduce((a, b) => a + (b.size || 0), 0);
  const pendingSys = queue.filter(onSystemDrive).reduce((a, b) => a + (b.size || 0), 0);
  if (d && d.total) {
    const used = d.total - d.free;
    $('#diskLabel').textContent = t('top.disk', { d: d.root.replace(/\\$/, '') });
    $('#diskFree').textContent = t('top.free', { free: bytes(d.free), total: bytes(d.total) });
    $('#diskUsed').style.width = `${(Math.max(0, used - pendingSys) / d.total) * 100}%`;
    $('#diskPending').style.width = `${(Math.min(pendingSys, used) / d.total) * 100}%`;
  }
  const pill = $('#queuePill');
  pill.hidden = queue.length === 0;
  pill.textContent = t('top.pill', { items: items(queue.length), size: bytes(pendingBytes) });
}

// ---------------------------------------------------------------- resumo

// o que foi mantido em análises anteriores some (a não ser que a configuração peça);
// o que foi decidido nesta sessão continua contando
function visible(it) {
  if (it.system && !state.settings.showSystem && !state.decided.has(it.id)) return false;
  return state.settings.showKept || !state.kept[it.id] || state.decided.has(it.id);
}

function renderSummary() {
  const total = state.items.filter(visible);
  const totalBytes = total.reduce((a, b) => a + (b.size || 0), 0);
  $('#summaryTitle').textContent = t('summary.title', { n: total.length });
  const hiddenSystem = state.settings.showSystem ? 0 : state.items.filter((it) => it.system && !state.decided.has(it.id)).length;
  const hiddenKept = state.items.length - total.length - hiddenSystem;
  const notes = [];
  if (hiddenSystem) notes.push(t('summary.hiddenSystem', { n: hiddenSystem }));
  if (hiddenKept > 0) notes.push(t('summary.hiddenKept', { n: hiddenKept }));
  $('#summarySub').innerHTML =
    esc(t('summary.sub', { size: bytes(totalBytes) })) +
    (notes.length ? `<br/><span class="hidden-note">${esc(notes.join(' · '))} · <button class="link" id="hiddenSettings">${esc(t('summary.seeSettings'))}</button></span>` : '');
  const hs = $('#hiddenSettings');
  if (hs) hs.addEventListener('click', () => {
    renderSettings();
    $('#settings').hidden = false;
  });

  $('#tiles').innerHTML = CAT_ORDER.map((c) => {
    const all = total.filter((it) => catOf(it) === c);
    const left = all.filter((it) => !state.decided.has(it.id));
    const size = all.reduce((a, b) => a + (b.size || 0), 0);
    const top = [...all].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 3);
    let preview = '';
    if (c === 'games') {
      preview = `<div class="tile-covers">${top
        .map((g, i) => `<div class="tc tc${i}">${g.cover ? `<img src="${g.cover}" alt="" />` : fallbackCover(g)}</div>`)
        .join('')}</div>`;
    } else {
      preview = `<div class="tile-icons">${top.map((it) => `<div class="icon">${iconHTML(it)}</div>`).join('')}</div>`;
    }
    const done = all.length && !left.length;
    return `<button class="tile ${all.length ? '' : 'empty'}" data-cat="${c}" ${all.length ? '' : 'disabled'}>
      <div class="tile-preview">${all.length ? preview : `<div class="tile-none">${CATS[c].emoji}</div>`}</div>
      <div class="tile-body">
        <div class="tile-title">${CATS[c].emoji} ${CATS[c].label}</div>
        <div class="tile-size">${all.length ? bytes(size) : '—'}</div>
        <div class="tile-count">${
          all.length ? (done ? t('tile.allDone') : t('tile.cardsLeft', { n: left.length })) : CATS[c].empty
        }</div>
        <ul class="tile-top">${top.map((it) => `<li><span>${esc(it.name)}</span><b>${bytes(it.size)}</b></li>`).join('')}</ul>
      </div>
      <div class="tile-cta">${all.length ? (done ? t('tile.review') : t('tile.start')) : ''}</div>
    </button>`;
  }).join('');
  $('#tiles')
    .querySelectorAll('.tile:not(.empty)')
    .forEach((t) => t.addEventListener('click', () => openDeck(t.dataset.cat)));
  updateTop();
}

function openDeck(cat) {
  state.cat = cat;
  state.front = null;
  show('deck');
  renderDeck();
}

// ---------------------------------------------------------------- baralho

function pending(cat = state.cat) {
  const list = state.items.filter((it) => !state.decided.has(it.id) && visible(it) && catOf(it) === cat);
  if (state.front) {
    const i = list.findIndex((x) => x.id === state.front);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

function renderTabs() {
  $('#tabs').innerHTML = CAT_ORDER.map((c) => {
    const n = pending(c).length;
    return `<button data-cat="${c}" class="${c === state.cat ? 'on' : ''}">${CATS[c].emoji} ${CATS[c].label}<span class="badge">${n}</span></button>`;
  }).join('');
  $('#tabs')
    .querySelectorAll('button')
    .forEach((b) =>
      b.addEventListener('click', () => {
        state.cat = b.dataset.cat;
        state.front = null;
        renderDeck();
      })
    );
}

function facts(it) {
  const f = [];
  const c = catOf(it);
  if (c === 'games') {
    if (it.kind === 'game' && it.platform === 'steam') {
      if (it.lastUsed) f.push([t('fact.lastPlayed'), ago(it.lastUsed), Date.now() - it.lastUsed > OLD]);
      else f.push([t('fact.lastPlayed'), it.neverPlayed ? t('fact.neverPlayed') : t('fact.noRecord'), !!it.neverPlayed]);
      f.push([t('fact.updated'), fmtDate(it.updated) || '—']);
    } else {
      const used = ago(it.lastUsed);
      f.push([t('fact.lastPlayed'), used || (state.prefetchAvailable ? t('fact.noRecord') : t('fact.openAsAdmin')), it.lastUsed && Date.now() - it.lastUsed > OLD]);
      f.push([t('fact.installed'), fmtInstallDate(it.installDate) || fmtDate(it.installed) || '—']);
    }
    f.push([t('fact.platform'), PLATFORM[platformOf(it)].label]);
    f.push([t('fact.folder'), shortPath(it.location)]);
  } else if (c === 'apps') {
    f.push([t('fact.installedOn'), fmtInstallDate(it.installDate) || '—']);
    let used = ago(it.lastUsed);
    if (!used) used = it.kind === 'store' ? t('fact.noRecord') : state.prefetchAvailable ? t('fact.noRecord') : t('fact.openAsAdmin');
    f.push([t('fact.lastUsed'), used, it.lastUsed && Date.now() - it.lastUsed > OLD]);
    f.push([t('fact.version'), it.version || '—']);
    f.push([t('fact.publisher'), it.publisher || '—']);
  } else {
    if (it.modified) f.push([t('fact.modified'), ago(it.modified), Date.now() - it.modified > OLD]);
    else if (it.kind === 'appdata') f.push([t('fact.program'), it.matchedProgram || t('fact.noneInstalled')]);
    else f.push([t('fact.safeToDelete'), t('fact.yesRecreated')]);
    f.push([t('fact.where'), shortPath(it.path)]);
  }
  return f;
}

function notesOf(it) {
  let warn = '';
  let note = '';
  if (it.kind === 'program' && it.risky) warn = t('note.riskyProgram');
  if (it.kind === 'store' && it.risky) warn = t('note.riskyStore');
  if (it.kind === 'appdata') {
    if (it.matchedProgram) warn = t('note.appdataInstalled', { name: it.matchedProgram });
    else note = t('note.appdataOrphan');
  }
  if ((it.kind === 'cache' || it.kind === 'temp') && it.detail) note = it.detail;
  if (it.kind === 'store' && !it.size) note = t('note.storeNoSize');
  if (it.kind === 'game' && it.platform === 'epic') note = t('note.epic');
  return { warn, note };
}

function sizeBlock(it) {
  const size = fmtBytes(it.size);
  const ratio = it.size ? Math.max(0.03, Math.log10(it.size / 1e6 + 1) / Math.log10(state.maxSize / 1e6 + 1)) : 0;
  return `<div class="size-block">
      <div class="size">${size.n}<small>${size.u}</small></div>
      <div class="size-bar"><div style="width:${ratio * 100}%"></div></div>
      ${state.disk && it.size && onSystemDrive(it) ? `<div class="size-note">${t('card.diskShare', { pct: nf.format((it.size / state.disk.total) * 100) })}</div>` : ''}
    </div>`;
}

function factsHTML(it) {
  return `<div class="facts">${facts(it)
    .map(([l, v, old]) => `<div class="fact"><span>${l}</span><b class="${old ? 'old' : ''}" title="${esc(v)}">${esc(v)}</b></div>`)
    .join('')}</div>`;
}

function cardHTML(it, cls) {
  const { warn, note } = notesOf(it);
  const canOpen = it.path || it.location;
  const stamps = `<div class="tint"></div><div class="stamp keep">${t('card.keep')}</div><div class="stamp remove">${t('card.remove')}</div>`;
  const foot = `<div class="card-foot">
      <span class="action-label">${esc(t('card.ifRemoved', { action: actionOf(it) }))}</span>
      ${canOpen ? `<button class="link" data-open="${esc(it.id)}">${t('card.openLocation')}</button>` : ''}
    </div>`;

  if (catOf(it) === 'games') {
    const art = it.cover
      ? it.coverPortrait === false
        ? `<div class="cover-blur" style="background-image:url('${it.cover}')"></div><img class="cover-img wide" src="${it.cover}" alt="" />`
        : `<img class="cover-img" src="${it.cover}" alt="" />`
      : fallbackCover(it);
    return `<div class="card game ${cls}" data-id="${esc(it.id)}">
      ${stamps}
      <div class="cover">
        ${art}
        <span class="platform ${platformOf(it)}">${PLATFORM[platformOf(it)].label}</span>
        <div class="cover-title"><div class="name" title="${esc(it.name)}">${esc(it.name)}</div></div>
      </div>
      <div class="game-body">
        ${sizeBlock(it)}
        ${factsHTML(it)}
        ${warn ? `<div class="warn">⚠ ${esc(warn)}</div>` : ''}
        ${note ? `<div class="note">${esc(note)}</div>` : ''}
        ${foot}
      </div>
    </div>`;
  }

  return `<div class="card ${cls}" data-id="${esc(it.id)}">
    ${stamps}
    <div class="card-top">
      <div class="icon">${iconHTML(it)}</div>
      <div style="min-width:0">
        <div class="kind">${esc(kindLabel(it))}</div>
        <div class="name" title="${esc(it.name)}">${esc(it.name)}</div>
        ${catOf(it) === 'apps' ? `<div class="publisher">${esc(it.publisher || '')}</div>` : ''}
      </div>
    </div>
    ${sizeBlock(it)}
    ${factsHTML(it)}
    ${warn ? `<div class="warn">⚠ ${esc(warn)}</div>` : ''}
    ${note ? `<div class="note">${esc(note)}</div>` : ''}
    ${foot}
  </div>`;
}

function renderDeck() {
  renderTabs();
  const list = pending();
  const stack = $('#stack');
  stack.innerHTML = list
    .slice(0, 3)
    .map((it, i) => cardHTML(it, ['top', 'behind1', 'behind2'][i]))
    .reverse()
    .join('');

  const allInCat = state.items.filter((it) => visible(it) && catOf(it) === state.cat).length;
  const done = allInCat - list.length;
  $('#counter').textContent = list.length ? t('deck.counter', { i: done + 1, n: allInCat }) : '';
  $('#deckEmpty').hidden = list.length > 0;
  if (!list.length) {
    const q = removeList();
    $('#emptyTitle').textContent = allInCat ? t('deck.catDone', { cat: CATS[state.cat].label }) : CATS[state.cat].empty;
    $('#emptyText').textContent = q.length
      ? t('deck.queued', { items: items(q.length), size: bytes(q.reduce((a, b) => a + (b.size || 0), 0)) })
      : t('deck.nothingQueued');
    const next = CAT_ORDER.find((c) => c !== state.cat && pending(c).length);
    $('#emptyActions').innerHTML =
      (next ? `<button class="ghost" data-go="${next}">${esc(t('deck.goTo', { cat: CATS[next].label }))}</button>` : '') +
      (q.length ? `<button class="primary" id="emptyReviewBtn">${esc(t('deck.reviewRemovals'))}</button>` : '');
    $('#emptyActions')
      .querySelectorAll('[data-go]')
      .forEach((b) => b.addEventListener('click', () => openDeck(b.dataset.go)));
    const rb = $('#emptyReviewBtn');
    if (rb) rb.addEventListener('click', openReview);
  }
  $('#noBtn').disabled = $('#yesBtn').disabled = list.length === 0;
  $('#undoBtn').disabled = state.history.length === 0;

  const topCard = stack.querySelector('.card.top');
  if (topCard) attachDrag(topCard);
  stack.querySelectorAll('[data-open]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!DEMO) api.openLocation(b.dataset.open);
    })
  );
  updateTop();
}

function setStamps(card, dx) {
  const p = Math.min(1, Math.abs(dx) / 120);
  card.querySelector('.stamp.keep').style.opacity = dx > 0 ? p : 0;
  card.querySelector('.stamp.remove').style.opacity = dx < 0 ? p : 0;
  const tint = card.querySelector('.tint');
  tint.style.opacity = p * 0.18;
  tint.style.background = dx < 0 ? 'var(--red)' : 'var(--green)';
}

function attachDrag(card) {
  let sx = 0, sy = 0, dx = 0, dy = 0, t0 = 0, dragging = false;
  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || state.animating) return;
    dragging = true;
    sx = e.clientX;
    sy = e.clientY;
    t0 = performance.now();
    card.setPointerCapture(e.pointerId);
    card.style.transition = 'none';
  });
  card.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dx = e.clientX - sx;
    dy = e.clientY - sy;
    card.style.transform = `translate(${dx}px, ${dy * 0.25}px) rotate(${dx / 16}deg)`;
    setStamps(card, dx);
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const v = Math.abs(dx) / Math.max(1, performance.now() - t0);
    if (Math.abs(dx) > 120 || (Math.abs(dx) > 50 && v > 0.6)) {
      decide(dx < 0 ? 'remove' : 'keep', dx, dy);
    } else {
      card.style.transition = '';
      card.style.transform = '';
      setStamps(card, 0);
    }
    dx = dy = 0;
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function decide(dir, fromX = 0, fromY = 0) {
  const it = pending()[0];
  const card = $('#stack .card.top');
  if (!it || !card || state.animating) return;
  state.animating = true;

  const sign = dir === 'remove' ? -1 : 1;
  if (!fromX) setStamps(card, sign * 120);
  card.style.transition = 'transform .35s ease-in, opacity .35s ease-in';
  card.style.transform = `translate(${sign * 700}px, ${fromY * 0.25 + 40}px) rotate(${sign * 30}deg)`;
  card.style.opacity = '0';

  const b1 = $('#stack .card.behind1');
  if (b1) {
    b1.style.transform = 'none';
    b1.style.opacity = '1';
  }

  setTimeout(() => {
    state.decided.set(it.id, dir);
    state.history.push(it.id);
    state.front = null;
    if (dir === 'keep') state.kept[it.id] = Date.now();
    saveDecisions();
    state.animating = false;
    renderDeck();
  }, 300);
}

function undo() {
  if (state.animating) return;
  const id = state.history.pop();
  if (!id) return;
  state.decided.delete(id);
  delete state.kept[id];
  saveDecisions();
  const it = state.items.find((x) => x.id === id);
  if (it) state.cat = catOf(it);
  state.front = id;
  renderDeck();
}

let saveTimer = null;
function saveDecisions() {
  if (DEMO) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveDecisions({ kept: state.kept }), 400);
}

// ---------------------------------------------------------------- análise

const STEPS = ['usage', 'programs', 'store', 'games', 'caches', 'personal', 'appdata', 'covers', 'icons'];
let scanTimer = null;
let scanBusy = false;

function resetSteps() {
  $('#steps').innerHTML = STEPS.map(
    (id) =>
      `<li class="pending" data-step="${id}"><span class="st-icon"></span><span class="st-label">${esc(t('step.' + id))}</span><span class="st-text"></span></li>`
  ).join('');
  document.querySelectorAll('.scan-error').forEach((e) => e.remove());
  $('#scanBar').style.width = '3%';
  $('#scanDetail').innerHTML = '&nbsp;';
  const t0 = Date.now();
  $('#scanElapsed').textContent = '0:00';
  clearInterval(scanTimer);
  scanTimer = setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    $('#scanElapsed').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
}

const shortenDetail = (p) => (p.length > 70 ? '…' + p.slice(-69) : p);

function onScanProgress(m) {
  if (m.detail) $('#scanDetail').textContent = shortenDetail(m.detail);
  if (!m.step) return;
  const li = document.querySelector(`#steps li[data-step="${m.step}"]`);
  if (!li) return;
  li.className = m.status + (m.warn ? ' warn' : '');
  if (m.text != null) li.querySelector('.st-text').textContent = m.text;
  const lis = [...document.querySelectorAll('#steps li')];
  const score = lis.reduce(
    (a, l) => a + (l.classList.contains('done') || l.classList.contains('error') ? 1 : l.classList.contains('active') ? 0.5 : 0),
    0
  );
  $('#scanBar').style.width = `${Math.max(3, (score / lis.length) * 100)}%`;
}

const nextPaint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function demoScan() {
  const plan = [
    ['usage', t('scan.records', { n: 512 }), ['C:\\Windows\\Prefetch']],
    ['programs', t('scan.found', { n: 86 }), ['C:\\Program Files\\Adobe']],
    ['store', t('scan.found', { n: 14 }), ['C:\\Program Files\\WindowsApps']],
    ['games', t('scan.gamesDone', { steam: 3, epic: 1, other: 1 }), ['C:\\Program Files (x86)\\Steam\\steamapps']],
    ['caches', t('scan.cachesDone', { n: 3 }), ['C:\\Users\\You\\AppData\\Local\\npm-cache\\_cacache']],
    ['personal', t('scan.bigItems', { n: 2 }), ['C:\\Users\\You\\Downloads']],
    ['appdata', t('scan.bigFolders', { n: 1 }), ['C:\\Users\\You\\AppData\\Roaming\\Unity']],
    ['covers', t('scan.coversDone', { found: 4, total: 5 }), []],
    ['icons', t('scan.iconsDone', { n: 84 }), []],
  ];
  for (const [id, done, details] of plan) {
    onScanProgress({ step: id, status: 'active', text: '' });
    for (const d of details) {
      onScanProgress({ detail: d });
      await wait(160);
    }
    await wait(120);
    onScanProgress({ step: id, status: 'done', text: done });
  }
  await wait(200);
  return { items: window.makeDemoData(t, lang), prefetchAvailable: true };
}

async function startScan() {
  logToFile('Clique em analisar' + (scanBusy ? ' (ignorado: já analisando)' : ''));
  if (scanBusy) return;
  scanBusy = true;
  const btns = [$('#startBtn'), $('#againBtn'), $('#rescanBtn')];
  btns.forEach((b) => {
    b.disabled = true;
    b.dataset.label = b.textContent;
    b.innerHTML = '<span class="spin-sm"></span>' + esc(t('scan.preparing'));
  });
  resetSteps();
  show('scan');
  await nextPaint();
  try {
    let result;
    if (DEMO) {
      result = await demoScan();
    } else {
      result = await api.scan();
      state.disk = await api.diskInfo();
    }
    state.items = result.items.sort((a, b) => (b.size || 0) - (a.size || 0));
    state.prefetchAvailable = result.prefetchAvailable;
    state.maxSize = Math.max(1, ...state.items.map((i) => i.size || 0));
    state.decided.clear();
    state.history = [];
    state.front = null;
    const counts = CAT_ORDER.map((c) => `${c}=${state.items.filter((i) => catOf(i) === c).length}`).join(' ');
    logToFile(`Resumo: ${counts}, com capa=${state.items.filter((i) => i.cover).length}`);
    show('summary');
    renderSummary();
  } catch (e) {
    logToFile('Análise falhou na tela: ' + (e.message || e));
    const msg = String(e.message || e).replace(/^Error invoking remote method 'scan': (Error: )?/, '');
    $('#scanDetail').textContent = '';
    $('#scanDetail').insertAdjacentHTML(
      'afterend',
      `<div class="warn scan-error">${esc(t('scan.failed', { msg }))}<br/><button class="ghost" style="margin-top:10px">${esc(t('scan.backHome'))}</button></div>`
    );
    document.querySelector('.scan-error button').onclick = () => {
      document.querySelector('.scan-error').remove();
      show('home');
    };
  } finally {
    clearInterval(scanTimer);
    scanBusy = false;
    btns.forEach((b) => {
      b.disabled = false;
      b.textContent = b.dataset.label;
    });
  }
}

// ---------------------------------------------------------------- revisão

function openReview() {
  const list = removeList();
  if (!list.length) return;
  $('#reviewList').innerHTML = CAT_ORDER.map((c) => {
    const group = list.filter((it) => catOf(it) === c);
    if (!group.length) return '';
    const size = group.reduce((a, b) => a + (b.size || 0), 0);
    return `<div class="group-head">${CATS[c].emoji} ${CATS[c].label}<span>${items(group.length)} · ${bytes(size)}</span></div>` +
      group
        .map((it) => {
          const act = actionOf(it);
          let sub = kindLabel(it) + ' · ' + act.charAt(0).toLowerCase() + act.slice(1);
          let warnCls = '';
          if (it.risky || it.matchedProgram) {
            sub = '⚠ ' + (it.matchedProgram ? t('review.stillInstalled', { name: it.matchedProgram }) : t('review.mayBeNeeded'));
            warnCls = 'warn-text';
          }
          return `<label class="item">
            <input type="checkbox" checked data-id="${esc(it.id)}" />
            <div class="icon ${catOf(it) === 'games' ? 'has-cover' : ''}">${iconHTML(it)}</div>
            <div class="item-main"><div class="item-name">${esc(it.name)}</div><div class="item-sub ${warnCls}">${esc(sub)}</div></div>
            <div class="item-size">${bytes(it.size)}</div>
          </label>`;
        })
        .join('');
  }).join('');
  $('#reviewList').querySelectorAll('input').forEach((c) => c.addEventListener('change', updateReviewTotal));
  updateReviewTotal();
  show('review');
}

function selectedForRemoval() {
  const ids = new Set([...$('#reviewList').querySelectorAll('input:checked')].map((c) => c.dataset.id));
  return state.items.filter((it) => ids.has(it.id));
}

function updateReviewTotal() {
  const sel = selectedForRemoval();
  const total = sel.reduce((a, b) => a + (b.size || 0), 0);
  $('#reviewTotal').innerHTML = t('review.total', { size: bytes(total), items: items(sel.length) });
  $('#confirmBtn').disabled = sel.length === 0;
  $('#confirmBtn').textContent = sel.length ? t('review.removeN', { n: sel.length }) : t('review.remove');
}

function askConfirm(text, { title = t('confirm.title'), ok = t('confirm.ok') } = {}) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalOk').textContent = ok;
    $('#modalText').textContent = text;
    $('#modal').hidden = false;
    const done = (v) => {
      $('#modal').hidden = true;
      $('#modalOk').onclick = $('#modalCancel').onclick = null;
      resolve(v);
    };
    $('#modalOk').onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
  });
}

async function confirmRemoval() {
  const sel = selectedForRemoval();
  if (!sel.length) return;
  const n = (f) => sel.filter(f).length;
  const lines = [];
  const steam = n((i) => i.kind === 'game' && i.platform === 'steam');
  const epic = n((i) => i.kind === 'game' && i.platform === 'epic');
  const progs = n((i) => i.kind === 'program');
  const store = n((i) => i.kind === 'store');
  const trash = n((i) => ['download', 'user', 'appdata'].includes(i.kind));
  const wipe = n((i) => ['cache', 'temp'].includes(i.kind));
  if (steam) lines.push(t('confirm.steam', { n: steam }));
  if (epic) lines.push(t('confirm.epic', { n: epic }));
  if (progs) lines.push(t('confirm.programs', { n: progs }));
  if (store) lines.push(t('confirm.store', { n: store }));
  if (trash) lines.push(t('confirm.trash', { n: trash }));
  if (wipe) lines.push(t('confirm.wipe', { n: wipe }));
  const ok = await askConfirm(lines.join('\n') + '\n\n' + t('confirm.total', { size: bytes(sel.reduce((a, b) => a + (b.size || 0), 0)) }));
  if (ok) runRemoval(sel);
}

// ---------------------------------------------------------------- remoção



function setRowStatus(d) {
  const row = document.querySelector(`#removeList .item[data-id="${CSS.escape(d.id)}"]`);
  if (!row) return;
  const st = row.querySelector('.status');
  st.className = 'status ' + d.status;
  st.textContent = t('status.' + d.status);
  if (d.message) row.querySelector('.item-sub').textContent = d.message;
  row.classList.toggle('current', d.status === 'running' || d.status === 'waiting');
  if (d.status === 'running' || d.status === 'waiting') row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  $('#skipBtn').hidden = !d.canSkip;
}

async function runRemoval(sel) {
  const order = { temp: 0, cache: 1, download: 2, user: 2, appdata: 3, store: 4, program: 5, game: 6 };
  sel = [...sel].sort((a, b) => order[a.kind] - order[b.kind]);
  $('#removeTitle').textContent = t('remove.title');
  $('#removeSub').textContent = t('remove.dontClose');
  $('#removeFoot').hidden = true;
  $('#donateStrip').hidden = true;
  $('#removeList').innerHTML = sel
    .map(
      (it) => `<div class="item" data-id="${esc(it.id)}">
        <div class="icon ${catOf(it) === 'games' ? 'has-cover' : ''}">${iconHTML(it)}</div>
        <div class="item-main"><div class="item-name">${esc(it.name)}</div><div class="item-sub">${bytes(it.size)}</div></div>
        <span class="status queued">${t('status.queued')}</span>
      </div>`
    )
    .join('');
  $('#queuePill').hidden = true;
  show('remove');

  let result;
  if (DEMO) {
    const results = [];
    for (const it of sel) {
      setRowStatus({ id: it.id, status: 'running', message: t('remove.removing') });
      await wait(500);
      const r = { id: it.id, status: 'done', message: t('remove.simulated'), trashed: ['download', 'user', 'appdata'].includes(it.kind) };
      setRowStatus(r);
      results.push(r);
    }
    result = { results, freed: sel.filter((i) => !results.find((r) => r.id === i.id).trashed).reduce((a, b) => a + (b.size || 0), 0) };
    state.disk = { ...state.disk, free: state.disk.free + result.freed };
  } else {
    result = await api.remove(sel.map((i) => i.id));
    if (result.disk) state.disk = result.disk;
  }

  $('#skipBtn').hidden = true;
  const ok = result.results.filter((r) => r.status === 'done').length;
  const trashedBytes = result.results.filter((r) => r.trashed).reduce((a, r) => a + (sel.find((i) => i.id === r.id)?.size || 0), 0);
  $('#removeTitle').textContent = t('remove.result', { ok, n: sel.length });
  $('#removeSub').textContent = trashedBytes ? t('remove.emptyTrash', { size: bytes(trashedBytes) }) : t('remove.otherDrives');
  const drive = state.disk ? state.disk.root.replace(/\\$/, '') : '';
  $('#removeTotal').innerHTML =
    result.freed >= 1024 * 1024
      ? t('remove.freed', { size: bytes(result.freed), drive })
      : trashedBytes
        ? t('remove.inTrash', { size: bytes(trashedBytes) })
        : t('remove.noneFreed', { drive });
  $('#removeFoot').hidden = false;
  $('#donateStrip').hidden = !(state.donate.enabled && ok > 0);
  if (ok > 0) $('#donateStripTitle').textContent = result.freed > 0 ? t('donate.stripFreed', { size: bytes(result.freed) }) : t('donate.stripTitle');

  const doneIds = new Set(result.results.filter((r) => r.status === 'done').map((r) => r.id));
  state.items = state.items.filter((i) => !doneIds.has(i.id));
  // o que não foi removido volta para as cartas
  for (const id of [...state.decided.keys()]) if (state.decided.get(id) === 'remove') state.decided.delete(id);
  updateTop();
}

// ---------------------------------------------------------------- configurações

function renderSettings() {
  $('#optCovers').checked = !!state.settings.onlineCovers;
  $('#optShowKept').checked = !!state.settings.showKept;
  $('#optShowSystem').checked = !!state.settings.showSystem;
  $('#optAutoUpdate').checked = state.settings.autoUpdate !== false;
  $('#updateInfo').textContent = state.updateStatus || t('settings.upToDate', { version: DEMO ? 'demo' : state.info.version });
  const nKept = Object.keys(state.kept).length;
  $('#keptInfo').textContent = nKept ? t('settings.keptInfo', { n: nKept }) : t('settings.noKept');
  $('#optLanguage').value = state.settings.language || 'auto';
  $('#clearKeptBtn').disabled = !nKept;
  $('#adminInfo').textContent = DEMO ? t('settings.adminDemo') : state.info.admin ? t('settings.adminYes') : t('settings.adminNo');
  $('#adminBtn').hidden = DEMO || state.info.admin;
  $('#donateSetting').hidden = !state.donate.enabled;
  $('#about').textContent = t('settings.about', { version: DEMO ? t('settings.demo') : 'v' + state.info.version });
}

async function setSetting(k, v) {
  state.settings[k] = v;
  if (!DEMO) state.settings = await api.setSettings({ [k]: v });
  if (k === 'language') {
    // recarrega a tela para todos os textos (inclusive os da análise) virem no novo idioma
    if (DEMO) location.search = v === 'auto' ? '' : '?lang=' + v;
    else location.reload();
    return;
  }
  if ((k === 'showKept' || k === 'showSystem') && state.items.length) {
    if (!$('#screen-summary').hidden) renderSummary();
    if (!$('#screen-deck').hidden) renderDeck();
  }
  renderSettings();
}

async function relaunchAdmin() {
  if (DEMO) return;
  const ok = await askConfirm(t('admin.confirm'), { title: t('admin.title'), ok: t('admin.ok') });
  if (ok) await api.relaunchAdmin();
}


// ---------------------------------------------------------------- doação por Pix

function openDonate(where) {
  if (!state.donate.enabled) return;
  if (!DEMO) api.donateOpened(where);
  const opts = state.donate.options;
  // começa no valor do meio (ex.: R$ 10) quando houver valores sugeridos
  state.donateIdx = opts.length > 2 ? Math.min(2, opts.length - 1) : 0;
  $('#donateName').textContent = state.donate.name || '—';
  $('#donateKey').textContent = state.donate.key;
  renderDonate();
  $('#settings').hidden = true;
  $('#donate').hidden = false;
}

function renderDonate() {
  const opts = state.donate.options;
  const money = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const other = t('donate.other');
  $('#amounts').innerHTML = opts
    .map((o, i) => `<button data-i="${i}" class="${i === state.donateIdx ? 'on' : ''}">${o.amount ? money(o.amount) : other}</button>`)
    .join('');
  $('#amounts')
    .querySelectorAll('button')
    .forEach((b) =>
      b.addEventListener('click', () => {
        state.donateIdx = Number(b.dataset.i);
        renderDonate();
      })
    );
  $('#donateQr').src = opts[state.donateIdx].qr;
  $('#copied').hidden = true;
}

async function copyText(text) {
  try {
    if (DEMO) await navigator.clipboard.writeText(text);
    else await api.copyText(text);
    $('#copied').hidden = false;
    setTimeout(() => ($('#copied').hidden = true), 2200);
  } catch {}
}


// ---------------------------------------------------------------- atualizações

async function checkForUpdate(manual) {
  if (DEMO) {
    state.updateStatus = t('settings.upToDate', { version: 'demo' });
    renderSettings();
    return;
  }
  state.updateStatus = t('settings.checking');
  if (manual) renderSettings();
  const r = await api.checkUpdate().catch(() => ({ error: 'network' }));
  if (r.error) {
    state.updateStatus = t('settings.updateError');
  } else if (r.available) {
    state.update = r;
    state.updateStatus = t('settings.updateFound', { version: r.version });
    showUpdateBanner();
  } else {
    state.updateStatus = t('settings.upToDate', { version: r.current });
  }
  if (!$('#settings').hidden) renderSettings();
}

function showUpdateBanner() {
  const u = state.update;
  if (!u) return;
  const banner = $('#updateBanner');
  banner.classList.remove('error');
  $('#updateText').textContent = t('update.available', { version: u.version });
  $('#updateBtn').textContent = u.canInstall ? t('update.install') : t('update.download');
  $('#updateBtn').disabled = false;
  $('#updateLater').hidden = false;
  $('#updateNotes').hidden = false;
  banner.hidden = false;
}

async function runUpdate() {
  const u = state.update;
  if (!u) return;
  if (!u.canInstall) {
    api.openReleases(); // versão portátil ou falha anterior: abre a página de download
    return;
  }
  $('#updateBtn').disabled = true;
  $('#updateLater').hidden = true;
  $('#updateNotes').hidden = true;
  $('#updateText').textContent = t('update.downloading', { pct: 0 });
  const r = await api.installUpdate().catch(() => ({ error: 'network' }));
  if (r && r.error) {
    $('#updateBanner').classList.add('error');
    $('#updateText').textContent = t('update.failed', { msg: t('update.err.' + (r.error === 'checksum' ? 'checksum' : 'network')) });
    $('#updateBtn').disabled = false;
    $('#updateBtn').textContent = t('update.download');
    state.update = { ...u, canInstall: false };
  }
}

// ---------------------------------------------------------------- eventos

$('#startBtn').addEventListener('click', startScan);
$('#rescanBtn').addEventListener('click', startScan);
$('#againBtn').addEventListener('click', startScan);
$('#backSummaryBtn').addEventListener('click', () => {
  show('summary');
  renderSummary();
});
$('#toSummary').addEventListener('click', () => {
  show('summary');
  renderSummary();
});
$('#noBtn').addEventListener('click', () => decide('remove'));
$('#yesBtn').addEventListener('click', () => decide('keep'));
$('#undoBtn').addEventListener('click', undo);
$('#queuePill').addEventListener('click', openReview);
$('#backToDeck').addEventListener('click', () => {
  show('deck');
  renderDeck();
});
$('#confirmBtn').addEventListener('click', confirmRemoval);
$('#skipBtn').addEventListener('click', () => {
  if (!DEMO) api.skipCurrent();
  $('#skipBtn').hidden = true;
});

$('#settingsBtn').addEventListener('click', () => {
  renderSettings();
  $('#settings').hidden = false;
});
$('#settingsClose').addEventListener('click', () => ($('#settings').hidden = true));
$('#settings').addEventListener('click', (e) => {
  if (e.target.id === 'settings') $('#settings').hidden = true;
});
$('#optCovers').addEventListener('change', (e) => setSetting('onlineCovers', e.target.checked));
$('#optShowKept').addEventListener('change', (e) => setSetting('showKept', e.target.checked));
$('#optShowSystem').addEventListener('change', (e) => setSetting('showSystem', e.target.checked));
$('#optLanguage').addEventListener('change', (e) => setSetting('language', e.target.value));
$('#optAutoUpdate').addEventListener('change', (e) => setSetting('autoUpdate', e.target.checked));
$('#checkUpdateBtn').addEventListener('click', () => checkForUpdate(true));
$('#updateBtn').addEventListener('click', runUpdate);
$('#updateLater').addEventListener('click', () => ($('#updateBanner').hidden = true));
$('#updateNotes').addEventListener('click', () => !DEMO && api.openReleases());
$('#clearKeptBtn').addEventListener('click', async () => {
  state.kept = {};
  if (!DEMO) await api.clearDecisions();
  renderSettings();
  if (!$('#screen-summary').hidden) renderSummary();
});
$('#openLogsBtn').addEventListener('click', () => !DEMO && api.openLogs());
$('#adminBtn').addEventListener('click', relaunchAdmin);
$('#adminBtnHome').addEventListener('click', relaunchAdmin);

$('#donateStripBtn').addEventListener('click', () => openDonate('resultado'));
$('#donateSettingBtn').addEventListener('click', () => openDonate('configuracoes'));
$('#donateClose').addEventListener('click', () => ($('#donate').hidden = true));
$('#donate').addEventListener('click', (e) => {
  if (e.target.id === 'donate') $('#donate').hidden = true;
});
$('#copyCodeBtn').addEventListener('click', () => copyText(state.donate.options[state.donateIdx].code));
$('#copyKeyBtn').addEventListener('click', () => copyText(state.donate.key));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    $('#settings').hidden = true;
    $('#donate').hidden = true;
    return;
  }
  if ($('#screen-deck').hidden || !$('#modal').hidden || !$('#settings').hidden || !$('#donate').hidden) return;
  if (e.key === 'ArrowLeft') decide('remove');
  else if (e.key === 'ArrowRight') decide('keep');
  else if ((e.ctrlKey && e.key.toLowerCase() === 'z') || e.key === 'Backspace') undo();
  else if (['1', '2', '3'].includes(e.key)) openDeck(CAT_ORDER[Number(e.key) - 1]);
});

if (!DEMO) {
  api.onScanProgress(onScanProgress);
  api.onRemoveProgress(setRowStatus);
  api.onUpdateProgress(({ pct }) => {
    $('#updateText').textContent = pct >= 100 ? t('update.installing') : t('update.downloading', { pct });
  });
}

// ---------------------------------------------------------------- início

(async function init() {
  if (DEMO) {
    $('#demoBanner').hidden = false;
    state.disk = { root: 'C:\\', total: 476 * 1024 ** 3, free: 38 * 1024 ** 3 };
    state.info = { version: 'demo', admin: false };
    state.donate = lang === 'pt-BR' && window.DEMO_DONATE ? window.DEMO_DONATE : { enabled: false };
    const q = new URLSearchParams(location.search).get('lang');
    state.settings.language = q || 'auto';
  } else {
    const [disk, decisions, settings, info, donate] = await Promise.all([
      api.diskInfo(),
      api.getDecisions(),
      api.getSettings(),
      api.appInfo(),
      Promise.resolve()
        .then(() => api.donateInfo())
        .catch(() => ({ enabled: false })),
    ]);
    state.donate = donate || { enabled: false };
    state.disk = disk;
    state.kept = (decisions && decisions.kept) || {};
    state.settings = settings || state.settings;
    state.info = info || state.info;
    if (state.info.lang && state.info.lang !== lang) setLanguage(state.info.lang);
    $('#adminNote').hidden = state.info.admin;
  }
  updateTop();
  if (api && api.autoScan) setTimeout(startScan, 500);
  if (!DEMO && state.settings.autoUpdate !== false) setTimeout(() => checkForUpdate(false), 2500);
  logToFile(`Tela pronta (demo: ${DEMO ? 'sim' : 'não'}, admin: ${state.info.admin ? 'sim' : 'não'}, versão ${state.info.version})`);
})();
})();
