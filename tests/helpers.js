import * as C from '../public/core.js';
import * as F from '../public/final.js';
import { seedState } from '../public/seed.js';
export function readyFinal(teams=3) {
  const s=seedState();s.game.teams=s.game.teams.slice(0,teams);F.configureFinal(s.game,true);
  for(let i=0;i<5;i++){
    const theme=s.bank.themes[i],q={...C.blankQuestion(),text:`Финальный вопрос ${i+1}`,answer:`Финальный ответ ${i+1}`};theme.questions.push(q);
    F.chooseFinalTheme(s.game,s.game.final.topics[i].id,theme);F.assignFinalQuestion(s.game,s.game.final.topics[i].id,q);
  }
  return s;
}
export function startedFinal(scores=[1000,500,-100]) {
  const s=readyFinal(scores.length);C.startGame(s);s.game.teams.forEach((t,i)=>C.setScore(s.game,t.id,scores[i]));F.startFinal(s);return s;
}
export function toBets(s) { for(const t of s.game.final.topics.slice(0,4))F.excludeFinalTopic(s.game,t.id); }
export function toReview(s,bets) {
  toBets(s);s.game.final.run.order.forEach((id,i)=>F.setFinalBet(s.game,id,bets[i]));F.confirmFinalBets(s.game);
  for(const id of s.game.final.run.order)F.markFinalResponse(s.game,id);F.revealFinalAnswer(s.game);
}
