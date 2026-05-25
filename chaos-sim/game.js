'use strict';

let cardMap = {};
fetch('card_map.json').then(r => r.json()).then(d => { cardMap = d; }).catch(() => {});

const SLOTS = ['partner', 'front-l', 'front-r', 'back-l', 'back-r', 'ex-0', 'ex-1', 'ex-2', 'ex-3'];
const ZONES = ['deck', 'extra', 'hand', 'discard', 'backyard'];
let _cardId = 0;
function nextId() { return ++_cardId; }

// --- State ---
const state = [null, null];
let _openPanel = null; // {p, zone}

function newPlayerState() {
  return { deck: [], extra: [], hand: [], discard: [], backyard: [], slots: { partner: null, 'front-l': null, 'front-r': null, 'back-l': null, 'back-r': null, 'ex-0': null, 'ex-1': null, 'ex-2': null, 'ex-3': null } };
}

function findAndRemove(id) {
  for (let p = 0; p < 2; p++) {
    const s = state[p];
    if (!s) continue;
    for (const z of ZONES) {
      const idx = s[z].findIndex(c => c.id === id);
      if (idx >= 0) return s[z].splice(idx, 1)[0];
    }
    for (const sl of SLOTS) {
      if (s.slots[sl] && s.slots[sl].id === id) {
        const c = s.slots[sl];
        s.slots[sl] = null;
        return c;
      }
    }
  }
  return null;
}

const game = {
  draw(p) {
    const s = state[p];
    if (!s || s.deck.length === 0) { log('デッキが空です', 'damage'); return; }
    s.hand.push(s.deck.pop());
    log(`P${p+1} ドロー`);
    render();
  },
  mulligan(p) {
    const s = state[p];
    if (!s) return;
    const n = s.hand.length;
    s.deck.push(...s.hand); s.hand = [];
    shuffle(s.deck);
    for (let i = 0; i < n; i++) s.hand.push(s.deck.pop());
    log(`P${p+1} マリガン (${n}枚)`);
    render();
  },
  shuffle(p) {
    if (!state[p]) return;
    shuffle(state[p].deck);
    log(`P${p+1} シャッフル`);
    render();
  },
  standAll(p) {
    if (!state[p]) return;
    for (const sl of SLOTS) { const c = state[p].slots[sl]; if (c) c.state = 'stand'; }
    log(`P${p+1} 全スタンド`);
    render();
  },
  dealDamage(p, n) {
    const s = state[p];
    if (!s) return;
    if (!n) n = parseInt(prompt('ダメージ量:'), 10);
    if (!n || n <= 0) return;
    let remaining = n;
    log(`P${p+1} に${n}ダメージ`, 'damage');
    while (remaining > 0) {
      if (s.deck.length === 0) { log('デッキ切れ！', 'damage'); break; }
      const card = s.deck.pop();
      const partner = s.slots.partner;
      if (partner && card.name === partner.name) {
        log(`★ ${card.name} → キャンセル!`, 'cancel');
        partner.level = (partner.level || 0) + 1;
        partner.state = 'stand'; partner.damage = 0; partner.faceUp = true;
        partner.levelCards = partner.levelCards || [];
        partner.levelCards.push(card);
        remaining = 0;
      } else {
        s.discard.push(card);
        remaining--;
      }
    }
    render();
  },
  showZone(p, zone) {
    const s = state[p];
    if (!s) return;
    const cards = s[zone] || [];
    if (cards.length === 0) { log(`P${p+1} ${zone} は空`); return; }
    _openPanel = { p, zone };
    refreshPanel();
    document.getElementById('zone-panel').style.display = 'flex';
  }
};

// --- Zone panel ---
function refreshPanel() {
  if (!_openPanel) return;
  const { p, zone } = _openPanel;
  const cards = state[p][zone] || [];
  document.getElementById('zone-panel-title').textContent = `P${p+1} ${zone} (${cards.length})`;
  const ct = document.getElementById('zone-panel-cards');
  ct.innerHTML = cards.map((c, i) => makeCardHtml(c, p, zone, i)).join('');
  setupDragDrop();
}
function closeZonePanel() {
  if (_peekState) { closePeek(); return; }
  _openPanel = null;
  document.getElementById('zone-panel').style.display = 'none';
}

// --- Deck loading ---
function getDecks() { return JSON.parse(localStorage.getItem('chaos_decks') || '[]'); }

function isExtraCard(number) {
  const info = cardMap[number];
  if (info && info.type === 'extra') return true;
  const n = (number || '').toUpperCase();
  return n.includes('EX') || n.endsWith('SP');
}

function populateDeckSelects() {
  const decks = getDecks();
  for (let i = 0; i < 2; i++) {
    const sel = document.getElementById('deck-select-' + i);
    sel.innerHTML = decks.map((d, idx) => `<option value="${idx}">${d.name || 'デッキ' + (idx+1)}</option>`).join('');
    if (!decks.length) sel.innerHTML = '<option>デッキなし</option>';
  }
}

function startGame() {
  const decks = getDecks();
  if (!decks.length) { log('デッキがありません'); return; }
  for (let p = 0; p < 2; p++) {
    const idx = +document.getElementById('deck-select-' + p).value;
    const deck = decks[idx];
    if (!deck) { log('デッキが見つかりません'); return; }
    state[p] = newPlayerState();
    const mainCards = [], extraCards = [];
    (deck.cards || []).forEach(entry => {
      const num = entry.number, cm = cardMap[num] || {};
      for (let i = 0; i < (entry.count || 1); i++) {
        const c = { id: nextId(), number: num, name: cm.name || num, image: cm.image || '', state: 'stand', faceUp: true, level: 0, damage: 0, levelCards: [] };
        if (isExtraCard(num)) extraCards.push(c); else mainCards.push(c);
      }
    });
    state[p].extra = extraCards;
    const partnerNum = deck.partner;
    let pi = partnerNum ? mainCards.findIndex(c => c.number === partnerNum) : 0;
    if (pi < 0) pi = 0;
    if (mainCards.length > 0) state[p].slots.partner = mainCards.splice(pi, 1)[0];
    shuffle(mainCards);
    state[p].deck = mainCards;
    for (let i = 0; i < 5 && state[p].deck.length > 0; i++) state[p].hand.push(state[p].deck.pop());
  }
  document.getElementById('deck-modal').style.display = 'none';
  log('ゲーム開始');
  render();
}

function resetGame() {
  state[0] = null; state[1] = null;
  _openPanel = null;
  document.getElementById('zone-panel').style.display = 'none';
  document.getElementById('deck-modal').style.display = 'flex';
  populateDeckSelects();
  render();
}

// --- Render ---
function render() {
  for (let p = 0; p < 2; p++) {
    const s = state[p];
    document.getElementById(`p${p}-deck-count`).textContent = s ? s.deck.length : 0;
    document.getElementById(`p${p}-extra-count`).textContent = s ? s.extra.length : 0;
    document.getElementById(`p${p}-discard-count`).textContent = s ? s.discard.length : 0;
    document.getElementById(`p${p}-backyard-count`).textContent = s ? s.backyard.length : 0;
    document.getElementById(`p${p}-hand-count`).textContent = s ? s.hand.length : 0;
    const handEl = document.getElementById(`p${p}-hand-cards`);
    handEl.innerHTML = s ? s.hand.map((c, i) => makeCardHtml(c, p, 'hand', i)).join('') : '';
    for (const sl of SLOTS) {
      const slotEl = document.getElementById(`p${p}-${sl}`);
      if (!slotEl) continue;
      const c = s ? s.slots[sl] : null;
      slotEl.innerHTML = c ? makeCardHtml(c, p, sl, 0) : '';
    }
    // Discard top card
    renderZoneTop(p, 'discard');
    // Backyard horizontal cards
    renderBackyard(p);
  }
  if (_openPanel) refreshPanel();
  else setupDragDrop();
}

function renderZoneTop(p, zone) {
  const s = state[p];
  const el = document.querySelector(`.zone[data-p="${p}"][data-zone="${zone}"]`);
  if (!el) return;
  const existing = el.querySelector('.zone-top-card');
  if (existing) existing.remove();
  if (!s || !s[zone].length) return;
  const top = s[zone][s[zone].length - 1];
  const cm = cardMap[top.number] || {};
  const img = top.image || cm.image || '';
  if (img) {
    const div = document.createElement('div');
    div.className = 'zone-top-card';
    div.innerHTML = `<img src="${img}" alt="${top.name}">`;
    el.appendChild(div);
  }
}

function renderBackyard(p) {
  const s = state[p];
  const el = document.getElementById(`p${p}-backyard-cards`);
  if (!el) return;
  el.innerHTML = '';
  if (!s || !s.backyard.length) return;
  const cards = s.backyard;
  cards.forEach((c, i) => {
    const cm = cardMap[c.number] || {};
    const img = c.image || cm.image || '';
    const div = document.createElement('div');
    div.className = 'card';
    div.draggable = true;
    div.dataset.id = c.id;
    div.dataset.p = p;
    div.dataset.zone = 'backyard';
    div.dataset.idx = i;
    // 5枚目以降: 全カードにmargin-right負値で重なる（WSクロック方式）
    if (cards.length > 4) div.style.marginRight = `calc(var(--cw) * -0.7)`;
    div.oncontextmenu = (e) => cardMenu(e, c.id);
    if (img) div.innerHTML = `<img class="card-img" src="${img}">`;
    else div.innerHTML = `<span class="card-name">${c.name}</span>`;
    el.appendChild(div);
  });
  // last-childのmarginをリセット
  if (el.lastChild) el.lastChild.style.marginRight = '0';
}

function makeCardHtml(card, p, zone, idx) {
  const cls = ['card'];
  if (!card.faceUp) cls.push('face-down');
  if (card.state === 'rest') cls.push('rest');
  if (card.state === 'reverse') cls.push('reverse');
  const cm = cardMap[card.number] || {};
  const img = card.image || cm.image || '';
  let inner = '';
  if (card.faceUp && img) inner += `<img class="card-img" src="${img}" alt="${card.name}" loading="lazy">`;
  if (card.faceUp && !img) inner += `<span class="card-name">${card.name}</span>`;
  if (card.level > 0) inner += `<span class="level-badge">Lv${card.level}</span>`;
  if (card.damage > 0) inner += `<span class="dmg-badge">${card.damage}</span>`;
  return `<div class="${cls.join(' ')}" draggable="true" data-id="${card.id}" data-p="${p}" data-zone="${zone}" data-idx="${idx}" oncontextmenu="cardMenu(event,${card.id})">${inner}</div>`;
}

// --- Card zoom ---
function showZoom(card) {
  if (!card || !card.faceUp) return;
  const cm = cardMap[card.number] || {};
  const img = (card.image || cm.image || '').replace('100_140', '200_280');
  if (!img) return;
  const overlay = document.getElementById('zoom-overlay');
  overlay.innerHTML = `<img src="${img}" alt="${card.name}"><div class="zoom-name">${card.name}<br><small>${card.number}</small></div>`;
  overlay.style.display = 'flex';
}

// --- Drag & Drop (ID-based) ---
let dragId = null;

function setupDragDrop() {
  document.querySelectorAll('.card[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragId = +el.dataset.id;
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragId = null; });
  });

  document.querySelectorAll('.slot[data-p], .ex-slot[data-p]').forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      if (!dragId) return;
      moveTo(+el.dataset.p, el.dataset.slot);
    });
  });

  document.querySelectorAll('.zone[data-p], .backyard-zone[data-p]').forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      if (!dragId) return;
      moveTo(+el.dataset.p, el.dataset.zone);
    });
  });

  document.querySelectorAll('.hand-area').forEach(el => {
    const p = el.id === 'p0-hand-area' ? 0 : 1;
    el.addEventListener('dragover', e => { e.preventDefault(); });
    el.addEventListener('drop', e => { e.preventDefault(); if (dragId) moveTo(p, 'hand'); });
  });
}

function moveTo(toP, toZone) {
  if (!dragId) return;
  const card = findAndRemove(dragId);
  if (!card) { dragId = null; render(); return; }
  const ds = state[toP];
  if (!ds) { dragId = null; return; }

  if (SLOTS.includes(toZone)) {
    if (ds.slots[toZone]) ds.discard.push(ds.slots[toZone]);
    card.state = 'stand'; card.faceUp = true;
    ds.slots[toZone] = card;
  } else {
    card.state = 'stand'; card.faceUp = true;
    ds[toZone].push(card);
  }
  dragId = null;
  render();
}

// --- Context menus ---
function cardMenu(e, id) {
  e.preventDefault(); e.stopPropagation();
  let card = null, cardP = -1, cardZone = '';
  for (let p = 0; p < 2; p++) {
    const s = state[p]; if (!s) continue;
    for (const z of ZONES) { if (s[z].find(c => c.id === id)) { card = s[z].find(c => c.id === id); cardP = p; cardZone = z; break; } }
    if (card) break;
    for (const sl of SLOTS) { if (s.slots[sl] && s.slots[sl].id === id) { card = s.slots[sl]; cardP = p; cardZone = sl; break; } }
    if (card) break;
  }
  if (!card) return;
  const items = [];
  // Slot cards (field + EX slots): 6 states
  if (SLOTS.includes(cardZone)) {
    const isEx = cardZone.startsWith('ex-');
    const cols = isEx ? 2 : 3;
    const stateGrid = [
      { label: '⬆', title: '表スタンド', fn() { card.faceUp = true; card.state = 'stand'; render(); } },
      { label: '➡', title: '表レスト', fn() { card.faceUp = true; card.state = 'rest'; render(); } },
      ...(!isEx ? [{ label: '⬇', title: '表リバース', fn() { card.faceUp = true; card.state = 'reverse'; render(); } }] : []),
      { label: '⬆', title: '裏スタンド', cls: 'fd', fn() { card.faceUp = false; card.state = 'stand'; render(); } },
      { label: '➡', title: '裏レスト', cls: 'fd', fn() { card.faceUp = false; card.state = 'rest'; render(); } },
      ...(!isEx ? [{ label: '⬇', title: '裏リバース', cls: 'fd', fn() { card.faceUp = false; card.state = 'reverse'; render(); } }] : []),
    ];
    items.push({ grid: true, cols, cells: stateGrid });
  }
  items.push({ label: '⚡ 効果発動', fn() { log(`⚡ 効果発動: ${card.name}`); } });
  items.push({ label: '🎯 対象指定', fn() { log(`🎯 対象: ${card.name}`); } });
  items.push({ label: '🔍 拡大表示', fn() { showZoom(card); } });
  showCtxMenu(e, items);
}

function deckMenu(e, p) {
  e.preventDefault();
  const s = state[p]; if (!s) return;
  showCtxMenu(e, [
    { label: '上からN枚見る', fn() { const n = parseInt(prompt('何枚見る？'), 10); if (n > 0) peekDeck(p, n); } },
    { label: 'ダメージ', fn() { game.dealDamage(p); } },
    { label: 'マリガン', fn() { if (confirm('手札を引き直してよいですか？')) game.mulligan(p); } },
  ]);
}

function peekDeck(p, n) {
  const s = state[p]; if (!s) return;
  const count = Math.min(n, s.deck.length);
  if (count === 0) { log('デッキが空です'); return; }
  // Take top N cards (deck is array, top = last element)
  const peeked = s.deck.slice(-count).reverse(); // top first
  _peekState = { p, cards: peeked, originalIndices: [] };
  // Store original indices for reordering
  for (let i = 0; i < count; i++) _peekState.originalIndices.push(s.deck.length - count + i);
  showPeekPanel(p, peeked);
}

let _peekState = null;

function showPeekPanel(p, cards) {
  const panel = document.getElementById('zone-panel');
  document.getElementById('zone-panel-title').textContent = `P${p+1} デッキトップ ${cards.length}枚 ← トップ | ボトム →`;
  const ct = document.getElementById('zone-panel-cards');
  ct.innerHTML = '';
  cards.forEach((c, i) => {
    const cm = cardMap[c.number] || {};
    const img = c.image || cm.image || '';
    const div = document.createElement('div');
    div.className = 'card';
    div.draggable = true;
    div.dataset.peekIdx = i;
    div.oncontextmenu = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      showCtxMenu(ev, [
        { label: '→ デッキボトム', fn() { peekSendBottom(i); } },
        { label: '→ 手札', fn() { peekSendHand(i); } },
        { label: '→ 控え室', fn() { peekSendDiscard(i); } },
      ]);
    };
    // Drag reorder within peek
    div.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/plain', i); });
    div.addEventListener('dragover', (ev) => { ev.preventDefault(); div.style.borderColor = '#4ad4a0'; });
    div.addEventListener('dragleave', () => { div.style.borderColor = ''; });
    div.addEventListener('drop', (ev) => {
      ev.preventDefault(); div.style.borderColor = '';
      const fromIdx = +ev.dataTransfer.getData('text/plain');
      if (fromIdx === i) return;
      const [moved] = _peekState.cards.splice(fromIdx, 1);
      _peekState.cards.splice(i, 0, moved);
      showPeekPanel(p, _peekState.cards);
    });
    if (img) div.innerHTML = `<img class="card-img" src="${img}">`;
    else div.innerHTML = `<span class="card-name">${c.name}</span>`;
    ct.appendChild(div);
  });
  // Close button = put back on top in current order
  panel.style.display = 'flex';
  _openPanel = null; // not a regular zone panel
}

function peekSendBottom(idx) {
  const s = state[_peekState.p];
  const card = _peekState.cards.splice(idx, 1)[0];
  // Remove from deck
  const deckIdx = s.deck.findIndex(c => c.id === card.id);
  if (deckIdx >= 0) s.deck.splice(deckIdx, 1);
  s.deck.unshift(card); // bottom
  log(`${card.name} → デッキボトム`);
  if (_peekState.cards.length === 0) closePeek();
  else showPeekPanel(_peekState.p, _peekState.cards);
  render();
}

function peekSendHand(idx) {
  const s = state[_peekState.p];
  const card = _peekState.cards.splice(idx, 1)[0];
  const deckIdx = s.deck.findIndex(c => c.id === card.id);
  if (deckIdx >= 0) s.deck.splice(deckIdx, 1);
  s.hand.push(card);
  log(`${card.name} → 手札`);
  if (_peekState.cards.length === 0) closePeek();
  else showPeekPanel(_peekState.p, _peekState.cards);
  render();
}

function peekSendDiscard(idx) {
  const s = state[_peekState.p];
  const card = _peekState.cards.splice(idx, 1)[0];
  const deckIdx = s.deck.findIndex(c => c.id === card.id);
  if (deckIdx >= 0) s.deck.splice(deckIdx, 1);
  s.discard.push(card);
  log(`${card.name} → 控え室`);
  if (_peekState.cards.length === 0) closePeek();
  else showPeekPanel(_peekState.p, _peekState.cards);
  render();
}

function closePeek() {
  if (_peekState && _peekState.cards.length > 0) {
    // Put remaining cards back on top in displayed order (first = top)
    const s = state[_peekState.p];
    // Remove peeked cards from deck
    for (const c of _peekState.cards) {
      const idx = s.deck.findIndex(x => x.id === c.id);
      if (idx >= 0) s.deck.splice(idx, 1);
    }
    // Push back in reverse (so first displayed = top = last in array)
    for (let i = _peekState.cards.length - 1; i >= 0; i--) {
      s.deck.push(_peekState.cards[i]);
    }
    render();
  }
  _peekState = null;
  document.getElementById('zone-panel').style.display = 'none';
}

function zoneMenu(e, p, zone) {
  e.preventDefault();
}

function showCtxMenu(e, items) {
  const menu = document.getElementById('ctx-menu');
  let allCells = [];
  menu.innerHTML = items.map((it) => {
    if (it.grid) {
      const html = it.cells.map((c) => {
        const idx = allCells.length; allCells.push(c);
        const cls = 'ctx-grid-btn' + (c.cls ? ' ' + c.cls : '');
        return `<div class="${cls}" onclick="ctxAction(${idx})" title="${c.title||c.label}">${c.label}</div>`;
      }).join('');
      return `<div class="ctx-grid" style="grid-template-columns:repeat(${it.cols},1fr)">${html}</div>`;
    }
    const idx = allCells.length; allCells.push(it);
    return `<div onclick="ctxAction(${idx})">${it.label}</div>`;
  }).join('');
  menu.style.left = e.clientX + 'px'; menu.style.top = e.clientY + 'px';
  menu.style.display = 'block'; menu._items = allCells;
}
function ctxAction(i) {
  const menu = document.getElementById('ctx-menu');
  menu.style.display = 'none';
  if (menu._items && menu._items[i]) menu._items[i].fn();
}
document.addEventListener('click', () => { document.getElementById('ctx-menu').style.display = 'none'; });

// --- Utility ---
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function log(msg, cls) { document.getElementById('log').innerHTML = `<div class="entry ${cls || ''}">${msg}</div>` + document.getElementById('log').innerHTML; }

// --- Init ---
populateDeckSelects();
render();

// --- Panel drag ---
(function() {
  const modal = document.getElementById('zone-panel');
  const header = modal.querySelector('.zone-panel-header');
  if (!header) return;
  header.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'BUTTON') return;
    e.preventDefault();
    header.setPointerCapture(e.pointerId);
    const r = modal.getBoundingClientRect();
    let ox = r.left, oy = r.top, mx = e.clientX, my = e.clientY;
    modal.style.transform = 'none';
    modal.style.left = ox + 'px'; modal.style.top = oy + 'px'; modal.style.bottom = 'auto';
    const move = ev => { modal.style.left = (ox + ev.clientX - mx) + 'px'; modal.style.top = (oy + ev.clientY - my) + 'px'; };
    const up = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', up);
  });
})();
