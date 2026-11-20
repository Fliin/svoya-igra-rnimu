import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as C from '../public/core.js';
import { seedState } from '../public/seed.js';
import { UndoHistory } from '../public/undo.js';
import { createBackup, readBackup, validateBackupState, EXCEL_HEADERS, planQuestionImport, applyQuestionImport } from '../public/transfer.js';
import { readExcelRows, inspectXlsxArchive } from '../public/excel.js';

const cells=s=>s.game.rounds.flatMap(r=>r.topics.flatMap(t=>t.cells));
const regular=s=>cells(s).find(c=>!c.cat&&!c.modifier);
const combined=s=>cells(s).find(c=>c.cat&&c.modifier);
function memory(storageValue) { return {getItem:()=>storageValue,setItem:(_,value)=>{storageValue=value;}}; }

test('JSON переносит банк, ручной счёт, штраф, попытки и открытый вопрос',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,regular(s).id);
  C.setScore(s.game,s.game.teams[0].id,500);C.selectAnswering(s.game,s.game.teams[0].id);C.judgeAnswer(s.game,s.game.teams[0].id,false);
  C.selectAnswering(s.game,s.game.teams[1].id);
  const loaded=readBackup(createBackup(s));assert.deepEqual(loaded,s);
  C.judgeAnswer(loaded.game,loaded.game.teams[1].id,true);assert.equal(loaded.game.teams[1].score,100);
  assert.equal(s.game.teams[1].score,0);assert.equal(loaded.game.teams[0].score,400);
  C.closeQuestion(loaded.game);C.saveState(memory(''),loaded);
});
test('JSON восстанавливает уже выбранного кота и модификатор без нового розыгрыша',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,combined(s).id,false,()=>0);
  const loaded=readBackup(createBackup(s));assert.deepEqual(loaded,s);assert.equal(loaded.game.usedCats.length,1);
  C.confirmSpecial(loaded.game,777,loaded.game.teams[2].id);assert.equal(loaded.game.active.question.id,s.game.active.question.id);
});
test('Резервная копия хранит раскрытый оценённый ответ и завершённую игру',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,regular(s).id);C.selectAnswering(s.game,s.game.teams[0].id);C.judgeAnswer(s.game,s.game.teams[0].id,true);
  assert.deepEqual(readBackup(createBackup(s)),s);C.finishGame(s.game);assert.deepEqual(readBackup(createBackup(s)),s);
});
test('Черновик с пустыми клетками и ошибкой цены тоже переносится',()=>{
  const s=seedState();s.game=C.newGame();s.game.rounds[0].prices[0]=-100;
  assert.deepEqual(readBackup(createBackup(s)),s);assert.ok(C.readiness(s).length);
});
test('Повреждённые JSON и неподдерживаемые версии отклоняются без изменения игры',()=>{
  const s=seedState(),before=C.clone(s);
  assert.throws(()=>readBackup('{broken'));
  const envelope=JSON.parse(createBackup(s));envelope.backupVersion=99;assert.throws(()=>readBackup(JSON.stringify(envelope)));
  const bad=C.clone(s);bad.game.teams[0].score='999';assert.throws(()=>validateBackupState(bad));assert.deepEqual(s,before);
});
test('JSON проверяет связи клеток, попытки, пулы и опасные URL',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,regular(s).id);
  for(const change of [x=>x.game.active.cellId='missing',x=>x.game.active.attempts=['missing'],x=>x.game.active.question.image='javascript:alert(1)',x=>x.game.usedCats=['missing'],x=>x.game.rounds[0].topics[1].cells[0].id=x.game.rounds[0].topics[0].cells[0].id]){
    const bad=C.clone(s);change(bad);assert.throws(()=>readBackup(JSON.stringify(bad)));
  }
});
test('JSON не теряет зафиксированные спецпулы после удаления их элементов из банка',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,combined(s).id);s.bank.cats=[];s.bank.modifiers=[];
  assert.deepEqual(readBackup(createBackup(s)),s);
});
test('Excel добавляет вопросы в новые и существующие темы, не трогая поле',()=>{
  const s=seedState(),game=C.clone(s.game),existing=s.bank.themes[0];
  const rows=[EXCEL_HEADERS,[existing.name,'Новый вопрос','Новый ответ','',''],['Новая тема','Второй вопрос','Второй ответ','','']];
  const plan=planQuestionImport(rows,s.bank);assert.equal(plan.count,2);assert.equal(plan.newThemes,1);assert.equal(plan.existingThemes,1);
  applyQuestionImport(s,plan);assert.deepEqual(s.game,game);assert.equal(s.bank.themes.at(-1).questions[0].answer,'Второй ответ');
});
test('Повторный импорт и повторы внутри Excel пропускаются',()=>{
  const s=seedState(),rows=[EXCEL_HEADERS,['Тема','Вопрос','Ответ','',''],['Тема','Вопрос','Ответ','','']];
  const first=planQuestionImport(rows,s.bank);assert.equal(first.duplicates,1);applyQuestionImport(s,first);
  const again=planQuestionImport(rows,s.bank);assert.equal(again.count,0);assert.equal(again.duplicates,2);
});
test('Excel поддерживает изображения без текста и необязательные URL-колонки',()=>{
  const s=seedState();const image=planQuestionImport([EXCEL_HEADERS,['Картинки','','','https://example.com/q.png','https://example.com/a.png']],s.bank);
  assert.equal(image.count,1);assert.deepEqual(image.errors,[]);
  const text=planQuestionImport([['Ответ','Тема','Вопрос'],['Ответ','Новая','Вопрос']],s.bank);assert.equal(text.count,1);
});
test('Ошибки Excel показывают строки и блокируют весь импорт',()=>{
  const s=seedState(),before=C.clone(s);
  const plan=planQuestionImport([EXCEL_HEADERS,['Тема','Вопрос','','',''],['Другая','Вопрос','Ответ','','']],s.bank);
  assert.match(plan.errors[0],/Строка 2/);assert.throws(()=>applyQuestionImport(s,plan));assert.deepEqual(s,before);
  assert.throws(()=>planQuestionImport([['wrong'],['value']],s.bank));
});
test('Изменение банка после предпросмотра требует повторного импорта',()=>{
  const s=seedState(),rows=[EXCEL_HEADERS,['Тема','Вопрос','Ответ','','']],plan=planQuestionImport(rows,s.bank);
  applyQuestionImport(s,plan);assert.throws(()=>applyQuestionImport(s,plan));
});
test('Undo возвращает неверную оценку, право отвечать, выбор команды и открытие клетки',()=>{
  let s=seedState();const h=new UndoHistory(),initial=C.clone(s);
  function act(fn){const before=C.clone(s);fn();h.record(before,s);}
  act(()=>C.startGame(s));act(()=>C.openCell(s,regular(s).id));const opened=C.clone(s);
  act(()=>C.selectAnswering(s.game,s.game.teams[0].id));const chosen=C.clone(s);
  act(()=>C.judgeAnswer(s.game,s.game.teams[0].id,false));assert.equal(s.game.teams[0].score,-100);
  s=h.undo();assert.deepEqual(s,chosen);assert.equal(s.game.active.attempts.length,0);
  s=h.undo();assert.deepEqual(s,opened);s=h.undo();assert.equal(s.game.active,null);s=h.undo();assert.deepEqual(s,initial);
});
test('Undo верной оценки и закрытия восстанавливает предыдущие экраны и баллы',()=>{
  let s=seedState();C.startGame(s);C.openCell(s,regular(s).id);C.selectAnswering(s.game,s.game.teams[0].id);const before=C.clone(s),h=new UndoHistory();
  C.judgeAnswer(s.game,s.game.teams[0].id,true);h.record(before,s);const answer=C.clone(s);C.closeQuestion(s.game);h.record(answer,s);
  s=h.undo();assert.deepEqual(s,answer);s=h.undo();assert.deepEqual(s,before);
});
test('Undo возвращает импорт, сброс и состояние репетиции целиком',()=>{
  const h=new UndoHistory(),real=seedState(),before={real:C.clone(real),rehearsal:null,page:'home'};
  const trial=C.clone(real);C.resetGame(trial);C.startGame(trial,true);const after={real,rehearsal:trial,page:'game'};
  h.record(before,after);assert.deepEqual(h.undo(),before);
  const plan=planQuestionImport([EXCEL_HEADERS,['Тема','Вопрос','Ответ','','']],real.bank),bankBefore=C.clone(real);applyQuestionImport(real,plan);h.record(bankBefore,real);assert.deepEqual(h.undo(),bankBefore);
});
test('Undo ограничивает память, не хранит пустые действия и не связан ссылками с текущими данными',()=>{
  const h=new UndoHistory(2);assert.equal(h.record({n:0},{n:0}),false);
  h.record({n:0},{n:1});h.record({n:1},{n:2});const before={n:2};h.record(before,{n:3});before.n=999;
  assert.deepEqual(h.undo(),{n:2});assert.deepEqual(h.undo(),{n:1});assert.equal(h.undo(),null);
});
test('Все команды ошибаются: ответ раскрывается без дополнительного начисления',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,regular(s).id);
  for(const team of s.game.teams){C.selectAnswering(s.game,team.id);C.judgeAnswer(s.game,team.id,false);}
  assert.ok(s.game.teams.every(t=>t.score===-100));C.revealAnswer(s.game);C.closeQuestion(s.game);assert.ok(s.game.teams.every(t=>t.score===-100));
});
test('Досрочный показ ответа не оценивает выбранную команду',()=>{
  const s=seedState();C.startGame(s);C.openCell(s,regular(s).id);C.selectAnswering(s.game,s.game.teams[0].id);C.revealAnswer(s.game);
  assert.equal(s.game.teams[0].score,0);assert.throws(()=>C.judgeAnswer(s.game,s.game.teams[0].id,true));
});
test('Настоящий Excel-шаблон читается локальной библиотекой с русскими колонками',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(new URL('../public/vendor/xlsx.mini.min.js',import.meta.url),'utf8'),context);
  const bytes=fs.readFileSync(new URL('../public/templates/questions-template.xlsx',import.meta.url));
  const rows=readExcelRows(bytes,context.XLSX),plan=planQuestionImport(rows,{themes:[]});
  assert.deepEqual(Array.from(rows[0].slice(5)), ['Ссылка на видео вопроса', 'Ссылка на видео ответа']);
  assert.equal(context.XLSX.version,'0.20.3');assert.deepEqual(plan.errors,[]);assert.equal(plan.count,2);assert.equal(plan.newThemes,2);
});
test('Не-Excel и архив с чрезмерным распакованным содержимым отклоняются',()=>{
  assert.throws(()=>inspectXlsxArchive(new TextEncoder().encode('not excel')));
  const data=Uint8Array.from(fs.readFileSync(new URL('../public/templates/questions-template.xlsx',import.meta.url))),v=new DataView(data.buffer);
  for(let i=0;i<data.length-46;i++)if(v.getUint32(i,true)===0x02014b50){v.setUint32(i+24,40*1024*1024,true);break;}
  assert.throws(()=>inspectXlsxArchive(data),/слишком большое/);
});
test('Вложенные null и зарезервированные идентификаторы JSON отклоняются понятной ошибкой',()=>{
  const s=seedState();s.bank.themes[0]=null;assert.throws(()=>readBackup(JSON.stringify(s)),/структура повреждена/);
  const t=seedState();t.game.teams[0].id='__proto__';assert.throws(()=>readBackup(JSON.stringify(t)),/команды/);
  const f=seedState();f.game.final.topics=[{id:'bad" onclick="alert(1)',themeId:'',name:'',questionId:'',question:null}];assert.throws(()=>readBackup(JSON.stringify(f)),/финала/);
});
