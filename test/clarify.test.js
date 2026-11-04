import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sortIntoSlots, mergeSlots, buildDraft, stuckFromFindings, SLOTS } from '../src/clarify.js';
import { buildLexicon } from '../src/lexicon.js';
import { tokenize } from '../src/tokenize.js';

const sort = (text, hint = null) => {
  const tk = tokenize(text, buildLexicon());
  return sortIntoSlots(text, tk.tokens, tk.sentences, null, 0, hint);
};
const keys = (slots) => Object.fromEntries(SLOTS.map((s) => [s, slots[s].map((x) => x.key)]));

test('五格分類：感受、想要、擋住、擔心、發生了什麼', () => {
  const k = keys(sort('昨天開會被罵了。我很難過，我想要被認可，但是主管覺得我不夠好，我擔心會被調職。'));
  assert.deepEqual(k.FEELING, ['難過']);
  assert.deepEqual(k.WANT, ['被認可']);
  assert.deepEqual(k.BLOCK, ['主管覺得我不夠好']);
  assert.deepEqual(k.WORRY, ['我擔心會被調職']);
  assert.equal(k.EVENT.length, 1);
});

test('每個子句只進一格，位置對得回原文', () => {
  const text = '我好煩，我想要換工作，但是沒辦法。';
  const slots = sort(text);
  const all = SLOTS.flatMap((s) => slots[s]);
  assert.equal(all.length, 3);
  for (const it of all) assert.equal(text.slice(it.start, it.end), it.text);
});

test('hint：答案沒被分到任何一格時，填進被問的那一格', () => {
  assert.deepEqual(keys(sort('主管一直把機會給別人。', 'BLOCK')).BLOCK, ['主管一直把機會給別人']);
  assert.deepEqual(keys(sort('被看見', 'WANT')).WANT, ['被看見']);
});

test('mergeSlots：新的放前面', () => {
  const m = mergeSlots({ WANT: [{ key: '舊' }] }, { WANT: [{ key: '新' }] });
  assert.deepEqual(m.WANT.map((x) => x.key), ['新', '舊']);
});

test('buildDraft：缺格顯示「？」，衝突時兩個想要都放進草稿', () => {
  const empty = Object.fromEntries(SLOTS.map((s) => [s, []]));
  assert.equal(buildDraft(empty, null).text, '我想要［？］，但是［？］，我的感受是［？］。');
  const d = buildDraft(empty, { kind: 'CONFLICT', slots: { A: '升遷', B: '準時下班' } });
  assert.equal(d.text, '我想要［升遷］，但是［準時下班］，我的感受是［？］。');
  assert.equal(d.complete, false);
});

test('stuckFromFindings：依優先序把線索轉成卡點，低於門檻不算', () => {
  const f = [
    { ruleId: 'OVERGENERALIZE', severity: 0.6, slots: { S: '我總是被忽略' }, spans: [] },
    { ruleId: 'GOAL_CONFLICT', severity: 0.5, slots: { A: '甲', B: '乙' }, spans: [] },
  ];
  assert.equal(stuckFromFindings(f).kind, 'CONFLICT');
  assert.equal(stuckFromFindings([{ ruleId: 'MINDREAD', severity: 0.1, slots: { S: 'x' }, spans: [] }]), null);
});
