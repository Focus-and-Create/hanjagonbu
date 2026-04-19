const Storage = (() => {
  const PROGRESS_KEY = 'hanjagonbu_progress';
  const GAME_KEY     = 'hanjagonbu_game';

  let progress = {};
  let game = { score: 0, unlockedStages: [1] };

  function defaultProgress(id) {
    return { id, correct_count: 0, wrong_count: 0, weight: 1.0, mastered: false, last_seen: null, wrong_flagged: false };
  }

  function load() {
    try {
      const p = localStorage.getItem(PROGRESS_KEY);
      const g = localStorage.getItem(GAME_KEY);
      progress = p ? JSON.parse(p) : {};
      game     = g ? JSON.parse(g) : { score: 0, unlockedStages: [1] };
      if (!game.unlockedStages) game.unlockedStages = [1];
    } catch (e) {
      progress = {};
      game = { score: 0, unlockedStages: [1] };
    }
    HANJA_DATA.forEach(w => {
      if (!progress[w.id]) progress[w.id] = defaultProgress(w.id);
    });
  }

  function save() {
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
      localStorage.setItem(GAME_KEY, JSON.stringify(game));
    } catch (e) {}
  }

  function getProgress(id) {
    if (!progress[id]) progress[id] = defaultProgress(id);
    return progress[id];
  }

  function recordCorrect(id) {
    const p = getProgress(id);
    p.correct_count++;
    p.weight = 1 / (1 + p.correct_count);
    p.mastered = p.correct_count >= 3;
    p.last_seen = new Date().toISOString();
    p.wrong_flagged = false;
    save();
  }

  function recordWrong(id) {
    const p = getProgress(id);
    p.wrong_count++;
    p.wrong_flagged = true;
    p.last_seen = new Date().toISOString();
    save();
  }

  function getMastered() {
    return Object.values(progress).filter(p => p.mastered).map(p => p.id);
  }

  function addScore(delta) {
    game.score = Math.max(0, (game.score || 0) + delta);
    save();
  }

  function getScore() { return game.score || 0; }

  function unlockStage(stageId) {
    if (!game.unlockedStages.includes(stageId)) {
      game.unlockedStages.push(stageId);
      save();
    }
  }

  function getUnlockedStages() { return game.unlockedStages; }

  function resetAll() {
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(GAME_KEY);
    load();
  }

  return { load, save, getProgress, recordCorrect, recordWrong, getMastered, addScore, getScore, unlockStage, getUnlockedStages, resetAll };
})();
