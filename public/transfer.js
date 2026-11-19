import { clone, uid, validSavedState, validModifier, safeUrl, questionIssues } from './core.js?v=20261120-transfer';
import { validateFinalState } from './final.js';

export const BACKUP_FORMAT = 'pirozhkova-game-backup';
export const BACKUP_VERSION = 1;
export const MAX_FILE_SIZE = 16 * 1024 * 1024;
export const EXCEL_HEADERS = ['Тема', 'Вопрос', 'Ответ', 'Ссылка на картинку вопроса', 'Ссылка на картинку ответа'];
const norm = x => String(x ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const string = x => typeof x === 'string' && x.length <= 100000;
const id = x => typeof x === 'string' && /^[A-Za-z0-9_-]{1,199}$/.test(x) && !['__proto__','constructor','prototype'].includes(x);
const unique = values => new Set(values).size === values.length;
function checkQuestion(q) {
  assert(q && id(q.id) && ['text', 'answer', 'image', 'answerImage'].every(k => string(q[k])), 'Повреждены поля вопроса или ответа.');
  for (const k of ['image', 'answerImage']) assert(!q[k] || safeUrl(q[k]), 'В резервной копии есть некорректная ссылка на картинку.');
}
function checkModifier(m) { assert(validModifier(m) && id(m.id) && string(m.description), 'В резервной копии повреждён модификатор.'); }
export function validateBackupState(input) {
  let shape=false;
  try { shape=validSavedState(input); } catch { /* Invalid nested objects are reported as a format error. */ }
  assert(shape, 'Файл не содержит полной игры или его структура повреждена.');
  const s = clone(input), g = s.game, b = s.bank;
  assert(b.themes.length <= 2000 && g.rounds.length <= 500 && g.log.length <= 100000, 'Резервная копия превышает допустимый объём.');
  assert(string(g.title) && id(g.roundId || 'empty') && typeof g.started === 'boolean' && typeof g.finished === 'boolean', 'Повреждены настройки или состояние игры.');
  assert(g.teams.every(t => id(t.id) && string(t.name)) && unique(g.teams.map(t => t.id)), 'Повреждены команды.');
  assert(unique(b.themes.map(t => t.id)) && b.themes.every(t => id(t.id) && string(t.name)), 'В банке повреждены темы.');
  const bankQuestions = b.themes.flatMap(t => t.questions).concat(b.cats);
  assert(bankQuestions.length <= 20000 && unique(bankQuestions.map(q => q.id)), 'В банке слишком много вопросов или повторяются их идентификаторы.');
  bankQuestions.forEach(checkQuestion); b.modifiers.forEach(checkModifier);
  assert(unique(b.modifiers.map(m => m.id)), 'Повторяются идентификаторы модификаторов.');
  assert(unique(g.rounds.map(r => r.id)), 'Повторяются раунды.');
  const topicIds = [], cellIds = [];
  for (const r of g.rounds) {
    assert(id(r.id) && string(r.name) && r.topics.length <= 6 && r.prices.every(p => Number.isSafeInteger(p) && Math.abs(p) <= 1000000), 'Повреждены темы или цены раунда.');
    for (const t of r.topics) {
      assert(id(t.id) && string(t.themeId) && string(t.name), 'Повреждена тема раунда.');
      topicIds.push(t.id);
      for (const c of t.cells) {
        assert(id(c.id) && ['cat', 'modifier', 'played'].every(k => typeof c[k] === 'boolean'), 'Повреждена игровая клетка.');
        if (c.question) { checkQuestion(c.question); assert(c.questionId === c.question.id, 'Вопрос не соответствует своей клетке.'); }
        else assert(c.questionId === '', 'Пустая клетка ссылается на отсутствующий вопрос.');
        cellIds.push(c.id);
      }
    }
  }
  assert(unique(topicIds) && unique(cellIds), 'Повторяются идентификаторы тем или клеток.');
  assert(!g.rounds.length ? g.roundId === '' : g.rounds.some(r => r.id === g.roundId), 'Текущий раунд отсутствует в игре.');
  assert([g.catPool, g.modPool, g.usedCats].every(a => a.every(id) && unique(a)), 'Повреждены специальные пулы.');
  if (g.specialBank !== null) {
    assert(g.specialBank && Array.isArray(g.specialBank.cats) && Array.isArray(g.specialBank.modifiers), 'Повреждены зафиксированные пулы игры.');
    g.specialBank.cats.forEach(checkQuestion); g.specialBank.modifiers.forEach(checkModifier);
    assert(unique(g.specialBank.cats.map(q => q.id)) && unique(g.specialBank.modifiers.map(m => m.id)), 'В зафиксированном пуле есть повторы.');
  }
  assert(!g.started || (g.rounds.length > 0 && g.specialBank !== null), 'В начатой игре отсутствуют раунды или пулы.');
  assert(!g.finished || (g.started && !g.active), 'Некорректное завершение игры.');
  const cats = g.specialBank?.cats || b.cats;
  assert(g.usedCats.every(x => cats.some(q => q.id === x)), 'Использованный кот отсутствует в пуле.');
  assert(g.log.every(l => l && id(l.id) && string(l.team) && string(l.reason) && Number.isSafeInteger(l.delta) && Number.isFinite(l.time) && (!l.cellId || cellIds.includes(l.cellId))), 'Повреждена история счёта.');
  if (g.active) {
    const a = g.active;
    assert(g.started && !g.finished && cellIds.includes(a.cellId), 'Открытый вопрос не соответствует игровому полю.');
    const cell = g.rounds.flatMap(r => r.topics.flatMap(t => t.cells)).find(c => c.id === a.cellId);
    assert(!cell.played && string(a.topic) && typeof a.cat === 'boolean' && typeof a.catPriceConfirmed === 'boolean', 'Повреждено состояние открытого вопроса.');
    checkQuestion(a.question);
    if (a.modifier) checkModifier(a.modifier);
    assert(Number.isSafeInteger(a.price) && Math.abs(a.price) <= 1000000 && (a.stage === 'special' || a.price > 0), 'Повреждена стоимость открытого вопроса.');
    const teamIds = g.teams.map(t => t.id);
    assert(['teamId', 'answeringTeamId'].every(k => a[k] === '' || teamIds.includes(a[k])) && a.attempts.every(x => teamIds.includes(x)) && unique(a.attempts), 'Повреждены попытки команд.');
    assert(!a.answeringTeamId || !a.attempts.includes(a.answeringTeamId), 'Отвечающая команда уже использовала попытку.');
    if (a.resolution) assert([true, null].includes(a.resolution.correct) && (a.resolution.correct !== true || (teamIds.includes(a.resolution.teamId) && Number.isSafeInteger(a.resolution.delta) && a.stage === 'answer')), 'Повреждена оценка ответа.');
  }
  validateFinalState(s,checkQuestion);
  return s;
}
export function createBackup(state, now = new Date()) {
  const text = JSON.stringify({ format: BACKUP_FORMAT, backupVersion: BACKUP_VERSION, exportedAt: now.toISOString(), state: validateBackupState(state) }, null, 2);
  assert(new TextEncoder().encode(text).byteLength <= MAX_FILE_SIZE, 'Резервная копия больше 16 МБ. Сократите банк вопросов перед экспортом.');
  return text;
}
export function readBackup(text) {
  assert(typeof text === 'string' && text.length <= MAX_FILE_SIZE, 'JSON-файл слишком большой. Допустимо до 16 МБ.');
  let data;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new Error('Не удалось прочитать JSON. Выберите резервную копию игры.'); }
  if (data?.format) {
    assert(data.format === BACKUP_FORMAT && data.backupVersion === BACKUP_VERSION, 'Это другой формат резервной копии или неподдерживаемая версия.');
    return validateBackupState(data.state);
  }
  return validateBackupState(data);
}
export function backupSummary(state) {
  const g = state.game;
  return { title: g.title, themes: state.bank.themes.length, questions: state.bank.themes.reduce((n,t) => n + t.questions.length, 0), rounds: g.rounds.length,
    cells: g.rounds.reduce((n,r) => n + r.topics.length * 5, 0), played: g.rounds.flatMap(r => r.topics.flatMap(t => t.cells)).filter(c => c.played).length,
    teams: clone(g.teams), cats: state.bank.cats.length, modifiers: state.bank.modifiers.length, active: g.active?.topic || '', started: g.started, finished: g.finished, finalStage:g.final?.run?.stage||'', finalEnabled:!!g.final?.enabled };
}
const fingerprint = q => JSON.stringify([q.text, q.answer, q.image, q.answerImage].map(x => String(x || '').trim().replace(/\r\n/g, '\n')));
export function planQuestionImport(rows, bank) {
  assert(Array.isArray(rows) && rows.length > 1, 'В таблице нет вопросов.');
  assert(rows.length <= 10002, 'За один раз можно импортировать до 10 000 строк.');
  const headers = rows[0].map(norm), positions = EXCEL_HEADERS.map(h => headers.indexOf(norm(h)));
  assert(positions.slice(0,3).every(i => i >= 0), 'Первая строка должна содержать колонки «Тема», «Вопрос» и «Ответ». Используйте шаблон.');
  assert(EXCEL_HEADERS.every(h => headers.filter(x => x === norm(h)).length <= 1), 'В таблице повторяются названия колонок.');
  const errors = [], groups = new Map(); let duplicates = 0, blank = 0;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!row.some(x => String(x ?? '').trim())) { blank++; continue; }
    const [name, text, answer, image, answerImage] = positions.map(p => p < 0 ? '' : String(row[p] ?? '').trim());
    const issues = questionIssues({text, answer, image, answerImage});
    if (!name) issues.unshift('не указана тема');
    if (name.length > 80) issues.unshift('название темы длиннее 80 символов');
    if ([text, answer, image, answerImage].some(x => x.length > 100000)) issues.push('слишком длинное содержимое ячейки');
    if (issues.length) { errors.push(`Строка ${i+1}: ${issues.join('; ')}.`); continue; }
    const key = norm(name), matches = bank.themes.filter(t => norm(t.name) === key);
    if (matches.length > 1) { errors.push(`Строка ${i+1}: в банке несколько тем «${name}». Сначала переименуйте одну из них.`); continue; }
    if (!groups.has(key)) groups.set(key, { name: matches[0]?.name || name, themeId: matches[0]?.id || '', questions: [], seen: new Set((matches[0]?.questions || []).map(fingerprint)) });
    const group = groups.get(key), q = { text, answer, image, answerImage }, mark = fingerprint(q);
    if (group.seen.has(mark)) { duplicates++; continue; }
    group.seen.add(mark); group.questions.push({ ...q, row: i+1 });
  }
  const themes = [...groups.values()].filter(g => g.questions.length).map(({seen,...g}) => g);
  const count = themes.reduce((n,t) => n + t.questions.length, 0);
  return { themes, count, newThemes: themes.filter(t => !t.themeId).length, existingThemes: themes.filter(t => t.themeId).length, duplicates, blank, errors };
}
export function applyQuestionImport(state, plan) {
  assert(plan && !plan.errors.length && plan.count > 0, 'Сначала исправьте ошибки в таблице.');
  // Recheck the preview against the current bank before committing the whole import.
  const rows = [EXCEL_HEADERS, ...plan.themes.flatMap(t => t.questions.map(q => [t.name, q.text, q.answer, q.image, q.answerImage]))];
  const fresh = planQuestionImport(rows, state.bank);
  assert(!fresh.errors.length && fresh.count === plan.count, 'Банк изменился после предпросмотра. Выберите файл заново.');
  for (const group of fresh.themes) {
    let theme = state.bank.themes.find(t => t.id === group.themeId);
    if (!theme) { theme = { id: uid(), name: group.name, questions: [] }; state.bank.themes.push(theme); }
    theme.questions.push(...group.questions.map(({row,...q}) => ({ id: uid(), ...q })));
  }
  return fresh.count;
}
