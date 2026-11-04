import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate, slotsOf, buildQuestions, boundaryWord, hashString } from '../src/questions.js';
import { templates } from '../src/data.js';
import { RULE_IDS } from '../src/rules.js';
import { buildLexicon } from '../src/lexicon.js';
import { tokenize } from '../src/tokenize.js';

test('每種漏洞至少 3 個提問模板', () => {
  for (const id of RULE_IDS) assert.ok(templates.questions[id].length >= 3, id);
  assert.ok(templates.fallback.length >= 1);
});

test('所有模板都是封閉或半封閉句式（含問號且有限定語）', () => {
  const closed = /(幾|哪一|哪個|是否|嗎？|或|數字|標準|門檻|界線|二選一|還是|多少|什麼程度)/;
  for (const list of [...Object.values(templates.questions), templates.fallback]) {
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
  const q1 = buildQuestions(sel, [], 'x');
  assert.deepEqual(q1.map((q) => q.ruleId), ['MINDREAD', 'OVERGENERALIZE']);
  assert.deepEqual(buildQuestions(sel, [], 'x'), q1);
  assert.equal(hashString('abc'), hashString('abc'));
});

test('FALSE_BINARY 只有 A 時改用單欄模板', () => {
  const q = buildQuestions([{ ruleId: 'FALSE_BINARY', slots: { X: '只能', A: '辭職', S: '我只能辭職' }, spans: [] }], [], 'seed');
  assert.ok(!q[0].text.includes('{'));
  assert.ok(q[0].text.includes('辭職') || q[0].text.includes('只能'));
});

test('無漏洞時只出一題邊界問題，且引用使用者的詞', () => {
  const text = '我想讓生活更有意義。';
  const tk = tokenize(text, buildLexicon());
  const q = buildQuestions([], tk.tokens, text);
  assert.equal(q.length, 1);
  assert.equal(q[0].ruleId, 'BOUNDARY');
  assert.ok(q[0].text.includes('有意義'));
});

test('boundaryWord 在沒有詞典詞時取最長的中文詞', () => {
  const tk = tokenize('貓咪坐在窗台上', buildLexicon());
  const w = boundaryWord(tk.tokens);
  assert.ok(w && w.text.length >= 2);
});
