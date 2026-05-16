// ChaosTCG 一人回しシミュレータ
'use strict';

let cardMap = {};
fetch('card_map.json').then(r => r.json()).then(d => { cardMap = d; });

const PHASES = ['beginning', 'main', 'battle', 'end'];
const AREAS = ['partner', 'front-l', 'front-r', 'back-l', 'back-r'];

const game = {
  deck: [], extra: [], hand: [], discard: [], backyard: [],
  field: { partner: null, 'front-l': null, 'front-r': null, 'back-l': null, 'back-r': null },
  partnerName: '',
  phase: -1, turn: 0,
  mulliganUsed: false, levelUpUsed: false, friendPlayed: false,
  selectedHand: -1,

  // --- Init ---
  loadDeck(cards, extraCards) {
    this.reset();
    // Find partner card (type 'パートナー' or first card)
    let partnerIdx = cards.findIndex(c => c.type === 'partner');
    if (partnerIdx < 0) partnerIdx = 0;
    const partnerCard = cards.splice(partnerIdx, 1)[0];
    this.partnerName = partnerCard.name;
    this.field.partner = { ...partnerCard, state: 'stand', faceUp: true, level: 0, damage: 0, levelCards: [] };
    this.extra = (extraCards || []).map(c => ({ ...c }));
    this.deck = this.shuffle([...cards]);
    // Draw 5
    for (let i = 0; i < 5; i++) this.drawOne(true);
    this.turn = 1;
    this.phase = 0;
    this.log('ゲーム開始。パートナー: ' + this.partnerName, 'phase');
    this.render();
  },

  reset() {
    this.deck = []; this.extra = []; this.hand = []; this.discard = []; this.backyard = [];
    this.field = { partner: null, 'front-l': null, 'front-r': null, 'back-l': null, 'back-r': null };
    this.partnerName = ''; this.phase = -1; this.turn = 0;
    this.mulliganUsed = false; this.levelUpUsed = false; this.friendPlayed = false;
    this.selectedHand = -1;
    document.getElementById('log').innerHTML = '';
    this.render();
  },

  // --- Phase progression ---
  nextPhase() {
    if (this.phase < 0) return;
    this.phase++;
    if (this.phase >= PHASES.length) {
      // New turn
      this.turn++;
      this.phase = 0;
      this.levelUpUsed = false;
      this.friendPlayed = false;
      this.log(`── ターン ${this.turn} ──`, 'phase');
      this.doBeginning();
    } else if (PHASES[this.phase] === 'beginning') {
      this.doBeginning();
    } else if (PHASES[this.phase] === 'main') {
      this.log('メインフェイズ', 'phase');
    } else if (PHASES[this.phase] === 'battle') {
      this.log('バトルフェイズ', 'phase');
    } else if (PHASES[this.phase] === 'end') {
      this.log('エンドフェイズ', 'phase');
    }
    this.render();
  },

  doBeginning() {
    this.log('ビギニングフェイズ', 'phase');
    // Recovery: stand all
    for (const area of AREAS) {
      const c = this.field[area];
      if (!c) continue;
      if (c.state === 'rest') { c.state = 'stand'; this.log(`${c.name} スタンド`); }
      else if (c.state === 'reverse') { c.state = 'rest'; this.log(`${c.name} レスト状態に`); }
    }
    // Draw
    if (this.deck.length > 0) {
      this.drawOne();
    } else {
      this.log('デッキ切れ！敗北', 'damage');
    }
  },

  // --- Actions ---
  draw() { this.drawOne(); this.render(); },

  drawOne(silent) {
    if (this.deck.length === 0) { if (!silent) this.log('デッキが空です', 'damage'); return null; }
    const c = this.deck.pop();
    this.hand.push(c);
    if (!silent) this.log(`ドロー: ${c.name}`);
    this.render();
    return c;
  },

  mulligan() {
    if (this.mulliganUsed) { this.log('マリガン済み'); return; }
    this.mulliganUsed = true;
    const count = this.hand.length;
    this.deck.push(...this.hand);
    this.hand = [];
    this.deck = this.shuffle(this.deck);
    for (let i = 0; i < count; i++) this.drawOne(true);
    this.log(`マリガン: ${count}枚引き直し`);
    this.render();
  },

  levelUp() {
    if (this.levelUpUsed) { this.log('このターンはレベルアップ済み'); return; }
    if (this.selectedHand < 0) { this.log('手札からレベルアップに使うカードを選択してください'); return; }
    const card = this.hand[this.selectedHand];
    const partner = this.field.partner;
    if (!partner) { this.log('パートナーがいません'); return; }
    if (card.name !== partner.name) { this.log('パートナーと同名カードが必要です'); return; }
    // Perform level up
    this.hand.splice(this.selectedHand, 1);
    this.selectedHand = -1;
    partner.level++;
    partner.levelCards.push(card);
    partner.faceUp = true;
    partner.state = 'stand';
    partner.damage = 0;
    this.levelUpUsed = true;
    this.log(`レベルアップ! ${partner.name} Lv.${partner.level}`, 'cancel');
    this.render();
  },

  attack() {
    if (PHASES[this.phase] !== 'battle') { this.log('バトルフェイズ中のみアタック可能'); return; }
    // Pick attacker from field
    const attackers = AREAS.filter(a => {
      const c = this.field[a];
      return c && c.faceUp && c.state === 'stand';
    });
    if (attackers.length === 0) { this.log('アタック可能なキャラがいません'); return; }
    this.showPicker('アタックキャラ選択', attackers.map(a => this.field[a].name + ' (' + a + ')'), idx => {
      const area = attackers[idx];
      const c = this.field[area];
      c.state = 'rest';
      this.log(`${c.name} でアタック宣言`);
      if (area === 'partner') {
        this.drawOne();
        this.log('アタックドロー');
      }
      this.render();
    });
  },

  dealDamage() {
    const amt = parseInt(prompt('ダメージ量を入力:'), 10);
    if (!amt || amt <= 0) return;
    this.processDamage(amt);
    this.render();
  },

  processDamage(amount) {
    this.log(`${amount}ダメージ処理開始`, 'damage');
    let remaining = amount;
    while (remaining > 0) {
      if (this.deck.length === 0) {
        this.log('デッキ切れ！敗北', 'damage');
        return;
      }
      const card = this.deck.pop();
      // Check partner cancel
      if (card.name === this.partnerName) {
        this.log(`★ ${card.name} めくれた → パートナーキャンセル!`, 'cancel');
        // Auto level up
        const partner = this.field.partner;
        if (partner) {
          partner.level++;
          partner.levelCards.push(card);
          partner.faceUp = true;
          partner.state = 'stand';
          partner.damage = 0;
          this.log(`オートレベルアップ Lv.${partner.level} 残ダメージ${remaining - 1}キャンセル`, 'cancel');
        }
        remaining = 0;
      } else {
        this.discard.push(card);
        remaining--;
        this.log(`${card.name} → 控え室 (残${remaining})`);
      }
    }
  },

  shuffleDeck() {
    this.deck = this.shuffle(this.deck);
    this.log('デッキシャッフル');
    this.render();
  },

  // --- Field interaction ---
  clickSlot(area) {
    if (this.selectedHand >= 0) {
      // Place card from hand
      const card = this.hand[this.selectedHand];
      if (area === 'partner') { this.log('パートナーエリアには配置できません'); return; }
      if (this.field[area]) {
        // Swap to discard
        this.discard.push(this.field[area]);
        this.log(`${this.field[area].name} → 控え室`);
      }
      this.field[area] = { ...card, state: 'stand', faceUp: true, level: 0, damage: 0, levelCards: [] };
      this.hand.splice(this.selectedHand, 1);
      this.selectedHand = -1;
      this.log(`${card.name} → ${area}`);
      this.render();
    } else {
      // Toggle state
      const c = this.field[area];
      if (!c) return;
      if (c.state === 'stand') c.state = 'rest';
      else if (c.state === 'rest') c.state = 'reverse';
      else c.state = 'stand';
      this.render();
    }
  },

  peekDeck() {
    if (this.deck.length === 0) return;
    const top = this.deck[this.deck.length - 1];
    this.showModal(`<h3>デッキトップ</h3><p>${top.name} (${top.number})</p><button onclick="game.closeModal()">閉じる</button>`);
  },

  showDiscard() {
    if (this.discard.length === 0) { this.log('控え室は空です'); return; }
    let html = '<h3>控え室 (' + this.discard.length + ')</h3><div class="card-list">';
    this.discard.forEach(c => { html += `<div class="pick">${c.name}</div>`; });
    html += '</div><button onclick="game.closeModal()">閉じる</button>';
    this.showModal(html);
  },

  // --- Hand selection ---
  selectHand(idx) {
    this.selectedHand = this.selectedHand === idx ? -1 : idx;
    this.render();
  },

  // --- UI helpers ---
  showPicker(title, options, callback) {
    let html = `<h3>${title}</h3><div class="card-list">`;
    options.forEach((o, i) => { html += `<div class="pick" onclick="game._pickerCb(${i})">${o}</div>`; });
    html += '</div><button onclick="game.closeModal()">キャンセル</button>';
    this._pickerCallback = callback;
    this.showModal(html);
  },
  _pickerCb(idx) { this.closeModal(); if (this._pickerCallback) this._pickerCallback(idx); },

  showModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal').classList.add('show');
  },
  closeModal() { document.getElementById('modal').classList.remove('show'); },

  log(msg, cls) {
    const el = document.getElementById('log');
    el.innerHTML = `<div class="log-entry ${cls || ''}">${msg}</div>` + el.innerHTML;
  },

  // --- Render ---
  render() {
    // Phase bar
    document.querySelectorAll('#phase-bar .phase').forEach(el => {
      el.classList.toggle('active', el.dataset.phase === PHASES[this.phase]);
    });
    document.getElementById('turn-count').textContent = 'T' + this.turn;

    // Zones
    document.getElementById('deck-count').textContent = this.deck.length;
    document.getElementById('extra-count').textContent = this.extra.length;
    document.getElementById('discard-count').textContent = this.discard.length;
    document.getElementById('backyard-count').textContent = this.backyard.length;

    // Field slots
    for (const area of AREAS) {
      const slot = document.querySelector(`.slot[data-area="${area}"]`);
      const c = this.field[area];
      slot.className = 'slot' + (area === 'partner' ? ' partner' : '');
      if (c) {
        slot.classList.add('has-card');
        if (c.state === 'rest') slot.classList.add('rest');
        if (c.state === 'reverse' || !c.faceUp) slot.classList.add('reverse');
        const cm = cardMap[c.number] || {};
        let inner = '';
        if (cm.image) inner += `<img class="card-img" src="${cm.image}" alt="${c.name}">`;
        else inner += `<span class="card-name">${c.name}</span>`;
        if (c.level > 0) inner += `<span class="level-badge">Lv${c.level}</span>`;
        if (c.damage > 0) inner += `<span class="dmg-badge">${c.damage}</span>`;
        slot.innerHTML = inner;
      } else {
        slot.innerHTML = `<span>${area === 'partner' ? 'パートナー' : area}</span>`;
      }
    }

    // Hand
    const handEl = document.getElementById('hand');
    document.getElementById('hand-count').textContent = this.hand.length;
    handEl.innerHTML = this.hand.map((c, i) => {
      const cm = cardMap[c.number] || {};
      const sel = i === this.selectedHand ? ' selected' : '';
      const img = cm.image ? `<img src="${cm.image}" alt="${c.name}">` : c.name;
      return `<div class="hand-card${sel}" onclick="game.selectHand(${i})">${img}</div>`;
    }).join('');
  },

  // --- Utility ---
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
};

// --- Deck loading ---
function loadFromStorage() {
  const data = localStorage.getItem('chaos-deck');
  if (!data) { game.log('localStorageにデッキがありません'); return; }
  const deck = JSON.parse(data);
  const cards = [];
  const extra = [];
  deck.cards.forEach(entry => {
    for (let i = 0; i < entry.count; i++) {
      const c = { number: entry.number, name: entry.name || entry.number, type: entry.type || 'chara' };
      if (c.type === 'extra') extra.push(c);
      else cards.push(c);
    }
  });
  if (deck.partner) {
    const pi = cards.findIndex(c => c.number === deck.partner);
    if (pi >= 0) cards[pi].type = 'partner';
  }
  game.loadDeck(cards, extra);
}

function loadSampleDeck() {
  // Load from recipes.json first entry
  fetch('recipes.json').then(r => r.json()).then(recipes => {
    if (!recipes.length) { game.log('レシピなし'); return; }
    const r = recipes[0];
    const cards = [];
    r.cards.forEach(entry => {
      for (let i = 0; i < entry.count; i++) {
        cards.push({ number: entry.number, name: (cardMap[entry.number] || {}).name || entry.number, type: 'chara' });
      }
    });
    // Set partner
    if (r.partner) {
      const pi = cards.findIndex(c => c.number === r.partner);
      if (pi >= 0) cards[pi].type = 'partner';
    }
    game.loadDeck(cards, []);
  });
}

// Init render
game.render();
