const GameEngine = (() => {
  let gameState = {
    mode: 'typing',
    activeCards: [],
    deck: [],
    reviewDeck: [],
    score: 0,
    combo: 0,
    maxCombo: 0,
    sessionCorrect: 0,
    sessionWrong: 0,
    newlyMastered: [],
    currentStage: 1,
    pendingGridIndices: new Set(),
    isComposing: false,
    selectedMatchCard: null,
    reviewMode: false,
    paused: false,
  };

  // ── Deck Building ──────────────────────────────────────────────────────────

  function buildWeightedDeck() {
    const unlocked = Storage.getUnlockedStages();
    const eligibleIds = new Set();
    STAGES.forEach(s => {
      if (unlocked.includes(s.id)) s.words.forEach(id => eligibleIds.add(id));
    });

    const main = [];
    const review = [];

    eligibleIds.forEach(id => {
      const p = Storage.getProgress(id);
      let w = p.weight;
      if (p.wrong_count > 0 && !p.mastered) w *= 1.5;
      if (p.mastered) { review.push({ id, weight: 0.3 }); }
      else            { main.push({ id, weight: w }); }
    });

    if (main.length === 0) {
      gameState.reviewMode = true;
      main.push(...review.map(r => ({ ...r, weight: 0.5 })));
    }

    gameState.deck = weightedShuffle(main);
    gameState.reviewDeck = weightedShuffle(review).slice(0, Math.max(1, Math.floor(gameState.deck.length * 0.1)));
  }

  function weightedShuffle(items) {
    const result = [];
    const pool = items.map(i => ({ ...i }));
    while (pool.length > 0) {
      const total = pool.reduce((s, i) => s + i.weight, 0);
      let r = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < pool.length; i++) {
        r -= pool[i].weight;
        if (r <= 0) { idx = i; break; }
      }
      result.push(pool[idx].id);
      pool.splice(idx, 1);
    }
    return result;
  }

  function drawWordId() {
    // Occasionally inject a review word
    if (gameState.reviewDeck.length > 0 && Math.random() < 0.1) {
      return gameState.reviewDeck.shift();
    }
    if (gameState.deck.length === 0) buildWeightedDeck();
    return gameState.deck.shift() || HANJA_DATA[0].id;
  }

  function wordById(id) {
    return HANJA_DATA.find(w => w.id === id);
  }

  // ── Card Lifecycle ─────────────────────────────────────────────────────────

  function createCard(wordId, gridIndex) {
    const instanceId = 'ci_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const word = wordById(wordId);
    const card = {
      instanceId,
      wordId,
      state: 'unanswered',
      wrongDeducted: false,
      placedAt: Date.now(),
      gridIndex,
      matchType: null,
    };

    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.instanceId = instanceId;
    el.dataset.wordId = wordId;
    el.dataset.state = 'unanswered';
    el.dataset.gridIndex = gridIndex;
    el.style.gridColumn = (gridIndex % 4) + 1;
    el.style.gridRow    = Math.floor(gridIndex / 4) + 1;

    const progress = Storage.getProgress(wordId);
    const dots = [0,1,2].map(i =>
      `<span class="dot ${i < progress.correct_count ? 'filled' : ''}"></span>`
    ).join('');

    el.innerHTML = `
      <div class="card-inner">
        <div class="card-hanja">${word.char}</div>
        <div class="card-grade">${word.grade}급</div>
        <div class="card-reveal">
          <div class="card-huneum">${word.hun} ${word.eum}</div>
          <div class="card-example">${word.example} · ${word.example_meaning}</div>
        </div>
      </div>
      <div class="card-dots">${dots}</div>`;

    el.addEventListener('click', () => onCardClick(instanceId));
    el.classList.add('entering');
    setTimeout(() => el.classList.remove('entering'), 350);

    document.getElementById('card-grid').appendChild(el);
    gameState.activeCards.push(card);
    return card;
  }

  function retireCard(instanceId) {
    const idx = gameState.activeCards.findIndex(c => c.instanceId === instanceId);
    if (idx === -1) return;
    const card = gameState.activeCards[idx];
    const el = document.querySelector(`[data-instance-id="${instanceId}"]`);
    gameState.pendingGridIndices.add(card.gridIndex);

    if (el) {
      el.classList.add('exiting');
      setTimeout(() => {
        el.remove();
        gameState.pendingGridIndices.delete(card.gridIndex);
        replenish(card.gridIndex);
      }, 300);
    }
    gameState.activeCards.splice(idx, 1);
  }

  function replenish(gridIndex) {
    if (gameState.pendingGridIndices.has(gridIndex)) return;
    if (gameState.mode === 'matching') return;
    const wordId = drawWordId();
    const newCard = createCard(wordId, gridIndex);
    if (gameState.mode === 'typing' && gameState.activeCards.filter(c => c.state === 'active').length === 0) {
      setActiveCard(newCard.instanceId);
    }
  }

  // ── Typing Mode ────────────────────────────────────────────────────────────

  function validateAnswer(input, word) {
    const n = input.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!n) return false;
    if (n === word.eum) return true;
    if (n === word.hun + ' ' + word.eum) return true;
    if (n === word.hun + word.eum) return true;
    return false;
  }

  function setActiveCard(instanceId) {
    gameState.activeCards.forEach(c => {
      if (c.state === 'active') c.state = 'unanswered';
      const el = document.querySelector(`[data-instance-id="${c.instanceId}"]`);
      if (el && el.dataset.state === 'active') el.dataset.state = 'unanswered';
    });
    const card = gameState.activeCards.find(c => c.instanceId === instanceId);
    if (!card) return;
    card.state = 'active';
    const el = document.querySelector(`[data-instance-id="${instanceId}"]`);
    if (el) el.dataset.state = 'active';

    const word = wordById(card.wordId);
    const preview = document.getElementById('active-card-preview');
    if (preview) preview.textContent = word.char;
  }

  function advanceActiveCard() {
    const next = gameState.activeCards.find(c => c.state === 'unanswered');
    if (next) setActiveCard(next.instanceId);
  }

  function handleTypingSubmit() {
    if (gameState.isComposing || gameState.paused) return;
    const input = document.getElementById('answer-input');
    const value = input.value;
    const activeCard = gameState.activeCards.find(c => c.state === 'active');
    if (!activeCard) return;

    const word = wordById(activeCard.wordId);
    if (validateAnswer(value, word)) {
      handleCorrect(activeCard);
    } else {
      handleWrong(activeCard);
    }
    input.value = '';
    input.focus();
  }

  function handleCorrect(card) {
    Storage.recordCorrect(card.wordId);
    gameState.sessionCorrect++;
    gameState.combo++;
    if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;

    const pts = calcScore(card);
    gameState.score += pts;
    Storage.addScore(pts);
    updateHUD();

    const el = document.querySelector(`[data-instance-id="${card.instanceId}"]`);
    if (el) el.dataset.state = 'correct';
    card.state = 'correct';

    const progress = Storage.getProgress(card.wordId);
    if (progress.mastered && !gameState.newlyMastered.includes(card.wordId)) {
      gameState.newlyMastered.push(card.wordId);
      showToast(`✨ ${wordById(card.wordId).char} 완전 습득!`);
    }

    showHuneumOverlay(wordById(card.wordId));
    checkStageProgress();

    setTimeout(() => {
      advanceActiveCard();
      retireCard(card.instanceId);
    }, 400);
  }

  function handleWrong(card) {
    if (!card.wrongDeducted) {
      Storage.recordWrong(card.wordId);
      gameState.sessionWrong++;
      gameState.score = Math.max(0, gameState.score - 5);
      Storage.addScore(-5);
      card.wrongDeducted = true;
    }
    gameState.combo = 0;
    updateHUD();

    const el = document.querySelector(`[data-instance-id="${card.instanceId}"]`);
    if (el) {
      el.dataset.state = 'wrong';
      setTimeout(() => { if (el) el.dataset.state = 'active'; }, 500);
    }
  }

  // ── Matching Mode ──────────────────────────────────────────────────────────

  function startMatchingMode() {
    const grid = document.getElementById('card-grid');
    grid.innerHTML = '';
    gameState.activeCards = [];
    gameState.selectedMatchCard = null;

    const pool = getUniqueEumBatch(8);
    const pairs = [];
    pool.forEach(id => {
      pairs.push({ wordId: id, matchType: 'hanja' });
      pairs.push({ wordId: id, matchType: 'eum' });
    });
    shuffleArray(pairs);

    pairs.forEach((p, i) => {
      const instanceId = 'ci_' + Date.now() + '_' + i + '_' + Math.floor(Math.random() * 1e6);
      const word = wordById(p.wordId);
      const card = { instanceId, wordId: p.wordId, state: 'unanswered', wrongDeducted: false, placedAt: Date.now(), gridIndex: i, matchType: p.matchType };

      const el = document.createElement('div');
      el.className = 'card match-card';
      el.dataset.instanceId = instanceId;
      el.dataset.wordId = p.wordId;
      el.dataset.state = 'unanswered';
      el.dataset.matchType = p.matchType;
      el.dataset.gridIndex = i;
      el.style.gridColumn = (i % 4) + 1;
      el.style.gridRow    = Math.floor(i / 4) + 1;

      el.innerHTML = `<div class="card-inner">
        <div class="card-hanja match-label">${p.matchType === 'hanja' ? word.char : word.eum}</div>
        ${p.matchType === 'eum' ? `<div class="card-grade">${word.grade}급</div>` : ''}
      </div>`;

      el.addEventListener('click', () => onMatchCardClick(instanceId));
      el.classList.add('entering');
      setTimeout(() => el.classList.remove('entering'), 350);
      grid.appendChild(el);
      gameState.activeCards.push(card);
    });
  }

  function getUniqueEumBatch(count) {
    const unlocked = Storage.getUnlockedStages();
    const eligibleIds = [];
    STAGES.forEach(s => {
      if (unlocked.includes(s.id)) s.words.forEach(id => eligibleIds.push(id));
    });
    shuffleArray(eligibleIds);

    const seen = new Set();
    const result = [];
    for (const id of eligibleIds) {
      const w = wordById(id);
      if (!seen.has(w.eum)) {
        seen.add(w.eum);
        result.push(id);
        if (result.length === count) break;
      }
    }
    return result;
  }

  function onMatchCardClick(instanceId) {
    if (gameState.paused) return;
    const card = gameState.activeCards.find(c => c.instanceId === instanceId);
    if (!card || card.state === 'correct') return;
    const el = document.querySelector(`[data-instance-id="${instanceId}"]`);

    if (!gameState.selectedMatchCard) {
      gameState.selectedMatchCard = instanceId;
      card.state = 'active';
      if (el) el.dataset.state = 'active';
      return;
    }

    if (gameState.selectedMatchCard === instanceId) {
      gameState.selectedMatchCard = null;
      card.state = 'unanswered';
      if (el) el.dataset.state = 'unanswered';
      return;
    }

    const prevCard = gameState.activeCards.find(c => c.instanceId === gameState.selectedMatchCard);
    const prevEl   = document.querySelector(`[data-instance-id="${gameState.selectedMatchCard}"]`);

    const isMatch = prevCard && prevCard.wordId === card.wordId &&
      prevCard.matchType !== card.matchType;

    if (isMatch) {
      gameState.combo++;
      if (gameState.combo > gameState.maxCombo) gameState.maxCombo = gameState.combo;
      const pts = calcScore(card);
      gameState.score += pts;
      Storage.addScore(pts);
      Storage.recordCorrect(card.wordId);
      gameState.sessionCorrect++;
      updateHUD();
      showHuneumOverlay(wordById(card.wordId));
      checkStageProgress();

      [prevCard, card].forEach(c => {
        const e = document.querySelector(`[data-instance-id="${c.instanceId}"]`);
        if (e) e.dataset.state = 'correct';
        c.state = 'correct';
      });

      const [id1, id2] = [prevCard.instanceId, card.instanceId];
      setTimeout(() => {
        retireMatchCard(id1);
        retireMatchCard(id2);
        if (gameState.activeCards.length === 0) startMatchingMode();
      }, 500);
    } else {
      gameState.combo = 0;
      gameState.score = Math.max(0, gameState.score - 5);
      Storage.addScore(-5);
      gameState.sessionWrong++;
      updateHUD();

      [prevCard, card].forEach(c => {
        if (!c) return;
        const e = document.querySelector(`[data-instance-id="${c.instanceId}"]`);
        if (e) e.dataset.state = 'wrong';
        c.state = 'wrong';
      });
      setTimeout(() => {
        [prevCard, card].forEach(c => {
          if (!c) return;
          const e = document.querySelector(`[data-instance-id="${c.instanceId}"]`);
          if (e) e.dataset.state = 'unanswered';
          c.state = 'unanswered';
        });
      }, 500);
    }

    gameState.selectedMatchCard = null;
  }

  function retireMatchCard(instanceId) {
    const idx = gameState.activeCards.findIndex(c => c.instanceId === instanceId);
    if (idx !== -1) gameState.activeCards.splice(idx, 1);
    const el = document.querySelector(`[data-instance-id="${instanceId}"]`);
    if (el) { el.classList.add('exiting'); setTimeout(() => el.remove(), 300); }
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  function calcScore(card) {
    const mult = getComboMult(gameState.combo);
    const elapsed = (Date.now() - card.placedAt) / 1000;
    const speed = Math.max(0, Math.floor((30 - elapsed) / 3));
    return Math.round(10 * 3 * mult) + speed;
  }

  function getComboMult(combo) {
    if (combo >= 10) return 3;
    if (combo >= 6)  return 2;
    if (combo >= 3)  return 1.5;
    return 1;
  }

  // ── Stage Progression ──────────────────────────────────────────────────────

  function checkStageProgress() {
    const unlocked = Storage.getUnlockedStages();
    const maxUnlocked = Math.max(...unlocked);
    const stage = STAGES.find(s => s.id === maxUnlocked);
    if (!stage) return;

    const masteredCount = stage.words.filter(id => Storage.getProgress(id).mastered).length;
    if (masteredCount >= 7) {
      const next = STAGES.find(s => s.id === maxUnlocked + 1);
      if (next) {
        Storage.unlockStage(next.id);
        buildWeightedDeck();
        showToast(`🎉 ${maxUnlocked + 1}단계 개방!`);
      }
    }
  }

  // ── HUD & UI ───────────────────────────────────────────────────────────────

  function updateHUD() {
    const scoreEl = document.getElementById('score-value');
    const comboEl = document.getElementById('combo-value');
    const multEl  = document.getElementById('combo-mult');
    if (scoreEl) scoreEl.textContent = gameState.score.toLocaleString();
    if (comboEl) comboEl.textContent = gameState.combo;
    if (multEl)  {
      const m = getComboMult(gameState.combo);
      multEl.textContent = '×' + m;
      multEl.dataset.tier = m >= 3 ? 'high' : m >= 2 ? 'mid' : m >= 1.5 ? 'low' : 'base';
    }
  }

  let huneumTimer = null;
  function showHuneumOverlay(word) {
    const overlay = document.getElementById('overlay-huneum');
    if (!overlay) return;
    overlay.querySelector('.huneum-char').textContent    = word.char;
    overlay.querySelector('.huneum-reading').textContent = word.hun + ' ' + word.eum;
    overlay.querySelector('.huneum-example').textContent = word.example + ' · ' + word.example_meaning;
    overlay.classList.remove('hidden');
    if (huneumTimer) clearTimeout(huneumTimer);
    huneumTimer = setTimeout(() => overlay.classList.add('hidden'), 1200);
  }

  function showToast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
  }

  function showScreen(id) {
    ['screen-start','screen-game','screen-result'].forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('hidden', s !== id);
    });
  }

  function renderStartScreen() {
    const mastered = Storage.getMastered().length;
    const total    = HANJA_DATA.length;
    const cumScore = Storage.getScore();
    const el = document.getElementById('start-stats');
    if (el) el.innerHTML = `<span>습득 한자: <b>${mastered}</b> / ${total}</span><span>누적 점수: <b>${cumScore.toLocaleString()}</b></span>`;

    const unlocked = Storage.getUnlockedStages();
    const stageEl = document.getElementById('start-stage');
    if (stageEl) stageEl.textContent = `현재 단계: ${Math.max(...unlocked)}단계`;

    updateStageProgress();
  }

  function updateStageProgress() {
    const unlocked = Storage.getUnlockedStages();
    const stageId  = Math.max(...unlocked);
    const stage    = STAGES.find(s => s.id === stageId);
    if (!stage) return;
    const mastered = stage.words.filter(id => Storage.getProgress(id).mastered).length;
    const bar = document.getElementById('stage-progress-bar');
    const label = document.getElementById('stage-progress-label');
    if (bar)   bar.style.width = (mastered / stage.words.length * 100) + '%';
    if (label) label.textContent = `${stageId}단계: ${mastered}/10 습득`;
  }

  function renderResultScreen() {
    const acc = gameState.sessionCorrect + gameState.sessionWrong;
    document.getElementById('result-correct').textContent  = gameState.sessionCorrect;
    document.getElementById('result-wrong').textContent    = gameState.sessionWrong;
    document.getElementById('result-accuracy').textContent = acc ? Math.round(gameState.sessionCorrect / acc * 100) + '%' : '-';
    document.getElementById('result-combo').textContent    = gameState.maxCombo;
    document.getElementById('result-score').textContent    = gameState.score.toLocaleString();

    const masteredEl = document.getElementById('result-mastered');
    if (masteredEl) {
      masteredEl.innerHTML = gameState.newlyMastered.map(id =>
        `<span class="mastered-char">${wordById(id).char}</span>`
      ).join('') || '(없음)';
    }
  }

  // ── Card Click ─────────────────────────────────────────────────────────────

  function onCardClick(instanceId) {
    if (gameState.mode !== 'typing' || gameState.paused) return;
    const card = gameState.activeCards.find(c => c.instanceId === instanceId);
    if (!card || card.state === 'correct') return;
    setActiveCard(instanceId);
    document.getElementById('answer-input')?.focus();
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  function init() {
    Storage.load();
    renderStartScreen();

    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        gameState.mode = btn.dataset.mode;
      });
    });

    document.getElementById('btn-start').addEventListener('click', start);
    document.getElementById('btn-pause').addEventListener('click', pause);
    document.getElementById('btn-resume').addEventListener('click', resume);
    document.getElementById('btn-home').addEventListener('click', goHome);

    const input = document.getElementById('answer-input');
    if (input) {
      input.addEventListener('compositionstart', () => { gameState.isComposing = true; });
      input.addEventListener('compositionend',   () => { gameState.isComposing = false; });
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !gameState.isComposing) handleTypingSubmit();
      });
    }

    document.getElementById('btn-submit')?.addEventListener('click', handleTypingSubmit);

    document.getElementById('overlay-huneum')?.addEventListener('click', () => {
      document.getElementById('overlay-huneum').classList.add('hidden');
    });
  }

  function start() {
    gameState.score = 0;
    gameState.combo = 0;
    gameState.maxCombo = 0;
    gameState.sessionCorrect = 0;
    gameState.sessionWrong = 0;
    gameState.newlyMastered = [];
    gameState.paused = false;
    gameState.reviewMode = false;
    gameState.selectedMatchCard = null;

    buildWeightedDeck();
    showScreen('screen-game');
    updateHUD();

    const typingBar = document.getElementById('typing-bar');
    const stageLabel = document.getElementById('stage-label');
    if (stageLabel) stageLabel.textContent = Math.max(...Storage.getUnlockedStages()) + '단계';

    if (gameState.mode === 'matching') {
      if (typingBar) typingBar.classList.add('hidden');
      startMatchingMode();
    } else {
      if (typingBar) typingBar.classList.remove('hidden');
      const grid = document.getElementById('card-grid');
      grid.innerHTML = '';
      gameState.activeCards = [];
      for (let i = 0; i < 16; i++) createCard(drawWordId(), i);
      setTimeout(() => {
        const first = gameState.activeCards[0];
        if (first) setActiveCard(first.instanceId);
        document.getElementById('answer-input')?.focus();
      }, 50);
    }
  }

  function pause() {
    gameState.paused = true;
    renderResultScreen();
    showScreen('screen-result');
  }

  function resume() {
    gameState.paused = false;
    showScreen('screen-game');
    if (gameState.mode === 'typing') document.getElementById('answer-input')?.focus();
  }

  function goHome() {
    gameState.paused = false;
    renderStartScreen();
    showScreen('screen-start');
  }

  return { init };
})();
