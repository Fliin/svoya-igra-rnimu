import { clone, uid, blankFinal, finalReadiness, questionIssues, blankQuestion } from './core.js?v=20261120-media';

export const blankFinalTopic = () => ({ id:uid(), themeId:'', name:'', questionId:'', question:null });
export function configureFinal(g, enabled) {
  if(g.started)throw new Error('Настройки финала фиксируются при старте игры.');
  g.final ||= blankFinal();g.final.enabled=enabled;
  if(enabled&&g.final.topics.length===0)g.final.topics=Array.from({length:5},blankFinalTopic);
}
export function chooseFinalTheme(g, slotId, theme) {
  if(g.started)throw new Error('Финал уже зафиксирован.');
  const t=g.final.topics.find(t=>t.id===slotId);if(!t)throw new Error('Тема финала не найдена.');
  if(theme&&g.final.topics.some(x=>x.id!==slotId&&x.themeId===theme.id))throw new Error('Эта тема уже есть в финале.');
  t.themeId=theme?.id||'';t.name=theme?.name||'';t.questionId='';t.question=null;
}
export function assignFinalQuestion(g, slotId, question) {
  if(g.started)throw new Error('Финал уже зафиксирован.');
  const t=g.final.topics.find(t=>t.id===slotId);if(!t)throw new Error('Тема финала не найдена.');
  if(question){
    const used=g.rounds.some(r=>r.topics.some(t=>t.cells.some(c=>!c.cat&&c.questionId===question.id)))||g.final.topics.some(x=>x.id!==slotId&&x.questionId===question.id);
    if(used)throw new Error('Этот вопрос уже назначен в игре.');
  }
  t.questionId=question?.id||'';t.question=question?clone(question):null;
}
export function startFinal(state, rehearsal=false) {
  const g=state.game;
  if(!g.started||g.finished||g.active||!g.final?.enabled||g.final.run)throw new Error('Сейчас нельзя начать финал.');
  if(finalReadiness(state).length&&!rehearsal)throw new Error('Финал не готов. Проверьте настройки тем и вопросов.');
  if(rehearsal){
    while(g.final.topics.length<5)g.final.topics.push(blankFinalTopic());
    for(const [i,t] of g.final.topics.entries()){
      if(!t.themeId)t.themeId='rehearsal-'+t.id;
      if(!t.name.trim())t.name=`Тема финала ${i+1}`;
      if(questionIssues(t.question).length){t.question={...blankQuestion(),text:'Здесь пока нет готового финального вопроса',answer:'Назначьте вопрос и ответ в настройках финала.'};t.questionId=t.question.id;}
    }
  }
  const caps=Object.fromEntries(g.teams.map(t=>[t.id,Math.max(0,t.score)]));
  g.final.run={stage:'veto',excluded:[],topicId:'',order:g.teams.map(t=>t.id),caps,bets:Object.fromEntries(g.teams.map(t=>[t.id,caps[t.id]===0?0:null])),responded:[],results:{},index:0};
}
export function excludeFinalTopic(g, topicId) {
  const f=g.final, r=f?.run;
  if(r?.stage!=='veto'||!f.topics.some(t=>t.id===topicId)||r.excluded.includes(topicId))throw new Error('Эту тему сейчас нельзя исключить.');
  r.excluded.push(topicId);
  if(r.excluded.length===4){r.topicId=f.topics.find(t=>!r.excluded.includes(t.id)).id;r.stage='bets';}
}
export function setFinalBet(g, teamId, amount) {
  const r=g.final?.run;
  if(r?.stage!=='bets'||!r.order.includes(teamId)||!Number.isSafeInteger(amount)||amount<0||amount>r.caps[teamId])throw new Error('Ставка должна быть целым числом от 0 до доступного счёта команды.');
  r.bets[teamId]=amount;
}
export const betsReady = g => !!g.final?.run&&g.final.run.order.every(id=>Number.isSafeInteger(g.final.run.bets[id])&&g.final.run.bets[id]>=0&&g.final.run.bets[id]<=g.final.run.caps[id]);
export function confirmFinalBets(g) {
  const r=g.final?.run;
  if(r?.stage!=='bets'||!betsReady(g))throw new Error('Укажите допустимую ставку каждой команды.');
  r.stage='question';
}
export function markFinalResponse(g, teamId) {
  const r=g.final?.run;
  if(r?.stage!=='question'||r.order[r.responded.length]!==teamId)throw new Error('Сейчас отвечает другая команда.');
  r.responded.push(teamId);
}
export function revealFinalAnswer(g) {
  const r=g.final?.run;
  if(r?.stage!=='question'||r.responded.length!==r.order.length)throw new Error('Сначала получите ответы всех команд.');
  r.stage='review';
}
export function gradeFinalAnswer(g, teamId, correct) {
  const f=g.final,r=f?.run,team=g.teams.find(t=>t.id===teamId),topic=f?.topics.find(t=>t.id===r?.topicId);
  if(r?.stage!=='review'||r.order[r.index]!==teamId||r.results[teamId]||typeof correct!=='boolean'||!team)throw new Error('Сейчас нельзя оценить этот ответ.');
  const bet=r.bets[teamId],delta=correct?bet:-bet;
  if(!Number.isSafeInteger(team.score+delta))throw new Error('Счёт вышел за допустимый диапазон.');
  team.score+=delta;r.results[teamId]={correct,delta,bet};
  g.log.push({id:uid(),time:Date.now(),team:team.name,delta,reason:`Финал · ${topic.name} · ${correct?'Верно':'Неверно'}`});
  r.index++;
  if(r.index===r.order.length){r.stage='complete';g.finished=true;}
  return delta;
}
export function rankTeams(teams) {
  const rows=teams.map((t,i)=>({...t,originalOrder:i})).sort((a,b)=>b.score-a.score||a.originalOrder-b.originalOrder);
  let rank=0;
  return rows.map((t,i)=>{if(i===0||t.score!==rows[i-1].score)rank=i+1;return {...t,rank};});
}
export function validateFinalState(state, checkQuestion) {
  const g=state.game;
  if(g.final===undefined){g.final=blankFinal();return;}
  const f=g.final, fail=()=>{throw new Error('В резервной копии повреждены настройки или прогресс финала.');};
  const text=x=>typeof x==='string'&&x.length<=100000, unique=a=>new Set(a).size===a.length;
  const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,199}$/.test(x)&&!['__proto__','constructor','prototype'].includes(x);
  if(!f||typeof f.enabled!=='boolean'||!Array.isArray(f.topics)||f.topics.length>5||!unique(f.topics.map(t=>t?.id)))fail();
  for(const t of f.topics){
    if(!t||!validId(t.id)||!(t.themeId===''||validId(t.themeId))||!text(t.name)||!(t.questionId===''||validId(t.questionId)))fail();
    if(t.question){checkQuestion(t.question);if(t.questionId!==t.question.id)fail();}else if(t.questionId!=='')fail();
  }
  if(f.run===null)return;
  const r=f.run,ids=g.teams.map(t=>t.id),topics=f.topics.map(t=>t.id);
  if(!r||!f.enabled||!g.started||g.active||finalReadiness(state).length||!['veto','bets','question','review','complete'].includes(r.stage))fail();
  if(!Array.isArray(r.order)||r.order.length!==ids.length||!unique(r.order)||r.order.some(id=>!ids.includes(id)))fail();
  if(!Array.isArray(r.excluded)||!unique(r.excluded)||r.excluded.length>4||r.excluded.some(id=>!topics.includes(id)))fail();
  if(!r.caps||!r.bets||r.order.some(id=>!Number.isSafeInteger(r.caps[id])||r.caps[id]<0||(r.bets[id]!==null&&(!Number.isSafeInteger(r.bets[id])||r.bets[id]<0||r.bets[id]>r.caps[id]))))fail();
  if(r.stage==='veto'){if(r.excluded.length>=4||r.topicId!=='')fail();}
  else if(r.excluded.length!==4||!topics.includes(r.topicId)||r.excluded.includes(r.topicId))fail();
  if(!Array.isArray(r.responded)||r.responded.length>ids.length||r.responded.some((id,i)=>r.order[i]!==id))fail();
  if(!Number.isInteger(r.index)||r.index<0||r.index>ids.length||!r.results||Array.isArray(r.results)||Object.keys(r.results).length!==r.index)fail();
  if(['veto','bets'].includes(r.stage)&&(r.responded.length||r.index))fail();
  if(!['veto','bets'].includes(r.stage)&&!betsReady(g))fail();
  if(r.stage==='question'&&r.index)fail();
  if(['review','complete'].includes(r.stage)&&r.responded.length!==ids.length)fail();
  if(r.stage==='review'&&r.index>=ids.length)fail();
  if((r.stage==='complete')!==g.finished||(r.stage==='complete'&&r.index!==ids.length))fail();
  for(let i=0;i<r.index;i++){const id=r.order[i],result=r.results[id];if(!result||typeof result.correct!=='boolean'||result.bet!==r.bets[id]||result.delta!==(result.correct?r.bets[id]:-r.bets[id]))fail();}
}
