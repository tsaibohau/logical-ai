import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tokenize, splitSentences, extractNumbers, extractTimeWords, extractNegations, matchNumberAt,
} from '../src/tokenize.js';

const lex = {
  words: new Map([
    ['都', { tags: ['ABSOLUTE'], weight: 0.5, priority: 1 }],
    ['一定', { tags: ['ABSOLUTE'], weight: 1, priority: 1 }],
    ['一定要', { tags: ['OBLIGATION'], weight: 1, priority: 1 }],
    ['不夠', { tags: ['ABSTRACT'], weight: 1, priority: 1 }],
    ['認真', { tags: ['ABSTRACT'], weight: 1, priority: 1 }],
    ['覺得我', { tags: ['MINDREAD'], weight: 1, priority: 1 }],
  ]),
  pairs: [{ parts: ['要嘛', '要嘛'], tags: ['BINARY'], weight: 1, raw: '要嘛…要嘛' }],
  maxLen: 3,
};

for (const useSegmenter of [true, false]) {
  const label = useSegmenter ? 'Segmenter' : '退化模式';

  test(`[${label}] 切句並保留原文位置`, () => {
    const text = '我很累。真的嗎？\n第二行；第三句';
    const s = splitSentences(text, { useSegmenter });
    assert.deepEqual(s.map((x) => x.text), ['我很累。', '真的嗎？', '第二行；', '第三句']);
    for (const x of s) assert.equal(text.slice(x.start, x.end), x.text);
  });

  test(`[${label}] 空行切段落`, () => {
    const s = splitSentences('第一段。\n\n第二段。', { useSegmenter });
    assert.deepEqual(s.map((x) => x.paraIdx), [0, 1]);
  });

  test(`[${label}] 最長匹配不依賴 Segmenter 詞界`, () => {
    const text = '老闆覺得我不夠認真，我一定要改。';
    const r = tokenize(text, lex, { useSegmenter });
    const tagged = r.tokens.filter((t) => !t.tags.includes('WORD') && !t.tags.includes('PUNCT'));
    assert.deepEqual(tagged.map((t) => t.text), ['覺得我', '不夠', '認真', '一定要']);
    assert.equal(tagged.find((t) => t.text === '一定要').tags[0], 'OBLIGATION');
    for (const t of r.tokens) assert.equal(text.slice(t.start, t.end), t.text);
  });

  test(`[${label}] 不連續詞「要嘛…要嘛」`, () => {
    const r = tokenize('我要嘛辭職要嘛忍耐。', lex, { useSegmenter });
    const b = r.tokens.filter((t) => t.tags.includes('BINARY'));
    assert.equal(b.length, 2);
    assert.equal(b[0].pairId, b[1].pairId);
    assert.deepEqual([b[0].start, b[1].start], [1, 5]);
  });

  test(`[${label}] token 涵蓋所有非空白字元且不重疊`, () => {
    const text = '我上週跑了三次步，大家都覺得我很認真。';
    const r = tokenize(text, lex, { useSegmenter });
    let pos = 0;
    for (const t of r.tokens) {
      assert.ok(t.start >= pos, `重疊於 ${t.text}`);
      pos = t.end;
    }
    const covered = r.tokens.map((t) => t.text).join('');
    assert.equal(covered, text.replace(/\s/g, ''));
  });
}

test('數字：阿拉伯、中文、單位', () => {
  assert.deepEqual(extractNumbers('我跑了三次，存了一百萬，30%的時間').map((n) => n.text), ['三次', '一百萬', '30%']);
  assert.deepEqual(extractNumbers('月收入 5 萬').map((n) => n.text), ['5 萬']);
});

test('數字：排除「一定」「一個」「萬一」等非數量用法', () => {
  assert.deepEqual(extractNumbers('我一定是一個失敗的人，萬一呢').map((n) => n.text), []);
  assert.equal(matchNumberAt('十分努力', 0), null);
  assert.deepEqual(matchNumberAt('三個月', 0).tags, ['NUMBER', 'TIME']);
});

test('時間詞：字表與數字時間', () => {
  assert.deepEqual(extractTimeWords('昨天和上週，還有三個月、每天').map((t) => t.text), ['昨天', '上週', '三個月', '每天']);
});

test('否定詞', () => {
  assert.deepEqual(extractNegations('我沒有去，也不是不想').map((t) => t.text), ['沒有', '不是', '不']);
});

test('tokenize 匯出 numbers/times/negations', () => {
  const r = tokenize('我昨天沒有跑三公里。', lex);
  assert.deepEqual(r.numbers.map((t) => t.text), ['三公里']);
  assert.deepEqual(r.times.map((t) => t.text), ['昨天']);
  assert.deepEqual(r.negations.map((t) => t.text), ['沒有']);
});

test('Intl.Segmenter 不存在時退化', () => {
  const saved = Intl.Segmenter;
  try {
    delete Intl.Segmenter;
    const r = tokenize('我很累。我不夠認真。', lex);
    assert.equal(r.sentences.length, 2);
    assert.ok(r.tokens.some((t) => t.text === '不夠'));
  } finally {
    Intl.Segmenter = saved;
  }
});
