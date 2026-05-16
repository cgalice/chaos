'use strict';

let cardMap = {};
fetch('card_map.json').then(r => r.json()).then(d => { cardMap = d; }).catch(() => {});

const SLOTS = ['partner', 'front-l', 'front-r', 'back-l', 'back-r'];
const ZONES = ['deck', 'extra', 'hand', 'discard', 'backyard'];

// --- State ---
const state = [null, null]; // [p0, p1]
function newPlayerState() {
  return { deck: [], extra: [], hand: [], discard: [], backyard: [], slots: { partner: null, 'front-l': null, 'front-r': null, 'back-l': null, 'back-r': null } };
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
    s.deck.push(...s.hand);
    s.hand = [];
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
    for (const sl of SLOTS) {
      const c = state[p].slots[sl];
      if (c && c.state !== 'stand') { c.state = 'stand'; }
    }
    log(`P${p+1} 全スタンド`);
    render();
  },

  dealDamage(p) {
    const s = state[p];
    if (!s) return;
    const n = parseInt(document.getElementById('dmg-n').textContent, 10);
    if (n <= 0) return;
    let remaining = n;
    log(`P${p+1} に${n}ダメージ`, 'damage');
    while (remaining > 0) {
      if (s.deck.length === 0) { log('デッキ切れ！', 'damage'); break; }
      const card = s.deck.pop();
      const partner = s.slots.partner;
      if (partner && card.name === partner.name) {
        log(`★ ${card.name} → パートナーキャンセル!`, 'cancel');
        partner.level = (partner.level || 0) + 1;
        partner.state = 'stand';
        partner.damage = 0;
        partner.faceUp = true;
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
    let cards;
    if (zone === 'extra') {
      cards = s.extra;
    } else {
      cards = s[zone] || [];
    }
    if (cards.length === 0) { log(`P${p+1} ${zone} は空`); return; }
    openZonePanel(`P${p+1} ${zone} (${cards.length})`, cards, p, zone);
  },

  // Move card between zones/slots
  moveCard(fromP, fromZone, fromIdx, toP, toZone, toIdx) {
    const src = getContainer(fromP, fromZone);
    const dst = getContainer(toP, toZone);
    if (!src || !dst) return;

    let card;
    if (Array.isArray(src)) {
      card = src.splice(fromIdx, 1)[0];
    } else {
      // from slot
      card = src[fromZone];
      src[fromZone] = null;
    }
    if (!card) return;

    if (Array.isArray(dst)) {
      dst.push(card);
    } else {
      // to slot: if occupied, send existing to discard
      if (dst[toZone]) {
        state[toP].discard.push(dst[toZone]);
      }
      card.state = 'stand';
      card.faceUp = true;
      dst[toZone] = card;
    }
    render();
  }
};

function getContainer(p, zone) {
  if (!state[p]) return null;
  if (SLOTS.includes(zone)) return state[p].slots;
  return state[p][zone];
}

// --- Deck loading ---
// recipe.html saves to 'chaos_decks' as array of {name, partner, cards:[{number,count}]}
function getDecks() {
  return JSON.parse(localStorage.getItem('chaos_decks') || '[]');
}

function isExtraCard(number) {
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
  if (!decks.length) { log('デッキがありません。recipe.htmlからインポートしてください'); return; }
  for (let p = 0; p < 2; p++) {
    const idx = +document.getElementById('deck-select-' + p).value;
    const deck = decks[idx];
    if (!deck) { log('デッキが見つかりません'); return; }
    state[p] = newPlayerState();
    const mainCards = [];
    const extraCards = [];
    (deck.cards || []).forEach(entry => {
      const num = entry.number;
      const cm = cardMap[num] || {};
      for (let i = 0; i < (entry.count || 1); i++) {
        const c = { number: num, name: cm.name || num, image: cm.image || '', state: 'stand', faceUp: true, level: 0, damage: 0, levelCards: [] };
        if (isExtraCard(num)) extraCards.push(c);
        else mainCards.push(c);
      }
    });
    state[p].extra = extraCards;
    // Set partner
    const partnerNum = deck.partner;
    let pi = -1;
    if (partnerNum) pi = mainCards.findIndex(c => c.number === partnerNum);
    if (pi < 0) pi = 0;
    if (mainCards.length > 0) {
      state[p].slots.partner = mainCards.splice(pi, 1)[0];
    }
    shuffle(mainCards);
    state[p].deck = mainCards;
    // Draw 5
    for (let i = 0; i < 5 && state[p].deck.length > 0; i++) {
      state[p].hand.push(state[p].deck.pop());
    }
  }
  document.getElementById('deck-modal').style.display = 'none';
  log('ゲーム開始');
  render();
}

function resetGame() {
  state[0] = null; state[1] = null;
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

    // Hand
    const handEl = document.getElementById(`p${p}-hand-cards`);
    handEl.innerHTML = s ? s.hand.map((c, i) => makeCardHtml(c, p, 'hand', i)).join('') : '';

    // Slots
    for (const sl of SLOTS) {
      const slotEl = document.getElementById(`p${p}-${sl}`);
      const c = s ? s.slots[sl] : null;
      if (c) {
        slotEl.innerHTML = makeCardHtml(c, p, sl, 0);
      } else {
        slotEl.innerHTML = '';
      }
    }
  }
  setupDragDrop();
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
  return `<div class="${cls.join(' ')}" draggable="true" data-p="${p}" data-zone="${zone}" data-idx="${idx}" oncontextmenu="cardMenu(event,${p},'${zone}',${idx})">${inner}</div>`;
}

// --- Drag & Drop ---
let dragData = null;

function setupDragDrop() {
  document.querySelectorAll('.card[draggable]').forEach(el => {
    el.addEventListener('dragstart', e => {
      dragData = { p: +el.dataset.p, zone: el.dataset.zone, idx: +el.dataset.idx };
      el.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', e => { el.classList.remove('dragging'); dragData = null; });
  });

  // Drop targets: slots and zones
  document.querySelectorAll('.slot[data-p]').forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      if (!dragData) return;
      const toP = +el.dataset.p, toSlot = el.dataset.slot;
      moveFromDrag(toP, toSlot);
    });
  });

  document.querySelectorAll('.zone[data-p]').forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drag-over');
      if (!dragData) return;
      const toP = +el.dataset.p, toZone = el.dataset.zone;
      moveFromDrag(toP, toZone);
    });
  });

  // Hand areas as drop targets
  document.querySelectorAll('.hand-area').forEach(el => {
    const p = el.id === 'p0-hand-area' ? 0 : 1;
    el.addEventListener('dragover', e => { e.preventDefault(); el.style.borderColor = '#4ad4a0'; });
    el.addEventListener('dragleave', () => el.style.borderColor = '');
    el.addEventListener('drop', e => {
      e.preventDefault(); el.style.borderColor = '';
      if (!dragData) return;
      moveFromDrag(p, 'hand');
    });
  });
}

function moveFromDrag(toP, toZone) {
  if (!dragData) return;
  const { p: fromP, zone: fromZone, idx: fromIdx } = dragData;
  const s = state[fromP];
  if (!s) return;

  let card;
  if (SLOTS.includes(fromZone)) {
    card = s.slots[fromZone];
    if (!card) return;
    s.slots[fromZone] = null;
  } else {
    card = s[fromZone].splice(fromIdx, 1)[0];
    if (!card) return;
  }

  const ds = state[toP];
  if (!ds) return;

  if (SLOTS.includes(toZone)) {
    if (ds.slots[toZone]) {
      ds.discard.push(ds.slots[toZone]);
    }
    card.state = 'stand';
    card.faceUp = true;
    ds.slots[toZone] = card;
  } else {
    ds[toZone].push(card);
  }
  dragData = null;
  render();
}

// --- Context menus ---
function cardMenu(e, p, zone, idx) {
  e.preventDefault();
  const s = state[p];
  if (!s) return;
  let card;
  if (SLOTS.includes(zone)) card = s.slots[zone];
  else card = s[zone][idx];
  if (!card) return;

  const items = [];
  if (SLOTS.includes(zone)) {
    if (card.state === 'stand') items.push({ label: 'レスト', fn() { card.state = 'rest'; render(); } });
    if (card.state === 'rest') items.push({ label: 'リバース', fn() { card.state = 'reverse'; render(); } });
    if (card.state !== 'stand') items.push({ label: 'スタンド', fn() { card.state = 'stand'; render(); } });
    items.push({ label: '裏返す', fn() { card.faceUp = !card.faceUp; render(); } });
  }
  items.push({ label: '→ 控え室', fn() { removeCard(p, zone, idx); s.discard.push(card); render(); } });
  items.push({ label: '→ 手札', fn() { removeCard(p, zone, idx); s.hand.push(card); render(); } });
  items.push({ label: '→ デッキトップ', fn() { removeCard(p, zone, idx); s.deck.push(card); render(); } });
  items.push({ label: '→ デッキボトム', fn() { removeCard(p, zone, idx); s.deck.unshift(card); render(); } });
  showCtxMenu(e, items);
}

function deckMenu(e, p) {
  e.preventDefault();
  const s = state[p];
  if (!s) return;
  const items = [
    { label: 'ドロー', fn() { game.draw(p); } },
    { label: 'シャッフル', fn() { game.shuffle(p); } },
    { label: 'トップ確認', fn() { if (s.deck.length) log(`トップ: ${s.deck[s.deck.length-1].name}`); } },
    { label: 'ダメージ', fn() { game.dealDamage(p); } },
  ];
  showCtxMenu(e, items);
}

function zoneMenu(e, p, zone) {
  e.preventDefault();
  const s = state[p];
  if (!s) return;
  const items = [
    { label: '全て見る', fn() { game.showZone(p, zone); } },
    { label: '全てデッキに戻す', fn() { s.deck.push(...s[zone]); s[zone] = []; shuffle(s.deck); render(); } },
  ];
  showCtxMenu(e, items);
}

function removeCard(p, zone, idx) {
  const s = state[p];
  if (SLOTS.includes(zone)) s.slots[zone] = null;
  else s[zone].splice(idx, 1);
}

function showCtxMenu(e, items) {
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = items.map((it, i) => `<div onclick="ctxAction(${i})">${it.label}</div>`).join('');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.style.display = 'block';
  menu._items = items;
}
function ctxAction(i) {
  const menu = document.getElementById('ctx-menu');
  menu.style.display = 'none';
  if (menu._items && menu._items[i]) menu._items[i].fn();
}
document.addEventListener('click', () => { document.getElementById('ctx-menu').style.display = 'none'; });

// --- Zone panel ---
function openZonePanel(title, cards, p, zone) {
  const panel = document.getElementById('zone-panel');
  document.getElementById('zone-panel-title').textContent = title;
  document.getElementById('zone-panel-cards').innerHTML = cards.map((c, i) => makeCardHtml(c, p, zone, i)).join('');
  panel.style.display = 'flex';
  setupDragDrop();
}
function closeZonePanel() { document.getElementById('zone-panel').style.display = 'none'; }

// --- Utility ---
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function log(msg, cls) {
  const el = document.getElementById('log');
  el.innerHTML = `<div class="entry ${cls || ''}">${msg}</div>` + el.innerHTML;
}

function nAdj(id, d) {
  const el = document.getElementById(id);
  el.textContent = Math.max(1, (+el.textContent) + d);
}

// --- Init ---
populateDeckSelects();
render();
