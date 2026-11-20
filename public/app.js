import * as C from './core.js?v=20261120-media';
import { seedState } from './seed.js?v=20261120-media';
import { UndoHistory } from './undo.js';
import { createBackup, readBackup, backupSummary, planQuestionImport, applyQuestionImport, MAX_FILE_SIZE } from './transfer.js?v=20261120-media';
import { readExcelRows, MAX_EXCEL_SIZE } from './excel.js';
import * as F from './final.js?v=20261120-media';
import { finalSettings, finalBody, podiumBody } from './final-view.js?v=20261120-media';
import { mediaIssues, mediaSource, questionMedia } from './media.js?v=20261120-media';

const app = document.querySelector('#app'), editor = document.querySelector('#editor');
let loaded;
try { loaded = C.loadState(localStorage, seedState); } catch { loaded = { state: seedState(), warning: 'Хранилище браузера недоступно. Изменения останутся только до закрытия страницы.' }; }
let real = loaded.state, rehearsal = null, saveBlocked = !!loaded.warning, conflict = false;
let page = 'home', bankTab = 'themes', themeId = real.bank.themes[0]?.id, roundId = real.game.roundId, search = '', saved = !loaded.warning;
const S = () => rehearsal || real;
const G = () => S().game;
const undoHistory = new UndoHistory();
const captureApp = () => C.clone({ real, rehearsal, page, bankTab, themeId, roundId, search });
function restoreApp(s) { ({ real, rehearsal, page, bankTab, themeId, roundId, search } = s); }
function remember(before, label) {
  undoHistory.record(before, captureApp(), label);
  const button=document.querySelector('[data-act="undo"]');
  if(button){button.disabled=!undoHistory.available||conflict;button.title=undoHistory.available?'Отменить: '+undoHistory.label:'Нет действий для отмены';}
}
function undoLast() {
  if (conflict) return toast('Сначала обновите страницу: игра изменилась в другой вкладке.');
  const previous = undoHistory.undo();
  if (!previous) return;
  restoreApp(previous); persist(); render(); toast('Последнее действие отменено.');
}
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Number(v).toLocaleString('ru-RU');
const ruCount = (n, one, few, many) => `${num(n)} ${n%100>=11&&n%100<=14?many:n%10===1?one:n%10>=2&&n%10<=4?few:many}`;
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${num(Math.abs(n))}`;
const btn = (label, act, attrs = '', cls = '') => `<button type="button" class="${cls}" data-act="${act}" ${attrs}>${label}</button>`;
const icon = name => ({ book: '<path d="M4 4h6a4 4 0 0 1 4 3v14a4 4 0 0 0-4-2H4z"/><path d="M14 7a4 4 0 0 1 4-3h3v15h-3a4 4 0 0 0-4 2"/>', sliders: '<path d="M5 3v18M12 3v18M19 3v18M2 8h6M9 16h6M16 8h6"/>', play: '<path d="m8 4 13 8-13 8z"/>', check: '<path d="m5 12 4 4 10-10"/>', undo: '<path d="m8 4-5 5 5 5M4 9h10a7 7 0 0 1 0 14"/>', star: '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>' }[name] || '');
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">${icon(name)}</svg>`;
const field = (label, name, value = '', attrs = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const textarea = (label, name, value = '') => `<label>${label}<textarea name="${name}" rows="3">${esc(value)}</textarea></label>`;
function mediaField(q, answer = false) {
  const name = answer ? 'answer' : 'question';
  const label = answer ? 'ответа' : 'вопроса';
  const { kind, url } = questionMedia(q, answer);
  return `<div class="editor-media">
    <div class="editor-media-fields">
      <label>Медиа ${label}<select name="${name}MediaKind" data-media-input>
        <option value="image">Картинка</option>
        <option value="video" ${kind === 'video' ? 'selected' : ''}>Видео</option>
      </select></label>
      ${field(`Ссылка для ${label}`, name+'MediaUrl', url, 'type="url" data-media-input placeholder="https://…"')}
      ${btn('Предпросмотр', 'preview-media', `aria-label="Предпросмотр медиа ${label}"`, 'small')}
    </div>
    <div class="editor-media-preview"></div>
  </div>`;
}
const qFields = q => `${textarea('Текст вопроса', 'text', q.text)}${mediaField(q)}
  ${textarea('Правильный ответ', 'answer', q.answer)}${mediaField(q, true)}`;
function qFromForm(form, id) {
  const question = { id, text: form.get('text').trim(), answer: form.get('answer').trim(), image: '', answerImage: '' };
  const questionUrl = form.get('questionMediaUrl').trim();
  const answerUrl = form.get('answerMediaUrl').trim();
  if (form.get('questionMediaKind') === 'video') question.video = questionUrl;
  else question.image = questionUrl;
  if (form.get('answerMediaKind') === 'video') question.answerVideo = answerUrl;
  else question.answerImage = answerUrl;
  const issues = mediaIssues(question);
  if (issues.length) throw new Error(issues.join('. '));
  return question;
}
const questionLabel = q => q?.video ? 'Вопрос с видео' : q?.image ? 'Вопрос с картинкой' : 'Вопрос без текста';
function toast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('visible'), 4500);
}
const confirmBox = document.querySelector('#confirm-box');
let confirmResolve;
confirmBox.addEventListener('close', () => { confirmResolve?.(confirmBox.returnValue === 'yes'); confirmResolve = null; });
function confirmAction(message) {
  confirmBox.innerHTML = `<form method="dialog"><div class="modal-heading"><h2 id="confirm-title">Подтверждение</h2></div><div class="modal-body"><p>${esc(message)}</p></div><div class="modal-actions"><button value="no" autofocus>Отмена</button><button class="primary" value="yes">${message.startsWith('Сбросить')?'Сбросить':message.startsWith('Удалить')?'Удалить':'Подтвердить'}</button></div></form>`;
  confirmBox.returnValue = 'no'; confirmBox.showModal();
  return new Promise(resolve => { confirmResolve = resolve; });
}
function persist() {
  if (rehearsal || saveBlocked || conflict) return;
  try { saved = C.saveState(localStorage, real); } catch { saved = false; }
  if (!saved) toast('Не удалось сохранить данные. Проверьте свободное место и доступ к хранилищу.');
  const indicator = document.querySelector('#save-status');
  if (indicator) indicator.textContent = saved ? 'Сохранено в браузере' : 'Не сохранено';
}
function mutate(fn, rerender = true, label = 'Изменение игры') {
  if (conflict && !rehearsal) return toast('Игра изменена в другой вкладке. Обновите эту страницу перед продолжением.');
  const snapshot = captureApp();
  try { fn(S()); remember(snapshot, label); persist(); if (rerender) render(); return true; }
  catch (e) { restoreApp(snapshot); if(rerender)render(); toast(e.message); return false; }
}
function backupPanel() {
  return `<section class="panel backup-panel"><div><h2>Резервная копия игры</h2><p class="muted">Перенесите банк, настройки, счёт и текущий прогресс на другой браузер или устройство.</p></div><div class="actions">${btn('Экспорт JSON','export-json')}${btn('Импорт JSON','import-json')}</div></section>`;
}
function header(title, subtitle = '', playing = false) {
  return `<header class="topbar"><a href="#" class="brand" data-act="home" aria-label="Главное меню"><span class="brand-monster" aria-hidden="true"><img src="./assets/favicon.svg" alt=""></span><span class="brand-name">Корпорация<strong>Пирожкова</strong></span></a><div class="header-end">${rehearsal ? '<span class="badge rehearsal-badge">Репетиция</span>' : `<span id="save-status" class="save-status">${saved ? 'Сохранено в браузере' : 'Не сохранено'}</span>`}${btn(svg('undo'),'undo',`aria-label="Отменить последнее действие" title="${esc(undoHistory.available?'Отменить: '+undoHistory.label:'Нет действий для отмены')}" ${!undoHistory.available||conflict?'disabled':''}`,'undo-button quiet')}${btn('На весь экран', 'fullscreen', '', 'quiet')}${playing ? btn(rehearsal ? 'Выйти из репетиции' : 'Меню', 'home', '', 'quiet') : page !== 'home' ? btn('Главное меню', 'home', '', 'quiet') : ''}</div></header>${title ? `<div class="page-heading"><div><p class="eyebrow">СВОЯ ИГРА · КОРПОРАЦИЯ ПИРОЖКОВА</p><h1>${title}</h1>${subtitle ? `<p class="muted">${subtitle}</p>` : ''}</div></div>` : ''}`;
}
function warnings() {
  return `${saveBlocked ? `<div class="warning storage-warning">${esc(loaded.warning)} ${btn('Разрешить новое сохранение', 'allow-save', '', 'small')}</div>` : ''}${conflict ? '<div class="warning">Игра изменилась в другой вкладке. Обновите страницу, чтобы загрузить последнее состояние.</div>' : ''}`;
}
function home() {
  const g = G(), cells = g.rounds.flatMap(r => r.topics.flatMap(t => t.cells)), errors = C.readiness(S());
  return `${header('')}<main class="home-shell"><section class="hero"><div class="hero-copy"><p class="eyebrow">КОМАНДНЫЙ ВЕЧЕР</p><h1>Своя игра<span class="hero-dot">.</span><br><span class="serif">Свои люди.</span></h1><p class="hero-description">Хорошие вопросы объединяют.<br>Соберите команды — остальное уже здесь.</p><div class="hero-actions">${btn(g.finished ? 'Посмотреть результаты' : g.started ? 'Продолжить игру' : 'К игровому полю', 'play', '', 'primary light')}${btn('Репетиция', 'rehearse', '', 'on-dark')}</div><div class="hero-caption">Один экран. До трёх команд. Общий азарт.</div></div><div class="hero-art" aria-hidden="true"><div class="art-label">ВЕЧЕР НАЧИНАЕТСЯ С ВОПРОСА</div><div class="art-grid">${[100,200,300,400,500,'?'].map((v,i) => `<div class="art-tile tile-${i}">${v}</div>`).join('')}</div><div class="art-footer"><span>ПИРОЖКОВА</span><span>ВМЕСТЕ ИНТЕРЕСНЕЕ</span></div></div></section><section class="menu-grid" aria-label="Главное меню"><button class="menu-card" data-act="bank"><span class="card-icon">${svg('book')}</span><span class="card-title">Банк вопросов</span><span class="muted">Темы, ответы и неожиданные повороты</span><span class="card-meta">${S().bank.themes.length} тем · ${S().bank.themes.reduce((n,t)=>n+t.questions.length,0)} вопросов</span></button><button class="menu-card" data-act="setup"><span class="card-icon">${svg('sliders')}</span><span class="card-title">Настройка игры</span><span class="muted">Команды, раунды и специальные клетки</span><span class="card-meta">${ruCount(g.rounds.length,'раунд','раунда','раундов')} · ${ruCount(g.teams.length,'команда','команды','команд')}</span></button><button class="menu-card accent-card" data-act="play"><span class="card-icon">${svg('play')}</span><span class="card-title">${g.finished ? 'Результаты' : g.started ? 'Продолжить игру' : 'Начать игру'}</span><span class="muted">Большой экран для большого вечера</span><span class="card-meta">${g.started ? `${cells.filter(c=>c.played).length} из ${cells.length} вопросов сыграно` : errors.length ? 'Нужна подготовка' : 'Всё готово к старту'}</span></button></section><section class="home-bottom"><div><span class="badge ${errors.length ? 'amber' : 'success'}">${errors.length ? 'Проверьте настройки' : 'Можно играть'}</span><p>${g.started ? 'Текущая игра сохранена. Можно продолжить с того же места.' : 'Загружен демонстрационный набор. Замените вопросы своими или попробуйте репетицию.'}</p></div><span class="local-note">Данные хранятся в этом браузере<br>на этом устройстве</span></section>${backupPanel()}</main>`;
}
function bank() {
  const b = S().bank;
  let body = '';
  if (bankTab === 'themes') {
    const theme = b.themes.find(t=>t.id===themeId) || b.themes[0]; themeId = theme?.id;
    const qs = (theme?.questions || []).filter(q=>`${q.text} ${q.answer}`.toLowerCase().includes(search.toLowerCase()));
    body = `<div class="bank-layout"><aside class="panel theme-list"><div class="section-top"><h2>Темы</h2>${btn('+', 'add-theme', 'aria-label="Добавить тему"', 'small')}</div>${b.themes.map(t=>`<button class="theme-item ${t.id===themeId?'selected':''}" data-act="choose-theme" data-id="${t.id}"><span>${esc(t.name)}</span><span>${t.questions.length}</span></button>`).join('') || '<p class="muted">Создайте первую тему.</p>'}</aside><section class="panel"><div class="section-top"><div><h2>${esc(theme?.name || 'Вопросы')}</h2><p class="muted">Банк и подготовленная игра хранят отдельные копии вопросов.</p></div><div class="actions">${theme ? btn('Изменить тему','rename-theme',`data-id="${theme.id}"`,'quiet small')+btn('Удалить тему','delete-theme',`data-id="${theme.id}"`,'danger quiet small')+btn('+ Вопрос','edit-question',`data-theme="${theme.id}"`,'primary') : ''}</div></div><label class="search-label">Поиск<input id="question-search" placeholder="Найти вопрос или ответ" value="${esc(search)}"></label><div class="question-list">${qs.map((q,i)=>`<article class="question-row"><span class="question-number">${i+1}</span><div><h3>${esc(q.text || questionLabel(q))}</h3><p class="muted">${esc(q.answer || (q.answerVideo ? 'Ответ с видео' : 'Ответ с картинкой'))}${q.video || q.answerVideo ? ' · Есть видео' : q.image || q.answerImage ? ' · Есть изображение' : ''}</p></div><div class="actions">${btn('Изменить','edit-question',`data-id="${q.id}" data-theme="${theme.id}"`,'small')}${btn('Удалить','delete-question',`data-id="${q.id}" data-theme="${theme.id}"`,'quiet danger small')}</div></article>`).join('') || '<div class="empty">Вопросов пока нет. Добавьте текст, картинку или оба варианта.</div>'}</div></section></div>`;
  } else if (bankTab === 'cats') {
    body = `<div class="section-top"><p class="muted">«Кот» заменяет обычный вопрос. В игре каждый выпадает только один раз.</p>${btn('+ Кот в мешке','edit-cat','','primary')}</div><div class="content-grid">${b.cats.map(q=>`<article class="panel special-card"><span class="badge">Кот в мешке</span><h3>${esc(q.text || questionLabel(q))}</h3><p class="muted">${esc(q.answer || (q.answerVideo ? 'Ответ с видео' : 'Ответ с картинкой'))}</p><div class="actions">${btn('Изменить','edit-cat',`data-id="${q.id}"`)}${btn('Удалить','delete-cat',`data-id="${q.id}"`,'quiet danger')}</div></article>`).join('') || '<div class="empty">Добавьте специальные вопросы в банк.</div>'}</div>`;
  } else {
    body = `<div class="section-top"><p class="muted">Множитель меняет выигрыш и списание. Фиксированный эффект прибавляет заданное число при выбранном условии.</p>${btn('+ Модификатор','edit-mod','','primary')}</div><div class="content-grid">${b.modifiers.map(m=>`<article class="panel special-card"><span class="effect-value">${m.type==='multiply'?'×'+num(m.value):signed(m.value)}</span><h3>${esc(m.name)}</h3><p class="muted">${esc(m.description)}</p><p>${m.type==='multiply'?'Каждое начисление и списание':m.on==='win'?'При начислении':m.on==='loss'?'При списании':'При каждой операции'}</p><div class="actions">${btn('Изменить','edit-mod',`data-id="${m.id}"`)}${btn('Удалить','delete-mod',`data-id="${m.id}"`,'quiet danger')}</div></article>`).join('') || '<div class="empty">Создайте первый эффект.</div>'}</div>`;
  }
  return `${header('Банк вопросов','Всё для вечера, который запомнится.')}<main class="page-shell"><section class="panel import-panel"><div><h2>Вопросы из Excel</h2><p class="muted">Одна строка — один вопрос. Файл добавляет темы и вопросы только в банк.</p></div><div class="actions"><a class="button-link" href="./templates/questions-template.xlsx" download="Шаблон вопросов.xlsx">Скачать шаблон Excel</a>${btn('Импорт Excel','import-excel','','primary')}</div></section><div class="tabs" role="group" aria-label="Разделы банка">${[['themes','Темы и вопросы'],['cats','Коты в мешке'],['mods','Модификаторы']].map(([id,label])=>btn(label,'bank-tab',`data-id="${id}" aria-pressed="${bankTab===id}"`,bankTab===id?'selected':'')).join('')}</div>${body}</main>`;
}
function setup() {
  const g = G(), b = S().bank, errors = C.readiness(S());
  const r = g.rounds.find(r=>r.id===roundId) || g.rounds[0]; roundId = r?.id;
  return `${header('Настройка игры','Подготовьте поле — и собирайте команды.')}<main class="page-shell setup-shell"><div class="setup-main"><section class="panel"><div class="section-top"><h2>Игра и команды</h2><span class="badge">${g.started?'Игра начата':'Подготовка'}</span></div><div class="form-grid">${field('Название вечера','game-title',g.title,'data-setting="title" maxlength="100"')}<label>Количество команд<select data-setting="team-count" ${g.started?'disabled':''}>${[1,2,3].map(n=>`<option ${n===g.teams.length?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="team-inputs">${g.teams.map((t,i)=>field(`Команда ${i+1}`,'team-name',t.name,`data-setting="team-name" data-id="${t.id}" maxlength="60"`)).join('')}</div></section><section class="panel"><div class="section-top"><div><h2>Раунды</h2><p class="muted">До 6 тем, по 5 вопросов. Цены общие для раунда.</p></div>${btn('+ Раунд','add-round',g.started?'disabled':'','small')}</div><div class="round-tabs">${g.rounds.map(r=>btn(esc(r.name),'setup-round',`data-id="${r.id}"`,roundId===r.id?'selected':'')).join('')}</div>${r?`<div class="section-top round-settings">${field('Название раунда','round-name',r.name,`data-setting="round-name" data-id="${r.id}" maxlength="80" ${g.started?'disabled':''}`)}${btn('Удалить раунд','delete-round',`data-id="${r.id}" ${g.started?'disabled':''}`,'quiet danger small')}</div><div class="prices">${r.prices.map((p,i)=>field(`Цена ${i+1}`,'price',p,`type="number" min="1" max="1000000" step="1" data-setting="price" data-id="${r.id}" data-index="${i}" ${g.started?'disabled':''}`)).join('')}</div><div class="topic-editor">${r.topics.map((t,ti)=>`<details class="topic-details" ${ti===0?'open':''}><summary><span>${esc(t.name)}</span><span class="muted">${t.cells.filter(c=>c.cat||!C.questionIssues(c.question).length).length} / 5 заполнено</span></summary><div class="topic-tools">${field('Название на поле','topic-name',t.name,`data-setting="topic-name" data-id="${t.id}" data-round="${r.id}" ${g.started?'disabled':''}`)}${btn('Убрать тему','delete-topic',`data-id="${t.id}" data-round="${r.id}" ${g.started?'disabled':''}`,'quiet danger small')}</div><div class="cell-editor-grid">${t.cells.map((c,i)=>`<button class="edit-cell ${c.played?'played':''}" data-act="edit-cell" data-id="${c.id}" ${c.played||g.active?.cellId===c.id||g.finished?'disabled':''}><span class="cell-price">${num(r.prices[i])}</span><span class="cell-question">${c.cat?'Кот в мешке':esc(c.question?.text || (c.question ? questionLabel(c.question) : 'Назначить вопрос'))}</span><span class="cell-flags">${c.played?'Сыгран':`${c.cat?'КОТ ':''}${c.modifier?'ЭФФЕКТ ':''}${!c.cat&&C.questionIssues(c.question).length?'НЕ ЗАПОЛНЕН':''}`}</span></button>`).join('')}</div></details>`).join('')}</div><div class="add-topic"><label>Тема из банка<select id="theme-to-add" ${g.started||r.topics.length>=6?'disabled':''}><option value="">Выберите тему</option>${b.themes.map(t=>`<option value="${t.id}" ${r.topics.some(x=>x.themeId===t.id)?'disabled':''}>${esc(t.name)}</option>`).join('')}</select></label>${btn('Добавить тему','add-topic',`${g.started||r.topics.length>=6?'disabled':''}`)}</div>`:'<p class="empty">Добавьте первый раунд.</p>'}</section><section class="panel"><h2>Пулы на всю игру</h2><p class="muted">${g.started?'Пулы зафиксированы при старте. Изменения банка войдут в следующую игру.':'Выберите, что может случайно выпасть в специальных клетках. Модификаторы могут повторяться.'}</p><div class="form-grid"><div><h3>Коты в мешке</h3>${b.cats.map(q=>`<label class="check-row"><input type="checkbox" data-setting="cat-pool" value="${q.id}" ${g.catPool.includes(q.id)?'checked':''} ${g.started?'disabled':''}><span>${esc(q.text || questionLabel(q))}</span></label>`).join('') || '<p class="muted">Добавьте котов в банке.</p>'}</div><div><h3>Модификаторы</h3>${b.modifiers.map(m=>`<label class="check-row"><input type="checkbox" data-setting="mod-pool" value="${m.id}" ${g.modPool.includes(m.id)?'checked':''} ${g.started?'disabled':''}><span>${esc(m.name)}</span></label>`).join('') || '<p class="muted">Создайте модификатор в банке.</p>'}</div></div></section>${finalSettings(S(),viewTools())}</div><aside class="setup-aside"><section class="panel readiness"><div class="readiness-symbol ${errors.length?'amber':''}">${svg(errors.length?'sliders':'check')}</div><h2>${errors.length?'Ещё немного подготовки':'Всё готово'}</h2><p class="muted">${errors.length?`Нужно исправить: ${errors.length}`:'Вопросы назначены, команды ждут.'}</p>${errors.length?`<ul class="error-list">${errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`:'<p class="ready-line">Можно начинать вечер</p>'}<div class="stack">${btn(g.started?'Продолжить игру':'Начать игру','play',errors.length&&!g.started?'disabled':'','primary')}${btn('Репетиция','rehearse')}<p class="tiny muted">Репетиция доступна даже для неполной игры. Настоящий прогресс не изменится.</p></div></section>${backupPanel()}<section class="panel reset-panel"><h3>Начать заново</h3><p class="muted">Сбросить счёт и прогресс, сохранив поле и банк вопросов.</p>${btn('Сбросить прогресс','reset','','quiet danger')}${btn('Новая пустая игра','new-game','','quiet danger')}</section></aside></main>`;
}
const viewTools = () => ({esc,btn,num,signed,svg,questionContent,questionLabel});
function scoreBoard() {
  const g = G(), a = g.active, fr=g.final?.run, finalTeam=fr?.stage==='review'?fr.order[fr.index]:'';
  return `<footer class="scoreboard" aria-label="Табло команд">${g.teams.map((t,i)=>`<div class="score-team team-${i} ${(a?.answeringTeamId===t.id||finalTeam===t.id)?'answering':''}">${finalTeam===t.id?`<div class="answer-verdict" aria-label="Оценка финального ответа ${esc(t.name)}"><span>Финал · ставка ${num(fr.bets[t.id])}</span>${btn(`Правильно · ${signed(fr.bets[t.id])}`,'final-judge',`data-id="${t.id}" data-correct="true"`,'verdict-correct')}${btn(`Неправильно · ${signed(-fr.bets[t.id])}`,'final-judge',`data-id="${t.id}" data-correct="false"`,'verdict-wrong')}</div>`:''}${a?.stage==='question'&&a.answeringTeamId===t.id?`<div class="answer-verdict" aria-label="Оценка ответа ${esc(t.name)}"><span>Отвечает ${esc(t.name)}</span>${btn(`Правильно · ${signed(C.scoreDelta(a.price,a.modifier,1))}`,'judge',`data-id="${t.id}" data-correct="true"`,'verdict-correct')}${btn(`Неправильно · ${signed(C.scoreDelta(a.price,a.modifier,-1))}`,'judge',`data-id="${t.id}" data-correct="false"`,'verdict-wrong')}</div>`:''}<button class="score-main" data-act="manual-score" data-id="${t.id}" aria-label="Изменить счёт ${esc(t.name)}"><span class="team-name">${esc(t.name)}</span><strong>${signed(t.score)}</strong></button></div>`).join('')}</footer>`;
}
function mediaFigure(source, kind, label) {
  const src = `data-media-src="${esc(source.src)}"`;
  const name = esc(label);
  const link = `<a class="media-link" href="${esc(source.link)}" target="_blank" rel="noopener noreferrer">Открыть отдельно</a>`;
  if (source.kind === 'drive') {
    return `<figure class="media media-player"><iframe ${src} title="${name}" allow="fullscreen" allowfullscreen></iframe>${link}</figure>`;
  }
  const player = kind === 'video'
    ? `<video ${src} aria-label="${name}" controls playsinline preload="metadata"></video>`
    : `<img ${src} alt="${name}" referrerpolicy="no-referrer">`;
  return `<figure class="media ${kind === 'video' ? 'media-player' : ''}">${player}
    <figcaption hidden>${kind === 'video' ? 'Видео недоступно.' : 'Картинка недоступна.'} Проверьте ссылку. ${link}</figcaption>
  </figure>`;
}
function questionContent(question, answer, screenId) {
  const title = answer ? 'Правильный ответ' : 'Вопрос';
  const text = (answer ? question.answer : question.text) || '';
  const { url, kind } = questionMedia(question, answer);
  const source = mediaSource(url, kind);
  const key = source ? JSON.stringify([screenId, answer, text, kind, source.src]) : '';
  const figure = source ? mediaFigure(source, kind, title)
    : url ? '<figure class="media"><figcaption>Ссылка недоступна. Проверьте её в редакторе.</figcaption></figure>' : '';
  return `<div class="question-content ${url ? 'with-image' : ''} ${text ? '' : 'media-only'}" data-media-key="${esc(key)}">
    <h1 class="${text ? '' : 'sr-only'}">${esc(text || title)}</h1>${figure}
  </div>`;
}
function mountMedia(root) {
  for (const element of root.querySelectorAll('[data-media-src]:not([src])')) {
    element.src = element.dataset.mediaSrc;
  }
}
function showMediaError(event) {
  const media = event.target;
  if (!media.matches?.('.media img, .media video')) return;
  media.hidden = true;
  media.nextElementSibling.hidden = false;
}
app.addEventListener('error', showMediaError, true);
editor.addEventListener('error', showMediaError, true);

function previewMedia(button) {
  const fieldset = button.closest('.editor-media');
  const kind = fieldset.querySelector('select').value;
  const url = fieldset.querySelector('input').value.trim();
  const preview = fieldset.querySelector('.editor-media-preview');
  const otherPreview = [...editor.querySelectorAll('.editor-media-preview')].find(element => element !== preview);
  otherPreview?.replaceChildren();
  const source = mediaSource(url, kind);
  preview.innerHTML = source ? mediaFigure(source, kind, button.getAttribute('aria-label'))
    : '<p class="form-error" role="status">Вставьте прямую ссылку на файл или ссылку Google Диска.</p>';
  mountMedia(preview);
}
function game() {
  const g = G(), a = g.active, r = g.rounds.find(r=>r.id===g.roundId) || g.rounds[0];
  let body;
  if (g.finished) {
    body=podiumBody(g,viewTools());
  } else if(g.final?.run){
    body=finalBody(g,viewTools());
  } else if (a?.stage === 'special') {
    body = `<section class="special-stage"><div class="special-orbit" aria-hidden="true">${a.cat?'?':'×'}</div><p class="eyebrow">НЕОЖИДАННЫЙ ПОВОРОТ</p><h1>${a.cat?'Кот в мешке':'Особый вопрос'}</h1>${a.modifier?`<div class="special-effect"><span>${a.modifier.type==='multiply'?'×'+num(a.modifier.value):signed(a.modifier.value)}</span><div><h2>${esc(a.modifier.name)}</h2><p>${esc(a.modifier.description)}</p><p class="tiny">${a.modifier.type==='multiply'?'Множитель применяется к каждому начислению и списанию.':`Фиксированная прибавка ${signed(a.modifier.value)} ${a.modifier.on==='win'?'при начислении':a.modifier.on==='loss'?'при списании':'при каждой операции'}.`}</p></div></div>`:''}${a.cat?`<div class="cat-controls">${field('Стоимость вопроса','cat-price',a.price,'id="cat-price" type="number" min="1" max="1000000" step="1"')}<label>Кто отвечает первым<select id="cat-team"><option value="">Выберите команду</option>${g.teams.map(t=>`<option value="${t.id}" ${a.teamId===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label></div>`:''}<div class="actions">${btn('Открыть вопрос','confirm-special','','primary light')}${btn('Закрыть без баллов','close-question','','on-dark')}</div></section>`;
  } else if (a) {
    const answer = a.stage === 'answer', q = a.question;
    body = `<section class="question-stage">
      <div class="question-meta"><span>${esc(a.topic)}</span><span class="price-pill">${num(a.price)} баллов${a.modifier?' · '+esc(a.modifier.name):''}</span></div>
      <p class="eyebrow">${answer?'ПРАВИЛЬНЫЙ ОТВЕТ':'ВОПРОС'}</p>
      ${questionContent(q, answer, a.cellId)}
      ${!answer?`<div class="answering-controls"><span class="muted-light">${a.attempts.length===g.teams.length?'Все команды ответили неверно':a.attempts.length?'Кто перехватывает?':'Кто отвечает?'}</span>${g.teams.map(t=>btn(esc(t.name),'answering',`data-id="${t.id}" ${a.attempts.includes(t.id)||(a.cat&&!a.attempts.length&&a.teamId!==t.id)?'disabled':''}`,a.answeringTeamId===t.id?'selected':'on-dark')).join('')}</div><p class="tiny muted-light">${a.answeringTeamId?'Оцените ответ кнопками над табло выбранной команды.':'Выберите команду или покажите ответ без дополнительного начисления.'}</p>`:`<p class="muted-light">${a.resolution?.correct===true?`${esc(g.teams.find(t=>t.id===a.resolution.teamId)?.name)}: ${signed(a.resolution.delta)}. Баллы уже начислены.`:'Ответ раскрыт без дополнительных начислений. Предыдущие штрафы сохранены.'}</p>`}
      <div class="question-actions">${answer?btn('Завершить вопрос','close-question','','primary light'):btn('Показать ответ','reveal','','primary light')}${!answer?btn('Закрыть без ответа','close-question','','on-dark'):''}${a.attempts.length?`<span class="tiny muted-light">Уже отвечали: ${a.attempts.map(id=>esc(g.teams.find(t=>t.id===id)?.name)).join(', ')}</span>`:''}</div>
    </section>`;
  } else {
    const left = r?.topics.reduce((n,t)=>n+t.cells.filter(c=>!c.played).length,0) || 0;
    body = `<section class="board-stage"><div class="board-heading"><div><p class="eyebrow">${esc(g.title)}</p><h1>${esc(r?.name || 'Репетиция')}</h1></div><div class="actions"><span class="muted-light">${left} вопросов осталось</span><label class="sr-only" for="game-round">Текущий раунд</label><select id="game-round">${g.rounds.map(r=>`<option value="${r.id}" ${r.id===g.roundId?'selected':''}>${esc(r.name)}</option>`).join('')}</select>${btn('История','history','','on-dark')}${btn(g.final?.enabled?'Перейти к финалу':'Завершить игру','finish','','on-dark')}</div></div>${r?.topics.length?`<div class="board-scroll"><div class="board" style="--topics:${r.topics.length}">${r.topics.map(t=>`<div class="board-row"><h2 class="board-topic" title="${esc(t.name)}">${esc(t.name)}</h2>${t.cells.map((c,i)=>`<button class="board-cell ${c.played?'played':''}" data-act="open-cell" data-id="${c.id}" ${c.played?'disabled':''} aria-label="${esc(t.name)}, ${r.prices[i]}${c.played?', сыгран':''}">${c.played?'<span aria-hidden="true">·</span>':num(r.prices[i])}</button>`).join('')}</div>`).join('')}</div></div>${!left?'<p class="round-complete">Раунд сыгран. Выберите другой или завершите игру.</p>':''}`:'<div class="empty">В этом раунде пока нет тем. Вернитесь в настройки и добавьте их.</div>'}</section>`;
  }
  return `${header('', '', true)}<main class="game-shell">${body}</main>${scoreBoard()}`;
}
let lastScreen = '';
function replaceSiblings(anchor, replacement) {
  const before = [], after = [];
  for (let node = replacement.previousSibling; node; node = node.previousSibling) before.unshift(node);
  for (let node = replacement.nextSibling; node; node = node.nextSibling) after.push(node);
  for (const node of [...anchor.parentNode.childNodes]) {
    if (node !== anchor) node.remove();
  }
  anchor.before(...before);
  anchor.after(...after);
}
function renderApp(html) {
  const template = document.createElement('template');
  template.innerHTML = html;
  const previous = app.querySelector('.question-content[data-media-key]');
  const next = template.content.querySelector('.question-content[data-media-key]');
  if (previous?.dataset.mediaKey && previous.dataset.mediaKey === next?.dataset.mediaKey) {
    // Keep the player and its ancestors attached while replacing the stage controls and scoreboard.
    replaceSiblings(previous.closest('.game-shell'), next.closest('.game-shell'));
    replaceSiblings(previous, next);
  } else {
    for (const video of app.querySelectorAll('.media video')) video.pause();
    app.replaceChildren(template.content);
  }
  mountMedia(app);
}
function render() {
  const screen = `${page}:${G().active?.cellId||''}:${G().active?.stage||''}:${G().finished}:${G().final?.run?.stage||''}:${G().final?.run?.index||0}`;
  document.body.classList.toggle('is-game', page==='game');
  document.body.classList.toggle('is-rehearsal', !!rehearsal);
  document.body.classList.toggle('has-verdict', (G().active?.stage==='question'&&!!G().active.answeringTeamId)||G().final?.run?.stage==='review');
  if(screen!==lastScreen) { window.scrollTo(0,0); lastScreen=screen; }
  renderApp(warnings() + (page==='home'?home():page==='bank'?bank():page==='setup'?setup():game()));
}
let modalHandler = null, restoreFocus;
function modal(title, content, handler, submit = 'Сохранить') {
  restoreFocus = document.activeElement;
  editor.innerHTML = `<form id="modal-form"><div class="modal-heading"><h2>${esc(title)}</h2>${btn('×','close-modal','aria-label="Закрыть"','quiet modal-close')}</div><div class="modal-body">${content}</div><p class="form-error" role="alert"></p><div class="modal-actions">${btn('Отмена','close-modal')}<button class="primary" type="submit">${submit}</button></div></form>`;
  modalHandler = handler; editor.showModal();
}
editor.addEventListener('close',()=>{
  modalHandler=null;
  for (const preview of editor.querySelectorAll('.editor-media-preview')) preview.replaceChildren();
  restoreFocus?.focus();
});
editor.addEventListener('input', e => {
  if (e.target.matches('[data-media-input]')) {
    e.target.closest('.editor-media').querySelector('.editor-media-preview').replaceChildren();
  }
});
editor.addEventListener('submit', e=>{
  e.preventDefault();
  if (conflict&&!rehearsal) { editor.querySelector('.form-error').textContent='Обновите страницу: данные изменились в другой вкладке.'; return; }
  const snapshot=captureApp();
  try { modalHandler(new FormData(e.target)); remember(snapshot,editor.querySelector('h2').textContent); persist(); editor.close(); render(); }
  catch (err) { restoreApp(snapshot); editor.querySelector('.form-error').textContent=err.message; }
});
function questionModal(kind, id, tid) {
  const list = kind==='cat'?S().bank.cats:S().bank.themes.find(t=>t.id===tid).questions;
  const q = list.find(q=>q.id===id) || C.blankQuestion();
  modal(kind==='cat'?'Кот в мешке':'Редактор вопроса',qFields(q)+`<p class="tiny muted">Для каждой стороны можно использовать текст, картинку или видео. Подходят прямые ссылки на файлы и ссылки Google Диска с доступом по ссылке.</p>`,f=>{
    const updated=qFromForm(f,q.id);
    const target=kind==='cat'?S().bank.cats:S().bank.themes.find(t=>t.id===tid).questions;
    const index=target.findIndex(x=>x.id===id); if(index<0)target.push(updated);else target[index]=updated;
  });
}
function cellModal(id) {
  const g=G(), { cell:c, round:r, topic:t,index }=C.editableCell(g,id);
  const used=new Set([...g.rounds.flatMap(r=>r.topics.flatMap(t=>t.cells.filter(c=>c.id!==id&&!c.cat).map(c=>c.questionId))),...(g.final?.enabled?g.final.topics.map(t=>t.questionId):[])]);
  const q=c.question||C.blankQuestion();
  modal(`${t.name} · ${num(r.prices[index])}`,`<label>Вопрос из банка<select name="questionId" id="cell-question"><option value="">Собственный вопрос для этой клетки</option>${S().bank.themes.map(t=>`<optgroup label="${esc(t.name)}">${t.questions.map(q=>`<option value="${q.id}" ${q.id===c.questionId?'selected':''} ${used.has(q.id)?'disabled':''}>${esc(q.text.slice(0,85)||questionLabel(q))}${used.has(q.id)?' (уже назначен)':''}</option>`).join('')}</optgroup>`).join('')}</select></label><div class="cell-special-flags"><label class="check-row"><input name="cat" type="checkbox" ${c.cat?'checked':''}><span>Кот в мешке</span></label><label class="check-row"><input name="modifier" type="checkbox" ${c.modifier?'checked':''}><span>Модификатор</span></label></div><p class="tiny muted">Кот заменяет вопрос ниже случайным из пула. Обе механики можно совместить. На игровом поле они скрыты до открытия.</p><div id="cell-fields">${qFields(q)}</div>`,f=>{
    const found=C.editableCell(G(),id), cat=f.has('cat');
    let qid=f.get('questionId') || (c.questionId?.startsWith('local-')?c.questionId:'local-'+C.uid());
    const updated=qFromForm(f,qid);
    found.cell.cat=cat;
    if(!cat)C.assignQuestion(G(),id,updated);else {found.cell.question=updated;found.cell.questionId=qid;}
    found.cell.modifier=f.has('modifier');
  });
}
function exportJson() {
  if (rehearsal) return toast('Выйдите из репетиции, чтобы сохранить настоящую игру.');
  const now = new Date(), stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const title = real.game.title.replace(/[^\p{L}\p{N} _-]/gu,'').trim().slice(0,50) || 'Игра';
  const blob = new Blob([createBackup(real, now)], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href=url; a.download=`${title} ${stamp}.json`; document.body.append(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  toast('Резервная копия сохранена в JSON. В ней есть банк и текущий прогресс.');
}
function jsonPreview(imported, filename) {
  const summary = backupSummary(imported);
  modal('Восстановить резервную копию',`<p class="muted">${esc(filename)}</p><h3>${esc(summary.title || 'Игра без названия')}</h3><dl class="import-summary"><div><dt>Банк вопросов</dt><dd>${num(summary.themes)} тем · ${num(summary.questions)} вопросов</dd></div><div><dt>Игровое поле</dt><dd>${ruCount(summary.rounds,'раунд','раунда','раундов')} · ${num(summary.cells)} клеток</dd></div><div><dt>Прогресс</dt><dd>${summary.finished?'Игра завершена':summary.started?'Игра начата':'Подготовка'} · сыграно ${num(summary.played)} клеток</dd></div><div><dt>Спецэлементы</dt><dd>${ruCount(summary.cats,'кот','кота','котов')} · ${ruCount(summary.modifiers,'модификатор','модификатора','модификаторов')}</dd></div><div><dt>Финал</dt><dd>${summary.finalStage?esc({veto:'Исключение тем',bets:'Ставки',question:'Ответы команд',review:'Оценка ответов',complete:'Завершён'}[summary.finalStage]):summary.finalEnabled?'Подготовлен':'Выключен'}</dd></div></dl><div class="backup-teams">${summary.teams.map(t=>`<span>${esc(t.name)}: <strong>${signed(t.score)}</strong></span>`).join('')}</div>${summary.active?`<p>Открытый вопрос: ${esc(summary.active)}. Он восстановится на том же этапе.</p>`:''}<p class="warning inline-warning">Текущая игра и весь банк будут заменены. Это действие можно отменить кнопкой Undo в этой вкладке.</p>`,()=>{
    real=C.clone(imported); rehearsal=null; page=real.game.started?'game':'setup';
    themeId=real.bank.themes[0]?.id;roundId=real.game.roundId;search='';
    saveBlocked=false;loaded.warning='';
  },'Восстановить игру');
}
function excelPreview(plan, filename) {
  modal('Импорт вопросов из Excel',`<p class="muted">${esc(filename)}</p><dl class="import-summary"><div><dt>Новых вопросов</dt><dd>${num(plan.count)}</dd></div><div><dt>Темы</dt><dd>${num(plan.newThemes)} новых · ${num(plan.existingThemes)} существующих</dd></div><div><dt>Повторы</dt><dd>${num(plan.duplicates)} — будут пропущены</dd></div></dl>${plan.errors.length?`<div class="import-errors"><h3>Исправьте ошибки: ${num(plan.errors.length)}</h3><ul>${plan.errors.slice(0,100).map(e=>`<li>${esc(e)}</li>`).join('')}</ul>${plan.errors.length>100?'<p>Показаны первые 100 ошибок.</p>':''}</div>`:''}${!plan.count&&!plan.errors.length?'<p class="warning inline-warning">Новых вопросов нет: таблица пуста или все строки уже есть в банке.</p>':''}<div class="import-preview">${plan.themes.map(t=>`<section><h3>${esc(t.name)} <small>${t.themeId?'добавление в тему':'новая тема'}</small></h3><ul>${t.questions.slice(0,15).map(q=>`<li>${esc(q.text || questionLabel(q))}</li>`).join('')}</ul>${t.questions.length>15?`<p class="muted">И ещё ${num(t.questions.length-15)} вопросов.</p>`:''}</section>`).join('')}</div><p class="tiny muted">Импорт добавляет вопросы только в банк. Назначения клеток и прогресс игры сохраняются.</p>`,()=>{
    applyQuestionImport(S(),plan);bankTab='themes';themeId=S().bank.themes.find(t=>t.name===plan.themes[0]?.name)?.id;search='';
  },'Добавить вопросы');
  editor.querySelector('[type="submit"]').disabled=!!plan.errors.length||!plan.count;
}
let fileReadTicket=0;
async function importFile(input) {
  const file=input.files[0];input.value='';if(!file)return;
  if(conflict)return toast('Сначала обновите страницу: игра изменилась в другой вкладке.');
  if(rehearsal)return toast('Для импорта выйдите из репетиции.');
  const ticket=++fileReadTicket, excel=input.id==='excel-input';
  try {
    if(file.size>(excel?MAX_EXCEL_SIZE:MAX_FILE_SIZE))throw new Error(excel?'Excel-файл больше 5 МБ.':'JSON-файл больше 16 МБ.');
    if(excel&&!/\.xlsx$/i.test(file.name))throw new Error('Используйте файл Excel в формате .xlsx.');
    if(excel){const rows=readExcelRows(await file.arrayBuffer());if(ticket===fileReadTicket)excelPreview(planQuestionImport(rows,real.bank),file.name);}
    else{const imported=readBackup(await file.text());if(ticket===fileReadTicket)jsonPreview(imported,file.name);}
  }catch(e){toast(e.message);}
}
document.querySelector('#excel-input').addEventListener('change',e=>importFile(e.target));
document.querySelector('#json-input').addEventListener('change',e=>importFile(e.target));
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'&&!editor.open&&!confirmBox.open&&!e.target.closest('input,textarea,select,[contenteditable="true"]')){
    e.preventDefault();undoLast();
  }
});
function enterRehearsal() {
  if (rehearsal) { page='game'; render(); return; }
  const before=captureApp();
  rehearsal=C.clone(real); C.resetGame(rehearsal); C.startGame(rehearsal,true); page='game'; remember(before,'Начало репетиции'); render();
  toast('Репетиция началась. Настоящий счёт и прогресс сохранены.');
}
async function goHome() {
  if (rehearsal) {
    if(!await confirmAction('Выйти из репетиции? Все пробные изменения будут отброшены.'))return;
    const before=captureApp(); rehearsal=null; page='home'; remember(before,'Выход из репетиции'); render(); return;
  }
  page='home'; render();
}
async function action(act, el) {
  const id=el.dataset.id, g=G(), b=S().bank;
  if(act==='close-modal')return editor.close();
  if(act==='preview-media')return previewMedia(el);
  if(act==='undo')return undoLast();
  if(act==='import-excel')return document.querySelector('#excel-input').click();
  if(act==='import-json')return document.querySelector('#json-input').click();
  if(act==='export-json')return exportJson();
  if(act==='home')return goHome();
  if(act==='bank'||act==='setup'){page=act;render();return;}
  if(act==='play'){
    if(!g.started&&C.readiness(S()).length){page='setup';render();toast('Перед стартом исправьте ошибки. Репетиция уже доступна.');return;}
    mutate(s=>C.startGame(s,!!rehearsal),false); if(!G().started)return; page='game';render();return;
  }
  if(act==='rehearse')return enterRehearsal();
  if(act==='fullscreen'){
    try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('Полноэкранный режим недоступен. Используйте полноэкранный режим браузера.');}return;
  }
  if(act==='allow-save'){
    if(!await confirmAction('Заменить недоступное сохранение текущими данными на экране?'))return;
    saveBlocked=false;loaded.warning='';persist();render();return;
  }
  if(act==='bank-tab'){bankTab=id;search='';render();return;}
  if(act==='choose-theme'){themeId=id;search='';render();return;}
  if(act==='add-theme'||act==='rename-theme'){
    const t=b.themes.find(t=>t.id===id);
    modal(t?'Название темы':'Новая тема',field('Название','name',t?.name,'required maxlength="80"'),f=>{
      const name=f.get('name').trim();if(!name)throw new Error('Введите название темы.');
      if(t)S().bank.themes.find(x=>x.id===id).name=name;
      else{const theme={id:C.uid(),name,questions:[]};S().bank.themes.push(theme);themeId=theme.id;}
    });return;
  }
  if(act==='delete-theme'){
    if(!await confirmAction('Удалить тему со всеми вопросами из банка? Копии в игре сохранятся.'))return;
    mutate(s=>{s.bank.themes=s.bank.themes.filter(t=>t.id!==id);});return;
  }
  if(act==='edit-question')return questionModal('question',id,el.dataset.theme);
  if(act==='edit-cat')return questionModal('cat',id);
  if(act==='delete-question'||act==='delete-cat'||act==='delete-mod'){
    if(!await confirmAction('Удалить элемент из банка? Копии в начатой игре сохранятся.'))return;
    mutate(s=>{if(act==='delete-question'){const t=s.bank.themes.find(t=>t.id===el.dataset.theme);t.questions=t.questions.filter(q=>q.id!==id);}else if(act==='delete-cat'){s.bank.cats=s.bank.cats.filter(q=>q.id!==id);if(!s.game.started)s.game.catPool=s.game.catPool.filter(x=>x!==id);}else{s.bank.modifiers=s.bank.modifiers.filter(m=>m.id!==id);if(!s.game.started)s.game.modPool=s.game.modPool.filter(x=>x!==id);}});return;
  }
  if(act==='edit-mod'){
    const m=b.modifiers.find(m=>m.id===id)||{id:C.uid(),name:'',description:'',type:'multiply',value:2,on:'always'};
    modal('Модификатор',`${field('Название','name',m.name,'required maxlength="80"')}${textarea('Описание для участников','description',m.description)}<div class="form-grid"><label>Тип эффекта<select name="type"><option value="multiply" ${m.type==='multiply'?'selected':''}>Множитель</option><option value="fixed" ${m.type==='fixed'?'selected':''}>Фиксированная прибавка</option></select></label>${field('Значение','value',m.value,'type="number" required step="any"')}<label>Условие фиксированной прибавки<select name="on"><option value="always" ${m.on==='always'?'selected':''}>Каждая операция</option><option value="win" ${m.on==='win'?'selected':''}>Только начисление</option><option value="loss" ${m.on==='loss'?'selected':''}>Только списание</option></select></label></div><p class="tiny muted">Множитель: от 0 до 100, не включая 0, действует на оба знака. Фиксированная прибавка может быть отрицательной. Например, +100 при списании превращает −300 в −200. Результат округляется до целого.</p>`,f=>{
      const updated={id:m.id,name:f.get('name').trim(),description:f.get('description').trim(),type:f.get('type'),value:Number(f.get('value')),on:f.get('on')};
      if(!C.validModifier(updated))throw new Error('Проверьте название и значение эффекта.');
      const i=S().bank.modifiers.findIndex(m=>m.id===id);if(i<0)S().bank.modifiers.push(updated);else S().bank.modifiers[i]=updated;
    });return;
  }
  if(act==='setup-round'){roundId=id;render();return;}
  if(act==='add-round'){if(g.started)return;mutate(s=>{const r=C.blankRound(`Раунд ${g.rounds.length+1}`);s.game.rounds.push(r);roundId=r.id;});return;}
  if(act==='delete-round'){if(g.started||!await confirmAction('Удалить раунд и его клетки?'))return;mutate(s=>{s.game.rounds=s.game.rounds.filter(r=>r.id!==id);s.game.roundId=s.game.rounds[0]?.id||'';});return;}
  if(act==='add-topic'){
    if(g.started)return;const tid=document.querySelector('#theme-to-add').value;if(!tid)return toast('Сначала выберите тему из банка.');
    mutate(s=>{const r=s.game.rounds.find(r=>r.id===roundId);if(r.topics.length>=6)throw new Error('В раунде уже 6 тем.');r.topics.push(C.topicFromTheme(s.bank.themes.find(t=>t.id===tid)));});return;
  }
  if(act==='delete-topic'){if(g.started||!await confirmAction('Убрать тему и её клетки из раунда? Банк сохранится.'))return;mutate(s=>{const r=s.game.rounds.find(r=>r.id===el.dataset.round);r.topics=r.topics.filter(t=>t.id!==id);});return;}
  if(act==='edit-cell')return cellModal(id);
  if(act==='open-cell')return mutate(s=>C.openCell(s,id,!!rehearsal),true,'Открытие вопроса');
  if(act==='confirm-special')return mutate(s=>C.confirmSpecial(s.game,Number(document.querySelector('#cat-price')?.value),document.querySelector('#cat-team')?.value));
  if(act==='final-exclude')return mutate(s=>F.excludeFinalTopic(s.game,id),true,'Исключение темы финала');
  if(act==='final-confirm-bets'){
    const values=[...document.querySelectorAll('[data-setting="final-bet"]')].map(el=>[el.dataset.id,el.value.trim()===''?NaN:Number(el.value)]);
    if(!mutate(s=>{for(const [teamId,value] of values)F.setFinalBet(s.game,teamId,value);},false,'Изменение ставок'))return;
    return mutate(s=>F.confirmFinalBets(s.game),true,'Фиксация ставок');
  }
  if(act==='final-response')return mutate(s=>F.markFinalResponse(s.game,id),true,'Ответ команды в финале');
  if(act==='final-reveal')return mutate(s=>F.revealFinalAnswer(s.game),true,'Показ ответа финала');
  if(act==='final-judge')return mutate(s=>F.gradeFinalAnswer(s.game,id,el.dataset.correct==='true'),true,'Оценка финального ответа');
  if(act==='answering')return mutate(s=>C.selectAnswering(s.game,id));
  if(act==='judge')return mutate(s=>C.judgeAnswer(s.game,id,el.dataset.correct==='true'),true,'Оценка ответа');
  if(act==='reveal')return mutate(s=>C.revealAnswer(s.game));
  if(act==='manual-score'){
    const t=g.teams.find(t=>t.id===id);
    modal(`Счёт · ${t.name}`,field('Новый счёт','score',t.score,'type="number" step="1" required')+'<p class="muted">Ручная корректировка не учитывает модификатор вопроса.</p>',f=>C.setScore(G(),id,Number(f.get('score'))),'Применить');return;
  }
  if(act==='close-question'){
    if(g.active?.stage!=='answer'&&!await confirmAction('Закрыть вопрос без показа ответа? Текущий счёт сохранится, клетка станет недоступна.'))return;
    return mutate(s=>C.closeQuestion(s.game));
  }
  if(act==='finish'){if(g.final?.enabled){if(!await confirmAction('Перейти к финалу? Обычные раунды будут закрыты для продолжения.'))return;return mutate(s=>F.startFinal(s,!!rehearsal),true,'Начало финала');}if(!await confirmAction('Завершить игру и показать результаты?'))return;return mutate(s=>C.finishGame(s.game),true,'Завершение игры');}
  if(act==='reset'||act==='new-game'){
    if(!await confirmAction(act==='reset'?'Сбросить счёт и прогресс игры? Поле и банк вопросов сохранятся.':'Создать новую пустую игру? Текущее поле и прогресс будут заменены. Банк вопросов сохранится.'))return;
    mutate(s=>{if(act==='reset')C.resetGame(s);else s.game=C.newGame();});return;
  }
  if(act==='history'){
    modal('История счёта',`<div class="history">${[...g.log].reverse().map(l=>`<div><span>${esc(l.team)}<small>${esc(l.reason)}</small></span><strong>${signed(l.delta)}</strong></div>`).join('')||'<p class="empty">Операций пока нет.</p>'}</div>`,()=>{},'Готово');return;
  }
}
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-act]');if(!el)return;e.preventDefault();
  Promise.resolve(action(el.dataset.act,el)).catch(err=>toast(err.message));
});
function refreshBetButton() {
  const button=document.querySelector('[data-act="final-confirm-bets"]'),run=G().final?.run;
  if(!button||run?.stage!=='bets')return;
  button.disabled=![...document.querySelectorAll('[data-setting="final-bet"]')].every(el=>el.value.trim()!==''&&Number.isSafeInteger(Number(el.value))&&Number(el.value)>=0&&Number(el.value)<=run.caps[el.dataset.id]);
}
document.addEventListener('input',e=>{if(e.target.dataset.setting==='final-bet')refreshBetButton();});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.setting==='final-bet'){
    const ok=mutate(s=>F.setFinalBet(s.game,el.dataset.id,el.value.trim()===''?NaN:Number(el.value)),false,'Изменение ставки');
    if(!ok)el.value=G().final.run.bets[el.dataset.id]??'';
    refreshBetButton();return;
  }
  if(el.id==='cat-price'||el.id==='cat-team')return mutate(s=>{
    if(s.game.active?.stage!=='special')return;
    if(el.id==='cat-price')s.game.active.price=Number(el.value);
    else s.game.active.teamId=el.value;
  },false);
  if(el.id==='cell-question'){
    const q=S().bank.themes.flatMap(t=>t.questions).find(q=>q.id===el.value);
    if(q)editor.querySelector('#cell-fields').innerHTML=qFields(q);
    return;
  }
  if(el.id==='game-round')return mutate(s=>{s.game.roundId=el.value;});
  if(el.id==='question-search'){search=el.value;render();document.querySelector('#question-search')?.focus();return;}
  const setting=el.dataset.setting;if(!setting)return;
  mutate(s=>{
    const g=s.game;
    if(setting==='final-enabled')F.configureFinal(g,el.checked);
    if(setting==='final-theme')F.chooseFinalTheme(g,el.dataset.id,s.bank.themes.find(t=>t.id===el.value));
    if(setting==='final-question'){const q=s.bank.themes.flatMap(t=>t.questions).find(q=>q.id===el.value);F.assignFinalQuestion(g,el.dataset.id,q);}
    if(setting==='title')g.title=el.value;
    if(setting==='team-name')g.teams.find(t=>t.id===el.dataset.id).name=el.value;
    if(setting==='team-count'&&!g.started){const n=Number(el.value);while(g.teams.length<n)g.teams.push({id:C.uid(),name:`Команда ${g.teams.length+1}`,score:0});g.teams=g.teams.slice(0,n);}
    if(setting==='round-name'&&!g.started)g.rounds.find(r=>r.id===el.dataset.id).name=el.value;
    if(setting==='price'&&!g.started)g.rounds.find(r=>r.id===el.dataset.id).prices[Number(el.dataset.index)]=Number(el.value);
    if(setting==='topic-name'&&!g.started)g.rounds.find(r=>r.id===el.dataset.round).topics.find(t=>t.id===el.dataset.id).name=el.value;
    if((setting==='cat-pool'||setting==='mod-pool')&&!g.started){const key=setting==='cat-pool'?'catPool':'modPool';g[key]=el.checked?[...new Set([...g[key],el.value])]:g[key].filter(id=>id!==el.value);}
  });
});
window.addEventListener('storage',e=>{
  if(e.key!==C.STORAGE_KEY||e.newValue===JSON.stringify(real))return;
  conflict=true;render();toast('Данные изменены в другой вкладке. Обновите страницу.');
});
render();
