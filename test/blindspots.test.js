import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectBlindspot } from '../src/blindspots.js';
import { buildLexicon } from '../src/lexicon.js';
import { tokenize } from '../src/tokenize.js';

const bs = (text) => detectBlindspot(text, tokenize(text, buildLexicon()).tokens);

test('代價未寫：有決定、沒寫要放棄什麼', () => {
  const b = bs('我希望今年存到二十萬，所以每個月固定存一萬七。');
  assert.equal(b.ruleId, 'COST_UNSTATED');
  assert.equal(b.slots.S, '每個月固定存一萬七');
});
test('已寫到代價時，改看改變條件', () => {
  const b = bs('我決定辭職，雖然會少一份收入。');
  assert.equal(b.ruleId, 'NO_REVISION');
});
test('代價與條件都寫了：沒有盲點', () => {
  assert.equal(bs('我決定辭職，雖然會少一份收入，如果三個月內找不到工作就去打工。'), null);
});
test('只看一邊：意見只列同一方向的理由', () => {
  const b = bs('我覺得這份工作還不錯，薪水準時發，同事也好相處。');
  assert.equal(b.ruleId, 'ONE_SIDED');
});
test('有反方向的考量就不算只看一邊', () => {
  assert.equal(bs('我覺得這份工作還不錯，薪水準時發，但是通勤要一小時。'), null);
});
test('必然的預測沒有寫改變條件', () => {
  const b = bs('這個方案一定會成功。');
  assert.equal(b.ruleId, 'NO_REVISION');
});
test('單純的事實與動作沒有盲點', () => {
  for (const t of ['我下個月要搬家，所以這週末先打包書房。', '我很努力準備考試，最後考了九十分，我很開心。', '上週我跑步三次。']) {
    assert.equal(bs(t), null, t);
  }
});
test('盲點的 spans 對得回原文', () => {
  const text = '我想換工作，但是我也想留在台北，所以只找台北的職缺。';
  const b = bs(text);
  for (const s of b.spans) assert.equal(text.slice(s.start, s.end), s.text);
});
