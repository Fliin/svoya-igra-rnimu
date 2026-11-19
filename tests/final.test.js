import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../public/core.js';
import * as F from '../public/final.js';
import { createBackup, readBackup } from '../public/transfer.js';
import { UndoHistory } from '../public/undo.js';
import { readyFinal, startedFinal, toBets, toReview } from './helpers.js';

test('Финал использует общие темы банка, но отдельные вопросы',()=>{
  const s=readyFinal();assert.deepEqual(C.readiness(s),[]);assert.equal(s.game.final.topics.length,5);
  assert.equal(s.game.final.topics[0].themeId,s.game.rounds[0].topics[0].themeId);
  assert.throws(()=>F.assignFinalQuestion(s.game,s.game.final.topics[0].id,s.bank.themes[0].questions[0]));
  assert.throws(()=>C.assignQuestion(s.game,s.game.rounds[0].topics[0].cells[0].id,s.game.final.topics[0].question));
});
test('Неполный финал и повторные темы блокируют настоящий запуск',()=>{
  const s=readyFinal();s.game.final.topics[0].question=null;s.game.final.topics[0].questionId='';assert.throws(()=>C.startGame(s));
  const other=readyFinal();assert.throws(()=>F.chooseFinalTheme(other.game,other.game.final.topics[1].id,other.bank.themes[0]));
});
test('Ведущий исключает любые четыре темы, пятая остаётся для игры',()=>{
  const s=startedFinal();const excluded=[3,1,4,0];
  for(const i of excluded)F.excludeFinalTopic(s.game,s.game.final.topics[i].id);
  assert.equal(s.game.final.run.stage,'bets');assert.equal(s.game.final.run.topicId,s.game.final.topics[2].id);
  assert.throws(()=>F.excludeFinalTopic(s.game,s.game.final.topics[2].id));
});
test('Нельзя запустить финал поверх открытого обычного вопроса',()=>{
  const s=readyFinal();C.startGame(s);C.openCell(s,s.game.rounds[0].topics[0].cells[0].id);assert.throws(()=>F.startFinal(s));
});
test('В ходе финала обычные клетки недоступны; настройки зафиксированы',()=>{
  const s=startedFinal();assert.throws(()=>C.openCell(s,s.game.rounds[0].topics[0].cells[0].id));
  assert.throws(()=>F.configureFinal(s.game,false));assert.throws(()=>F.assignFinalQuestion(s.game,s.game.final.topics[0].id,null));
});
test('Ставки ограничены счётом, при отрицательном или нулевом счёте — только ноль',()=>{
  const s=startedFinal([700,0,-200]);toBets(s);const [a,b,c]=s.game.teams;
  assert.equal(s.game.final.run.bets[b.id],0);assert.equal(s.game.final.run.bets[c.id],0);
  for(const value of [-1,701,1.5,NaN])assert.throws(()=>F.setFinalBet(s.game,a.id,value));
  assert.throws(()=>F.setFinalBet(s.game,b.id,1));assert.throws(()=>F.setFinalBet(s.game,c.id,1));
  assert.throws(()=>F.confirmFinalBets(s.game));F.setFinalBet(s.game,a.id,700);F.confirmFinalBets(s.game);assert.equal(s.game.final.run.stage,'question');
});
test('Ручная коррекция до фиксации ставок обновляет доступную сумму',()=>{
  const s=startedFinal();toBets(s);const id=s.game.teams[0].id;F.setFinalBet(s.game,id,900);C.setScore(s.game,id,200);
  assert.equal(s.game.final.run.caps[id],200);assert.equal(s.game.final.run.bets[id],null);assert.equal(F.betsReady(s.game),false);
  C.setScore(s.game,id,-50);assert.equal(s.game.final.run.bets[id],0);
});
test('Ответы устные по очереди, правильный ответ скрыт до последней команды',()=>{
  const s=startedFinal();toBets(s);s.game.final.run.order.forEach((id,i)=>F.setFinalBet(s.game,id,[100,100,0][i]));F.confirmFinalBets(s.game);
  assert.throws(()=>F.revealFinalAnswer(s.game));assert.throws(()=>F.markFinalResponse(s.game,s.game.teams[1].id));
  F.markFinalResponse(s.game,s.game.teams[0].id);assert.throws(()=>F.markFinalResponse(s.game,s.game.teams[0].id));assert.throws(()=>F.revealFinalAnswer(s.game));
  F.markFinalResponse(s.game,s.game.teams[1].id);F.markFinalResponse(s.game,s.game.teams[2].id);F.revealFinalAnswer(s.game);assert.equal(s.game.final.run.stage,'review');
});
test('Каждая ставка начисляется или списывается один раз; затем показываются победители',()=>{
  const s=startedFinal();toReview(s,[600,200,0]);const [a,b,c]=s.game.teams;
  assert.throws(()=>F.gradeFinalAnswer(s.game,b.id,true));F.gradeFinalAnswer(s.game,a.id,false);assert.equal(a.score,400);assert.throws(()=>F.gradeFinalAnswer(s.game,a.id,false));
  F.gradeFinalAnswer(s.game,b.id,true);F.gradeFinalAnswer(s.game,c.id,false);assert.equal(b.score,700);assert.equal(c.score,-100);assert.equal(s.game.finished,true);assert.equal(s.game.final.run.stage,'complete');
  assert.equal(F.rankTeams(s.game.teams)[0].id,b.id);assert.throws(()=>F.gradeFinalAnswer(s.game,c.id,true));
});
test('Нулевая ставка не меняет счёт ни при верном, ни при неверном ответе',()=>{
  const s=startedFinal([0,-200,100]);toReview(s,[0,0,0]);s.game.teams.forEach((t,i)=>F.gradeFinalAnswer(s.game,t.id,i!==1));
  assert.deepEqual(s.game.teams.map(t=>t.score),[0,-200,100]);
});
test('Финал работает для одной и двух команд',()=>{
  for(const scores of [[100],[100,200]]){const s=startedFinal(scores);toReview(s,scores);for(const id of s.game.final.run.order)F.gradeFinalAnswer(s.game,id,true);assert.equal(s.game.finished,true);assert.deepEqual(s.game.teams.map(t=>t.score),scores.map(v=>v*2));}
});
test('Равный счёт даёт общие места и стабильный порядок',()=>{
  const a=[{id:'a',score:300},{id:'b',score:300},{id:'c',score:100}];assert.deepEqual(F.rankTeams(a).map(t=>[t.id,t.rank]),[['a',1],['b',1],['c',3]]);
  assert.deepEqual(F.rankTeams(a.map(t=>({...t,score:0}))).map(t=>t.rank),[1,1,1]);
});
test('JSON переносит финал на каждом этапе, включая ставки, очередь и уже начисленные баллы',()=>{
  const s=startedFinal(),roundTrip=()=>assert.deepEqual(readBackup(createBackup(s)),s);
  roundTrip();F.excludeFinalTopic(s.game,s.game.final.topics[0].id);roundTrip();for(const t of s.game.final.topics.slice(1,4))F.excludeFinalTopic(s.game,t.id);roundTrip();
  s.game.final.run.order.forEach((id,i)=>F.setFinalBet(s.game,id,[300,200,0][i]));roundTrip();F.confirmFinalBets(s.game);roundTrip();
  for(const id of s.game.final.run.order){F.markFinalResponse(s.game,id);roundTrip();}F.revealFinalAnswer(s.game);roundTrip();
  for(const id of s.game.final.run.order){F.gradeFinalAnswer(s.game,id,true);roundTrip();}
});
test('Повреждённые ставки, исключения, очередь и результаты JSON отклоняются',()=>{
  const s=startedFinal();toReview(s,[300,200,0]);F.gradeFinalAnswer(s.game,s.game.teams[0].id,true);
  for(const corrupt of [x=>x.game.final.run.bets[x.game.teams[0].id]=2000,x=>x.game.final.run.order[0]='missing',x=>x.game.final.run.responded.reverse(),x=>x.game.final.run.excluded[0]=x.game.final.run.excluded[1],x=>x.game.final.run.results[x.game.teams[0].id].delta=999,x=>x.game.finished=true]){
    const bad=C.clone(s);corrupt(bad);assert.throws(()=>readBackup(JSON.stringify(bad)));
  }
});
test('Undo восстанавливает исключение, ставки, последнюю оценку и экран до пьедестала',()=>{
  let s=startedFinal(),h=new UndoHistory();let before=C.clone(s);F.excludeFinalTopic(s.game,s.game.final.topics[0].id);h.record(before,s);s=h.undo();assert.deepEqual(s,before);
  toReview(s,[300,200,0]);F.gradeFinalAnswer(s.game,s.game.teams[0].id,true);F.gradeFinalAnswer(s.game,s.game.teams[1].id,false);before=C.clone(s);F.gradeFinalAnswer(s.game,s.game.teams[2].id,true);h.record(before,s);assert.equal(s.game.finished,true);s=h.undo();assert.deepEqual(s,before);assert.equal(s.game.finished,false);
});
test('Сброс очищает финальный прогресс, сохраняя подготовленные темы',()=>{
  const s=startedFinal(),topics=C.clone(s.game.final.topics);toReview(s,[300,200,0]);C.resetGame(s);assert.equal(s.game.final.run,null);assert.equal(s.game.final.enabled,true);assert.deepEqual(s.game.final.topics,topics);
});
test('Прежние резервные копии без финала загружаются с выключенным финалом',()=>{
  const s=readyFinal();delete s.game.final;const loaded=readBackup(JSON.stringify(s));assert.deepEqual(loaded.game.final,C.blankFinal());assert.deepEqual(loaded.bank,s.bank);
});
test('Неполный финал доступен в отдельной репетиции с заглушками',()=>{
  const s=readyFinal();s.game.final.topics[0].question=null;s.game.final.topics[0].questionId='';C.startGame(s,true);F.startFinal(s,true);
  assert.equal(s.game.final.run.stage,'veto');assert.ok(s.game.final.topics[0].question.answer);
});
