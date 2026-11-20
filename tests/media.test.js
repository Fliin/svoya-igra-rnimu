import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, openCell, questionIssues, saveState, startGame } from '../public/core.js';
import { mediaSource, questionMedia } from '../public/media.js';
import { seedState } from '../public/seed.js';
import { EXCEL_HEADERS, applyQuestionImport, createBackup, planQuestionImport, readBackup } from '../public/transfer.js';

const drive = 'https://drive.google.com/file/d/Example_42/view?usp=sharing&resourcekey=0-example';
const mp4 = 'https://files.example.org/answer.mp4';

test('Drive uses the file preview and retains the resource key', () => {
  const expected = {
    kind: 'drive',
    src: 'https://drive.google.com/file/d/Example_42/preview?resourcekey=0-example',
    link: 'https://drive.google.com/file/d/Example_42/view?resourcekey=0-example'
  };
  assert.deepEqual(mediaSource(drive, 'video'), expected);
  assert.deepEqual(mediaSource('https://drive.google.com/open?id=Example_42&resourcekey=0-example', 'image'), expected);
  assert.equal(mediaSource('https://drive.google.com/file/u/0/d/Example_42/preview', 'image').kind, 'drive');
  assert.equal(mediaSource('https://drive.google.com.evil.example/file/d/Example_42/view', 'video').kind, 'video');
  assert.equal(mediaSource('https://drive.google.com/drive/folders/Example_42', 'video'), null);
  assert.equal(mediaSource('javascript:alert(1)', 'video'), null);
});

test('Video-only questions work and transfer the active question and answer URLs', () => {
  const state = seedState();
  const cell = state.game.rounds[0].topics[0].cells[0];
  Object.assign(cell.question, { text: '', answer: '', video: drive, answerVideo: mp4 });
  assert.deepEqual(questionIssues(cell.question), []);
  startGame(state);
  openCell(state, cell.id);
  const restored = readBackup(createBackup(state));
  assert.deepEqual(questionMedia(restored.game.active.question), { kind: 'video', url: drive });
  assert.deepEqual(questionMedia(restored.game.active.question, true), { kind: 'video', url: mp4 });
  let saved;
  const storage = { setItem: (_, value) => { saved = value; }, getItem: () => saved };
  assert.ok(saveState(storage, restored));
  assert.deepEqual(loadState(storage, seedState).state, restored);
  restored.game.active.question.video = 'javascript:alert(1)';
  assert.throws(() => readBackup(JSON.stringify(restored)), /некорректная ссылка на видео/);
});

test('Excel imports media-only rows and detects duplicate or conflicting media', () => {
  const state = seedState();
  const row = ['Видеовопросы', '', '', '', 'https://files.example.org/answer.png', drive, ''];
  const rows = [EXCEL_HEADERS, row];
  const plan = planQuestionImport(rows, state.bank);
  assert.deepEqual(plan.errors, []);
  assert.equal(applyQuestionImport(state, plan), 1);
  const question = state.bank.themes.at(-1).questions[0];
  assert.equal(question.video, drive);
  assert.equal(question.answerImage, row[4]);
  assert.equal(planQuestionImport(rows, state.bank).duplicates, 1);
  const invalid = [...row];
  invalid[3] = 'https://files.example.org/question.png';
  assert.match(planQuestionImport([EXCEL_HEADERS, invalid], state.bank).errors[0], /выберите одну ссылку/);
});
