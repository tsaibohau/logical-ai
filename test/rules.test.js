import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, runRules, selectFindings, CONFIG, clauseAt } from '../src/rules.js';
import { buildLexicon, emptyState } from '../src/lexicon.js';
import { tokenize } from '../src/tokenize.js';

const run = (ruleId, text, state = emptyState()) => {
  const tk = tokenize(text, buildLexicon(state));
  return RULES[ruleId](tk.tokens, tk.sentences, state);
};
const above = (fs) => fs.filter((f) => f.severity >= CONFIG.threshold);

test('OVERGENERALIZE：絕對詞且無次數', () => {
  const f = above(run('OVERGENERALIZE', '我總是被忽略。'));
  assert.equal(f.length, 1);
  assert.equal(f[0].slots.X, '總是');
  assert.match(f[0].note, /總是/);
});
test('OVERGENERALIZE：同段有數字就不觸發', () => {
  assert.equal(run('OVERGENERALIZE', '我總是遲到，這個月遲到了八次。').length, 0);
});
test('OVERGENERALIZE：「不是每次」不算', () => {
  assert.equal(run('OVERGENERALIZE', '他不是每次都這樣。').filter((f) => f.slots.X === '每次').length, 0);
});

test('CAUSAL_JUMP：短因短果、無中介', () => {
  const f = above(run('CAUSAL_JUMP', '因為他遲到，所以我被罵。'));
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].slots.A, f[0].slots.B], ['他遲到', '我被罵']);
});
test('CAUSAL_JUMP：只有時間先後', () => {
  const f = above(run('CAUSAL_JUMP', '自從搬到台北之後，我的人生就變得很不順，都是因為這個城市的關係。'));
  assert.equal(f.length, 1);
  assert.ok(f[0].flags.timeOnly);
});
test('CAUSAL_JUMP：有中介說明就不觸發', () => {
  assert.equal(run('CAUSAL_JUMP', '因為這個專案的截止日提前了兩週，所以這個專案的測試時間被壓縮。').length, 0);
});

test('UNDEFINED_TERM：抽象評價被拿來推論', () => {
  const f = run('UNDEFINED_TERM', '我覺得自己很失敗，所以應該放棄。');
  assert.equal(f[0].slots.X, '失敗');
});
test('UNDEFINED_TERM：單純描述評價不追問', () => {
  assert.equal(run('UNDEFINED_TERM', '我覺得自己很失敗。').length, 0);
});
test('CAUSAL_JUMP：「所以」接自己的安排是正常手段推論', () => {
  assert.equal(run('CAUSAL_JUMP', '我下個月要搬家，所以這週末先打包書房。').length, 0);
});
test('OVERGENERALIZE：「一定」「根本」是語氣，不算以偏概全', () => {
  assert.equal(run('OVERGENERALIZE', '這段關係根本就是錯的。').length, 0);
});
test('GOAL_CONFLICT：已寫出取捨就不算衝突', () => {
  assert.equal(run('GOAL_CONFLICT', '我想換工作，但是我也想留在台北，所以只找台北的職缺。').length, 0);
});
test('UNDEFINED_TERM：/def 後不再觸發', () => {
  const st = { defs: { 失敗: { text: '連續三個月收入低於三萬', history: [] } }, tags: {} };
  assert.equal(run('UNDEFINED_TERM', '我覺得自己很失敗。', st).length, 0);
});
test('UNDEFINED_TERM：句中有數字不觸發', () => {
  assert.equal(run('UNDEFINED_TERM', '月收入五萬算成功。').length, 0);
});

test('FALSE_BINARY：要嘛…要嘛', () => {
  const f = run('FALSE_BINARY', '我要嘛辭職，要嘛繼續忍。');
  assert.deepEqual([f[0].slots.A, f[0].slots.B], ['辭職', '繼續忍']);
});
test('FALSE_BINARY：只能…不然就', () => {
  const f = run('FALSE_BINARY', '我只能考上公務員，不然就完了。');
  assert.deepEqual([f[0].slots.A, f[0].slots.B], ['考上公務員', '完了']);
});
test('FALSE_BINARY：已列出第三個選項不觸發', () => {
  assert.equal(run('FALSE_BINARY', '我只能辭職或轉調，還可以先請假。').length, 0);
});

test('MINDREAD：無依據', () => {
  const f = above(run('MINDREAD', '老闆覺得我不夠認真。'));
  assert.equal(f.length, 1);
});
test('MINDREAD：有「他說」依據不觸發', () => {
  assert.equal(run('MINDREAD', '老闆覺得我不夠認真，他說我上週報告遲交兩次。').length, 0);
});

test('EMOTION_AS_FACT：情緒與結論同句', () => {
  const f = above(run('EMOTION_AS_FACT', '我好煩，我一定是個失敗的人。'));
  assert.equal(f[0].slots.E, '好煩');
  assert.equal(f[0].slots.C, '我一定是個失敗的人');
});
test('EMOTION_AS_FACT：情緒單獨出現不觸發', () => {
  assert.equal(run('EMOTION_AS_FACT', '我今天很焦慮。').length, 0);
});

test('GOAL_CONFLICT：兩個目標以轉折連接', () => {
  const f = above(run('GOAL_CONFLICT', '我想要升遷，但是我也想準時下班。'));
  assert.deepEqual([f[0].slots.A, f[0].slots.B], ['升遷', '準時下班']);
});
test('GOAL_CONFLICT：只有一個目標不觸發', () => {
  assert.equal(run('GOAL_CONFLICT', '我想要升遷，但是很難。').length, 0);
});

test('selectFindings：最多 2 項、規則不重複、低於門檻不選', () => {
  const fs = [
    { ruleId: 'A', severity: 0.9 }, { ruleId: 'A', severity: 0.8 },
    { ruleId: 'B', severity: 0.5 }, { ruleId: 'C', severity: 0.4 },
  ];
  assert.deepEqual(selectFindings(fs).map((f) => f.ruleId), ['A', 'B']);
  assert.deepEqual(selectFindings([{ ruleId: 'A', severity: 0.1 }]), []);
});

test('runRules 依 severity 排序，severity 在 0～1', () => {
  const tk = tokenize('我好煩，大家都覺得我很廢，我永遠不會成功。', buildLexicon());
  const fs = runRules(tk.tokens, tk.sentences, emptyState());
  for (let i = 1; i < fs.length; i++) assert.ok(fs[i - 1].severity >= fs[i].severity);
  for (const f of fs) assert.ok(f.severity >= 0 && f.severity <= 1);
});

test('每個 finding 的 spans 對得回原文', () => {
  const text = '我總是被忽略，因為我不夠好，所以大家覺得我沒用。';
  const tk = tokenize(text, buildLexicon());
  for (const f of runRules(tk.tokens, tk.sentences, emptyState())) {
    for (const s of f.spans) assert.equal(text.slice(s.start, s.end), s.text);
  }
});

test('clauseAt', () => {
  const tk = tokenize('甲乙，丙丁戊。', buildLexicon());
  assert.equal(clauseAt(tk.sentences[0], 4).text, '丙丁戊');
});

test('DEF_MISMATCH：用另一套依據證明已定義的詞', () => {
  const st = { defs: { 成功: { text: '營收翻倍', history: [] } }, tags: {} };
  const f = run('DEF_MISMATCH', 'APP 下載量暴增300%，這證明我們的產品策略極為成功。', st);
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].slots.X, f[0].slots.D], ['成功', '營收翻倍']);
});
test('DEF_MISMATCH：依據符合定義、或子句沒有依據時不觸發', () => {
  const st = { defs: { 成功: { text: '營收翻倍', history: [] } }, tags: {} };
  assert.equal(run('DEF_MISMATCH', '今年營收翻倍，所以算成功。', st).length, 0);
  assert.equal(run('DEF_MISMATCH', '我覺得很成功，今年下載量三萬。', st).length, 0);
});
test('CAUSAL_JUMP：檢查句中每個因果詞，「只要…就一定」視為必然化', () => {
  const f = above(run('CAUSAL_JUMP', '下載量激增是因為我們投放了廣告，因此只要再加倍投放廣告，淨利潤就一定能翻倍。'));
  assert.equal(f.length, 1);
  assert.ok(f[0].flags.certain);
  assert.deepEqual([f[0].slots.A, f[0].slots.B], ['再加倍投放廣告', '淨利潤就一定能翻倍']);
});
