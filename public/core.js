export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => globalThis.crypto.randomUUID();
export const DEFAULT_GAME_TITLE = 'Корпорация Пирожкова';
export const blankQuestion = () => ({ id: uid(), text: '', image: '', answer: '', answerImage: '' });
export const blankCell = () => ({ id: uid(), questionId: '', question: null, cat: false, modifier: false, played: false });
export const blankRound = (name = 'Новый раунд') => ({ id: uid(), name, prices: [100, 200, 300, 400, 500], topics: [] });
export const blankFinal = () => ({ enabled: false, topics: [], run: null });
export function newGame() {
  const round = blankRound('Раунд 1');
  return { title: DEFAULT_GAME_TITLE, teams: [1, 2, 3].map(n => ({ id: uid(), name: `Команда ${n}`, score: 0 })), rounds: [round], catPool: [], modPool: [], specialBank: null,
    started: false, finished: false, roundId: round.id, active: null, usedCats: [], log: [], final: blankFinal() };
}
export function topicFromTheme(theme, assign = false) {
  return { id: uid(), themeId: theme.id, name: theme.name, cells: Array.from({ length: 5 }, (_, i) => {
    const cell = blankCell();
    if (assign && theme.questions[i]) { cell.questionId = theme.questions[i].id; cell.question = clone(theme.questions[i]); }
    return cell;
  }) };
}
export const safeUrl = url => {
  if (!url) return '';
  try { const u = new URL(url); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; }
};
const content = (text, image) => !!String(text || '').trim() || !!safeUrl(image);
export function questionIssues(q) {
  if (!q) return ['не назначен вопрос'];
  const issues = [];
  if (!content(q.text, q.image)) issues.push('нет текста или картинки вопроса');
  if (!content(q.answer, q.answerImage)) issues.push('нет текста или картинки ответа');
  if (q.image && !safeUrl(q.image)) issues.push('некорректный URL картинки вопроса');
  if (q.answerImage && !safeUrl(q.answerImage)) issues.push('некорректный URL картинки ответа');
  return issues;
}
export function validModifier(m) {
  return !!m && !!m.name?.trim() && Number.isFinite(m.value) &&
    (m.type === 'multiply' ? m.value > 0 && m.value <= 100 : m.type === 'fixed' && Math.abs(m.value) <= 1000000 && ['win', 'loss', 'always'].includes(m.on));
}
export function selectedSpecials(state) {
  if (state.game.started && state.game.specialBank) return state.game.specialBank;
  return { cats: state.bank.cats.filter(q => state.game.catPool.includes(q.id)), modifiers: state.bank.modifiers.filter(m => state.game.modPool.includes(m.id)) };
}
export function readiness(state) {
  const g = state.game, errors = [], seen = new Set(), specials = selectedSpecials(state);
  if (!g.title.trim()) errors.push('Укажите название игры.');
  if (g.teams.length < 1 || g.teams.length > 3) errors.push('Нужно от 1 до 3 команд.');
  if (g.teams.some(t => !t.name.trim())) errors.push('Заполните названия команд.');
  if (new Set(g.teams.map(t => t.name.trim().toLowerCase())).size !== g.teams.length) errors.push('Названия команд должны различаться.');
  if (!g.rounds.length) errors.push('Добавьте хотя бы один раунд.');
  let cats = 0, mods = 0;
  for (const r of g.rounds) {
    if (!r.name.trim()) errors.push('Укажите название каждого раунда.');
    if (r.prices.length !== 5 || r.prices.some(p => !Number.isSafeInteger(p) || p <= 0 || p > 1000000)) errors.push(`${r.name}: нужны 5 положительных целых цен до 1 000 000.`);
    if (!r.topics.length || r.topics.length > 6) errors.push(`${r.name}: нужно от 1 до 6 тем.`);
    for (const t of r.topics) {
      if (!t.name.trim()) errors.push(`${r.name}: у темы нет названия.`);
      if (t.cells.length !== 5) errors.push(`${r.name} / ${t.name}: должно быть 5 клеток.`);
      for (const [i, c] of t.cells.entries()) {
        if (c.modifier) mods++;
        if (c.cat) { cats++; continue; }
        for (const issue of questionIssues(c.question)) errors.push(`${r.name} / ${t.name} / ${r.prices[i]}: ${issue}.`);
        if (c.questionId) {
          if (seen.has(c.questionId)) errors.push(`${r.name} / ${t.name}: вопрос повторяется в игре.`);
          seen.add(c.questionId);
        }
      }
    }
  }
  if (cats > specials.cats.length) errors.push(`Для ${cats} клеток с котом нужно ${cats} разных вопросов; выбрано ${specials.cats.length}.`);
  for (const q of specials.cats) for (const issue of questionIssues(q)) errors.push(`Кот «${q.text.slice(0, 35) || 'без названия'}»: ${issue}.`);
  if (mods && !specials.modifiers.length) errors.push('Выберите хотя бы один модификатор в пул игры.');
  if (specials.modifiers.some(m => !validModifier(m))) errors.push('В пуле есть некорректный модификатор.');
  return errors.concat(finalReadiness(state));
}
export function finalReadiness(state) {
  const f=state.game.final;
  if(!f?.enabled)return [];
  const errors=[],used=new Set(state.game.rounds.flatMap(r=>r.topics.flatMap(t=>t.cells.filter(c=>!c.cat).map(c=>c.questionId))).filter(Boolean));
  if(f.topics.length!==5)errors.push('Финал: настройте ровно 5 тем.');
  const themes=new Set();
  for(const [i,t] of f.topics.entries()){
    if(!t.themeId||!t.name.trim())errors.push(`Финал / тема ${i+1}: выберите тему из банка.`);
    else if(themes.has(t.themeId))errors.push(`Финал: тема «${t.name}» выбрана повторно.`);
    themes.add(t.themeId);
    for(const issue of questionIssues(t.question))errors.push(`Финал / ${t.name||'тема '+(i+1)}: ${issue}.`);
    if(t.questionId){if(used.has(t.questionId))errors.push(`Финал / ${t.name}: вопрос уже назначен обычному раунду или другой теме финала.`);used.add(t.questionId);}
  }
  return errors;
}
export function startGame(state, rehearsal = false) {
  if (state.game.started) return;
  const errors = readiness(state);
  if (errors.length && !rehearsal) throw new Error('Игра не готова. Исправьте ошибки в настройках.');
  state.game.specialBank = clone(selectedSpecials(state));
  state.game.started = true;
  state.game.finished = false;
}
export function findCell(g, cellId) {
  for (const r of g.rounds) for (const t of r.topics) {
    const i = t.cells.findIndex(c => c.id === cellId);
    if (i !== -1) return { round: r, topic: t, cell: t.cells[i], index: i };
  }
  throw new Error('Клетка не найдена.');
}
export function editableCell(g, id) {
  const found = findCell(g, id);
  if (g.finished || found.cell.played || g.active?.cellId === id) throw new Error('Открытую или сыгранную клетку менять нельзя.');
  return found;
}
export function assignQuestion(g, cellId, question) {
  const { cell } = editableCell(g, cellId);
  if(question&&g.final?.enabled&&g.final.topics.some(t=>t.questionId===question.id))throw new Error('Этот вопрос уже назначен финалу.');
  if (question) for (const r of g.rounds) for (const t of r.topics) for (const c of t.cells) {
    if (c.id !== cellId && !c.cat && c.questionId === question.id) throw new Error('Этот вопрос уже назначен другой клетке.');
  }
  cell.questionId = question?.id || '';
  cell.question = question ? clone(question) : null;
}
const draw = (items, random) => items.length ? clone(items[Math.min(items.length - 1, Math.floor(random() * items.length))]) : null;
export function openCell(state, id, rehearsal = false, random = Math.random) {
  const g = state.game;
  if (!g.started || g.finished || g.active || g.final?.run) throw new Error('Сейчас нельзя открыть новую клетку.');
  const { round, topic, cell, index } = findCell(g, id);
  if (cell.played) throw new Error('Этот вопрос уже сыгран.');
  const specials = selectedSpecials(state);
  let question = cell.question;
  if (cell.cat) {
    question = draw(specials.cats.filter(q => !g.usedCats.includes(q.id)), random);
    if (!question && !rehearsal) throw new Error('В пуле закончились коты.');
  }
  const modifier = cell.modifier ? draw(specials.modifiers, random) : null;
  if (cell.modifier && !modifier && !rehearsal) throw new Error('Пул модификаторов пуст.');
  if (cell.cat && question) g.usedCats.push(question.id);
  g.roundId = round.id;
  g.active = { cellId: id, topic: topic.name, question: clone(question || { text: 'Здесь пока нет вопроса', answer: 'Заполните эту клетку перед настоящей игрой.' }), cat: cell.cat, modifier,
    stage: cell.cat || cell.modifier ? 'special' : 'question', price: round.prices[index], teamId: '', answeringTeamId: '', attempts: [], catPriceConfirmed: !cell.cat };
}
export function confirmSpecial(g, price, teamId) {
  const a = g.active;
  if (!a || a.stage !== 'special') throw new Error('Нет открытого специального события.');
  if (a.cat) {
    if (!Number.isSafeInteger(price) || price <= 0 || price > 1000000) throw new Error('Цена кота должна быть целым числом от 1 до 1 000 000.');
    if (!g.teams.some(t => t.id === teamId)) throw new Error('Выберите команду для кота.');
    a.price = price; a.teamId = teamId; a.answeringTeamId = teamId; a.catPriceConfirmed = true;
  }
  a.stage = 'question';
}
export function selectAnswering(g, teamId) {
  const a = g.active;
  if (!a || a.stage !== 'question' || !g.teams.some(t => t.id === teamId)) throw new Error('Нельзя назначить отвечающую команду.');
  if (a.attempts.includes(teamId)) throw new Error('Эта команда уже отвечала.');
  if (a.cat && !a.attempts.length && a.teamId !== teamId) throw new Error('Первой отвечает назначенная команда.');
  a.answeringTeamId = teamId;
}
export function revealAnswer(g) {
  if (!g.active || g.active.stage !== 'question') throw new Error('Сначала откройте вопрос.');
  g.active.stage = 'answer';
  g.active.resolution = { correct: null };
}
export function judgeAnswer(g, teamId, correct) {
  const a = g.active, team = g.teams.find(t => t.id === teamId);
  if (!a || a.stage !== 'question' || !team || a.answeringTeamId !== teamId || a.attempts.includes(teamId) || typeof correct !== 'boolean') throw new Error('Сначала выберите доступную отвечающую команду.');
  const delta = scoreDelta(a.price, a.modifier, correct ? 1 : -1);
  if (!Number.isSafeInteger(team.score + delta)) throw new Error('Счёт вышел за допустимый диапазон.');
  team.score += delta;
  g.log.push({ id: uid(), time: Date.now(), team: team.name, delta, reason: `${a.topic} · ${correct ? 'Верно' : 'Неверно'}`, cellId: a.cellId });
  if (correct) {
    a.resolution = { correct: true, teamId, delta };
    a.stage = 'answer';
  } else {
    a.attempts.push(teamId);
    a.answeringTeamId = '';
  }
  return delta;
}
export function scoreDelta(price, modifier, sign) {
  let value = sign * price;
  if (modifier?.type === 'multiply') value *= modifier.value;
  if (modifier?.type === 'fixed' && (modifier.on === 'always' || modifier.on === (sign > 0 ? 'win' : 'loss'))) value += modifier.value;
  return Math.round(value);
}
export function setScore(g, teamId, value) {
  if (!Number.isSafeInteger(value)) throw new Error('Счёт должен быть целым числом.');
  const t = g.teams.find(t => t.id === teamId);
  if (!t) throw new Error('Команда не найдена.');
  if (!Number.isSafeInteger(value - t.score)) throw new Error('Слишком большое изменение счёта.');
  g.log.push({ id: uid(), time: Date.now(), team: t.name, delta: value - t.score, reason: 'Ручная корректировка' });
  t.score = value;
  const final=g.final?.run;
  if(final&&['veto','bets'].includes(final.stage)){
    final.caps[teamId]=Math.max(0,value);
    if(value<=0)final.bets[teamId]=0;
    else if(final.bets[teamId]>value)final.bets[teamId]=null;
  }
}
export function closeQuestion(g) {
  if (!g.active) return;
  findCell(g, g.active.cellId).cell.played = true;
  g.active = null;
}
export function finishGame(g) {
  closeQuestion(g); g.finished = true;
}
export function resetGame(state) {
  const g = state.game;
  g.started = false; g.finished = false; g.active = null; g.usedCats = []; g.log = []; g.specialBank = null;
  for (const t of g.teams) t.score = 0;
  for (const r of g.rounds) for (const t of r.topics) for (const c of t.cells) c.played = false;
  g.roundId = g.rounds[0]?.id || '';
  if(g.final)g.final.run=null;
}
export const STORAGE_KEY = 'rnimu-svoya-igra-v1';
export function validSavedState(s) {
  const array = Array.isArray;
  const text = x => typeof x === 'string';
  const question = q => q && ['id','text','image','answer','answerImage'].every(k=>text(q[k]));
  const g = s?.game, b = s?.bank;
  return s?.version === 1 && b && array(b.themes) && array(b.cats) && array(b.modifiers) &&
    b.themes.every(t=>text(t.id)&&text(t.name)&&array(t.questions)&&t.questions.every(question)) && b.cats.every(question) &&
    b.modifiers.every(m=>text(m.id)&&text(m.name)&&text(m.description)) &&
    g && text(g.title) && array(g.teams) && g.teams.length >= 1 && g.teams.length <= 3 &&
    g.teams.every(t=>text(t.id)&&text(t.name)&&Number.isSafeInteger(t.score)) &&
    array(g.rounds) && g.rounds.every(r=>text(r.id)&&text(r.name)&&array(r.prices)&&r.prices.length===5&&
      array(r.topics)&&r.topics.every(t=>text(t.id)&&text(t.name)&&array(t.cells)&&t.cells.length===5&&
        t.cells.every(c=>text(c.id)&&text(c.questionId)&&(c.question===null||question(c.question))))) &&
    array(g.catPool) && array(g.modPool) && array(g.usedCats) && array(g.log) &&
    (g.final===undefined||(g.final&&typeof g.final.enabled==='boolean'&&array(g.final.topics)&&g.final.topics.length<=5&&g.final.topics.every(t=>text(t.id)&&text(t.themeId)&&text(t.name)&&text(t.questionId)&&(t.question===null||question(t.question)))&&(!g.final.run||['veto','bets','question','review','complete'].includes(g.final.run.stage)))) &&
    (!g.active || (text(g.active.cellId) && ['special','question','answer'].includes(g.active.stage) &&
      question(g.active.question) && array(g.active.attempts)));
}
export function saveState(storage, state) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
export function loadState(storage, fallback) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return { state: fallback(), warning: '' };
    const s = JSON.parse(raw);
    if (!validSavedState(s)) throw new Error();
    if(s.game.final===undefined)s.game.final=blankFinal();
    if (s.game.title === 'Своя игра · РНИМУ') s.game.title = DEFAULT_GAME_TITLE;
    return { state: s, warning: '' };
  } catch { return { state: fallback(), warning: 'Не удалось прочитать сохранение. Исходные данные не перезаписаны. Откройте приложение в прежнем браузере или проверьте доступ к хранилищу.' }; }
}
