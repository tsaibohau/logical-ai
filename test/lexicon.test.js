import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLexicon, CATEGORIES, categoriesOf } from '../src/lexicon.js';
import { lexicon as BUILTIN } from '../src/data.js';
import { tokenize } from '../src/tokenize.js';

test('內建詞典每類至少 15 詞，且只有固定類別', () => {
  assert.deepEqual(Object.keys(BUILTIN).sort(), [...CATEGORIES].sort());
  for (const c of CATEGORIES) assert.ok(BUILTIN[c].length >= 15, c);
});

test('內建詞與不連續詞都被編入', () => {
  const lex = buildLexicon();
  assert.deepEqual(categoriesOf(lex, '總是'), ['ABSOLUTE']);
  assert.ok(lex.pairs.some((p) => p.raw === '要嘛…要嘛'));
});

test('/tag 優先於內建，且取代原類別', () => {
  const lex = buildLexicon({ defs: {}, tags: { 擺爛: 'EMOTION', 努力: 'VAGUE' } });
  assert.deepEqual(categoriesOf(lex, '擺爛'), ['EMOTION']);
  assert.deepEqual(categoriesOf(lex, '努力'), ['VAGUE']);
});

test('/def 優先於 /tag：加上 DEFINED 並帶出定義', () => {
  const lex = buildLexicon({ defs: { 努力: { text: '每週運動三次', history: [] } }, tags: { 努力: 'VAGUE' } });
  const e = lex.words.get('努力');
  assert.ok(e.tags.includes('DEFINED'));
  assert.ok(e.tags.includes('VAGUE'));
  assert.equal(e.def, '每週運動三次');
  const t = tokenize('我很努力', lex).tokens.find((x) => x.text === '努力');
  assert.equal(t.def, '每週運動三次');
});

test('自訂詞可以是新詞，並影響最長匹配', () => {
  const lex = buildLexicon({ defs: {}, tags: { 躺平族: 'ABSTRACT' } });
  const r = tokenize('我是躺平族', lex);
  assert.ok(r.tokens.some((t) => t.text === '躺平族' && t.tags.includes('ABSTRACT')));
});

test('PLAIN 詞擋住誤切（「我覺得」不是讀心）', () => {
  const lex = buildLexicon();
  const r = tokenize('我覺得我很失敗', lex);
  assert.ok(!r.tokens.some((t) => t.tags.includes('MINDREAD')));
});
