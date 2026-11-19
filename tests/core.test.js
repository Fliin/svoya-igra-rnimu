import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.js';
import { seedState } from '../public/seed.js';
const allCells=s=>s.game.rounds.flatMap(r=>r.topics.flatMap(t=>t.cells));
const regular=s=>allCells(s).find(c=>!c.cat&&!c.modifier);
const combined=s=>allCells(s).find(c=>c.cat&&c.modifier);
test('Демонстрационная игра полностью готова',()=>{const s=seedState();assert.deepEqual(C.readiness(s),[]);assert.equal(allCells(s).length,30);});
test('Неполная игра не запускается, но репетиция разрешена',()=>{const s=seedState();s.game=C.newGame();assert.throws(()=>C.startGame(s));C.startGame(s,true);assert.equal(s.game.started,true);});
test('Проверки цен, команд, размеров поля и пустых ответов',()=>{
  const s=seedState();s.game.teams[1].name=s.game.teams[0].name;s.game.rounds[0].prices[2]=0;
  s.game.rounds[0].topics.push(C.clone(s.game.rounds[0].topics[0]));regular(s).question.answer='';
  const errors=C.readiness(s).join(' ');assert.match(errors,/Названия команд/);assert.match(errors,/5 положительных/);assert.match(errors,/до 6 тем/);assert.match(errors,/нет текста или картинки ответа/);
});
test('Повторы вопросов запрещены между раундами; темы повторять можно',()=>{
  const s=seedState(), r=C.blankRound('Раунд 2');r.topics=[C.topicFromTheme(s.bank.themes[0],true)];s.game.rounds.push(r);
  assert.match(C.readiness(s).join(' '),/повторяется/);
  assert.throws(()=>C.assignQuestion(s.game,r.topics[0].cells[0].id,s.bank.themes[0].questions[0]),/уже назначен/);
});
test('Баллы доступны только после ответа, повторные операции и отрицательный счёт',()=>{
  const s=seedState(), id=regular(s).id, t=s.game.teams[0];C.startGame(s);C.openCell(s,id);
  assert.throws(()=>C.changeScore(s.game,t.id,1));C.revealAnswer(s.game);
  C.changeScore(s.game,t.id,-1);C.changeScore(s.game,t.id,-1);assert.equal(t.score,-200);
  C.changeScore(s.game,t.id,1);assert.equal(t.score,-100);assert.equal(s.game.log.length,3);
  C.closeQuestion(s.game);assert.equal(C.findCell(s.game,id).cell.played,true);assert.throws(()=>C.openCell(s,id));
});
test('Перехваты следуют за ошибкой без автоматического списания',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,regular(s).id);
  C.selectAnswering(s.game,s.game.teams[0].id);C.recordMiss(s.game);
  assert.equal(s.game.teams[0].score,0);assert.throws(()=>C.selectAnswering(s.game,s.game.teams[0].id));
  C.selectAnswering(s.game,s.game.teams[1].id);assert.equal(s.game.active.answeringTeamId,s.game.teams[1].id);
});
test('Кот и модификатор совмещаются, цена и команда задаются до вопроса',()=>{
  const s=seedState();s.game.modPool=[s.bank.modifiers[0].id];C.startGame(s);C.openCell(s,combined(s).id,false,()=>0);
  const a=s.game.active,t=s.game.teams[0];assert.equal(a.stage,'special');assert.ok(a.modifier);assert.equal(s.game.usedCats.length,1);
  assert.throws(()=>C.confirmSpecial(s.game,0,t.id));assert.throws(()=>C.confirmSpecial(s.game,750,''));
  C.confirmSpecial(s.game,750,t.id);assert.equal(a.stage,'question');assert.equal(a.answeringTeamId,t.id);
  assert.throws(()=>C.selectAnswering(s.game,s.game.teams[1].id));C.recordMiss(s.game);C.selectAnswering(s.game,s.game.teams[1].id);
  C.revealAnswer(s.game);C.changeScore(s.game,t.id,-1);C.changeScore(s.game,t.id,1);C.changeScore(s.game,t.id,1);assert.equal(t.score,1500);
});
test('Коты не повторяются, модификаторы повторяются',()=>{
  const s=seedState();const cells=allCells(s);s.game.modPool=[s.bank.modifiers[0].id];
  for(let i=0;i<3;i++){cells[i].cat=true;cells[i].modifier=true;}
  for(const c of cells.slice(3))c.cat=false;
  C.startGame(s);const qids=[], mids=[];
  for(let i=0;i<3;i++){C.openCell(s,cells[i].id,false,()=>0);qids.push(s.game.active.question.id);mids.push(s.game.active.modifier.id);C.closeQuestion(s.game);}
  assert.equal(new Set(qids).size,3);assert.equal(new Set(mids).size,1);
});
test('Недостаточный пул котов и некорректный модификатор блокируют старт',()=>{
  const s=seedState();s.game.catPool=[];assert.match(C.readiness(s).join(' '),/разных вопросов/);
  s.bank.modifiers[0].value=0;assert.match(C.readiness(s).join(' '),/некорректный модификатор/);
});
test('Условия фиксированных эффектов и множители работают для обоих знаков',()=>{
  assert.equal(C.scoreDelta(300,{type:'multiply',value:2},-1),-600);
  assert.equal(C.scoreDelta(300,{type:'multiply',value:.5},1),150);
  assert.equal(C.scoreDelta(300,{type:'fixed',value:100,on:'loss'},-1),-200);
  assert.equal(C.scoreDelta(300,{type:'fixed',value:100,on:'loss'},1),300);
  assert.equal(C.scoreDelta(300,{type:'fixed',value:-50,on:'win'},1),250);
  assert.equal(C.scoreDelta(300,{type:'fixed',value:100,on:'always'},1),400);
});
test('Ручная корректировка не учитывает модификатор и не восстанавливает клетку',()=>{
  const s=seedState();C.startGame(s);const id=regular(s).id;C.openCell(s,id);C.closeQuestion(s.game);C.setScore(s.game,s.game.teams[0].id,-123);
  assert.equal(s.game.teams[0].score,-123);assert.equal(C.findCell(s.game,id).cell.played,true);assert.throws(()=>C.setScore(s.game,s.game.teams[0].id,NaN));
});
test('Редактирование банка не меняет копию в игре и зафиксированные пулы',()=>{
  const s=seedState(),cell=regular(s),original=cell.question.text;C.startGame(s);
  s.bank.themes[0].questions[0].text='Другая формулировка';s.bank.cats.length=0;s.bank.modifiers.length=0;
  assert.equal(cell.question.text,original);assert.equal(C.selectedSpecials(s).cats.length,3);assert.equal(C.selectedSpecials(s).modifiers.length,3);
});
test('Редактировать можно только неоткрытые клетки, в том числе после старта',()=>{
  const s=seedState(),cell=regular(s);C.startGame(s);C.openCell(s,cell.id);assert.throws(()=>C.editableCell(s.game,cell.id));
  C.closeQuestion(s.game);assert.throws(()=>C.editableCell(s.game,cell.id));
  const next=allCells(s).find(c=>!c.played);C.editableCell(s.game,next.id).cell.question.text='Уточнение';assert.equal(next.question.text,'Уточнение');
});
test('Репетиция полностью изолирована от настоящего прогресса и банка',()=>{
  const real=seedState();C.startGame(real);C.openCell(real,combined(real).id);const before=JSON.stringify(real), copy=C.clone(real);
  C.resetGame(copy);C.startGame(copy,true);C.openCell(copy,regular(copy).id,true);C.revealAnswer(copy.game);C.changeScore(copy.game,copy.game.teams[0].id,1);C.closeQuestion(copy.game);copy.bank.themes[0].name='Проба';
  assert.equal(JSON.stringify(real),before);
});
test('Сохранение восстанавливает активный спецвопрос без повторного розыгрыша',()=>{
  const s=seedState(),store=new Map(),storage={setItem:(k,v)=>store.set(k,v),getItem:k=>store.get(k)};
  C.startGame(s);C.openCell(s,combined(s).id);C.saveState(storage,s);const restored=C.loadState(storage,seedState);
  assert.deepEqual(restored.state,s);assert.equal(restored.state.game.usedCats.length,1);assert.equal(restored.state.game.active.stage,'special');
});
test('Ошибки хранилища и повреждённые данные возвращаются явно',()=>{
  assert.equal(C.saveState({setItem(){throw Error();}},seedState()),false);
  const result=C.loadState({getItem:()=>'{bad'},seedState);assert.ok(result.warning);assert.equal(result.state.version,1);
});
test('Закрытие без баллов, завершение и сброс сохраняют банк и поле',()=>{
  const s=seedState(),bank=JSON.stringify(s.bank),id=regular(s).id;C.startGame(s);C.openCell(s,id);C.closeQuestion(s.game);
  assert.equal(s.game.teams[0].score,0);C.finishGame(s.game);assert.equal(s.game.finished,true);C.resetGame(s);
  assert.equal(JSON.stringify(s.bank),bank);assert.equal(s.game.started,false);assert.equal(allCells(s).length,30);assert.equal(allCells(s).filter(c=>c.played).length,0);
});
test('Картинки допускаются без текста; активные URL блокируются',()=>{
  assert.deepEqual(C.questionIssues({text:'',image:'https://example.com/q.png',answer:'',answerImage:'https://example.com/a.png'}),[]);
  assert.equal(C.safeUrl('javascript:alert(1)'), '');assert.equal(C.safeUrl('data:text/html,x'),'');assert.equal(C.safeUrl('/relative.png'),'');
});
test('Неудачное открытие спецклетки не расходует кота',()=>{
  const s=seedState();C.startGame(s);s.game.specialBank.modifiers=[];
  assert.throws(()=>C.openCell(s,combined(s).id));assert.deepEqual(s.game.usedCats,[]);assert.equal(s.game.active,null);
});
test('Структурно повреждённое сохранение не ломает запуск',()=>{
  const s=seedState();s.game.rounds[0].topics[0].cells=null;
  assert.ok(C.loadState({getItem:()=>JSON.stringify(s)},seedState).warning);
});
test('Новое название сохраняет прежний прогресс и пользовательские названия',()=>{
  const s=seedState();s.game.title='Своя игра · РНИМУ';C.startGame(s);C.openCell(s,regular(s).id);
  C.revealAnswer(s.game);C.changeScore(s.game,s.game.teams[0].id,1);C.closeQuestion(s.game);
  const expected=C.clone(s);expected.game.title=C.DEFAULT_GAME_TITLE;
  assert.deepEqual(C.loadState({getItem:()=>JSON.stringify(s)},seedState).state,expected);
  s.game.title='Наш особенный вечер';
  assert.deepEqual(C.loadState({getItem:()=>JSON.stringify(s)},seedState).state,s);
});
