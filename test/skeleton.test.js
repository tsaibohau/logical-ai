import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSkeleton } from '../src/skeleton.js';
import { buildLexicon } from '../src/lexicon.js';
import { tokenize } from '../src/tokenize.js';

const sk = (text, state) => {
  const tk = tokenize(text, buildLexicon(state));
  return pickSkeleton(text, tk.tokens, tk.sentences);
};

test('取含數字與時間、無情緒的原句', () => {
  const r = sk('我很焦慮。上週我加班四天，每天到十點。');
  assert.ok(r.found);
  assert.ok(r.text.includes('加班四天'));
});
test('資訊量最高者優先', () => {
  const r = sk('我昨天去上班。上週一到週五我總共加班了十二小時。');
  assert.equal(r.text, '上週一到週五我總共加班了十二小時');
});
test('排除情緒／絕對／讀心／義務', () => {
  const r = sk('我昨天一定很煩。');
  assert.equal(r.found, false);
});
test('子句層級：避開抽象評價的子句', () => {
  const r = sk('我上個月寄了二十份履歷，但我覺得自己不夠努力。');
  assert.equal(r.text, '我上個月寄了二十份履歷');
});
test('無候選：列出前三個未定義的抽象詞', () => {
  const r = sk('我想要成功、幸福、有意義，還要優秀。');
  assert.equal(r.found, false);
  assert.equal(r.text, '無可確認事實。尚未定義：『成功』、『幸福』、『有意義』');
});
test('已定義的詞不列入尚未定義', () => {
  const r = sk('我想要成功和幸福。', { defs: { 成功: { text: '年收入百萬', history: [] } }, tags: {} });
  assert.equal(r.text, '無可確認事實。尚未定義：『幸福』');
});
