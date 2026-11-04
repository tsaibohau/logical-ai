import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, slotsOf, buildQuestions, hashString } from '../src/questions.js';
import { templates } from '../src/data.js';
import { RULE_IDS } from '../src/rules.js';
import { buildLexicon } from '../src/lexicon.js';
import { tokenize } from '../src/tokenize.js';

test('每種漏洞至少 3 個提問模板', () => {
  for (const id of RULE_IDS) assert.ok(templates.questions[id].length >= 3, id);
  for (const b of Object.values(templates.blindspots)) assert.ok(b.questions.length >= 2);
});

test('所有模板都是封閉或半封閉句式（含問號且有限定語）', () => {
  const closed = /(幾|哪一|哪個|是否|嗎？|或|數字|標準|門檻|界線|二選一|還是|多少|什麼程度|一個具體|一項|條件)/;
  for (const list of [...Object.values(templates.questions), ...Object.values(templates.blindspots).map((b) => b.questions)]) {
    for (const t of list) {
      assert.match(t, /？/, t);
      assert.match(t, closed, t);
      assert.ok(slotsOf(t).length >= 1, `模板必須引用使用者的詞：${t}`);
    }
  }
});

test('renderTemplate：缺欄位回傳 null', () => {
  assert.equal(renderTemplate('『{A}』和『{B}』', { A: '甲' }), null);
  assert.equal(renderTemplate('『{A}』和『{B}』', { A: '甲', B: '乙' }), '『甲』和『乙』');
});

test('同一次輸出兩題不同規則；同輸入結果穩定', () => {
  const sel = [
    { ruleId: 'MINDREAD', slots: { X: '覺得我', S: '老闆覺得我不夠認真' }, spans: [] },
    { ruleId: 'MINDREAD', slots: { X: '覺得我', S: '老闆覺得我不夠認真' }, spans: [] },
    { ruleId: 'OVERGENERALIZE', slots: { X: '總是', S: '我總是被忽略' }, spans: [] },
  ];
  const q1 = buildQuestions(sel, [], 'x', { max: 2 });
  assert.deepEqual(q1.map((q) => q.ruleId), ['MINDREAD', 'OVERGENERALIZE']);
  assert.deepEqual(buildQuestions(sel, [], 'x', { max: 2 }), q1);
  assert.equal(buildQuestions(sel, [], 'x').length, 1, '預設只問最嚴重的斷點');
  assert.equal(hashString('abc'), hashString('abc'));
});

test('FALSE_BINARY 只有 A 時改用單欄模板', () => {
  const q = buildQuestions([{ ruleId: 'FALSE_BINARY', slots: { X: '只能', A: '辭職', S: '我只能辭職' }, spans: [] }], [], 'seed');
  assert.ok(!q[0].text.includes('{'));
  assert.ok(q[0].text.includes('辭職') || q[0].text.includes('只能'));
});

test('沒有斷點時不出題', () => {
  assert.deepEqual(buildQuestions([], [], '任何文字'), []);
});
