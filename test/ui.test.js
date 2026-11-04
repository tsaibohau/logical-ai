import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, highlightHtml, marksFromResult, normalizeState, loadState, saveState, STORAGE_KEY } from '../src/ui.js';
import { audit } from '../src/audit.js';
import { emptyState } from '../src/lexicon.js';

test('escapeHtml', () => {
  assert.equal(escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('highlightHtml：重疊標記、跳脫原文', () => {
  const html = highlightHtml('<我>總是很煩', [
    { start: 3, end: 5, cls: 'm-flaw', title: 'A' },
    { start: 4, end: 7, cls: 'm-question', title: 'B' },
  ]);
  assert.equal(html, '&lt;我&gt;<mark class="m-flaw" title="A">總</mark><mark class="m-flaw m-question" title="A\nB">是</mark><mark class="m-question" title="B">很煩</mark>');
});

test('marksFromResult：定義詞帶出定義內容', () => {
  const r = audit('/def 努力 = 每週運動三次\n我很努力，但老闆覺得我不夠認真。');
  const marks = marksFromResult(r);
  assert.ok(marks.some((m) => m.cls === 'm-defined' && m.title.includes('每週運動三次')));
  assert.ok(marks.some((m) => m.cls === 'm-flaw'));
  for (const m of marks) assert.equal(r.body.slice(m.start, m.end), m.text);
});

test('normalizeState：驗證匯入格式', () => {
  const s = normalizeState({ defs: { 努力: { text: '每週運動三次' } }, tags: { 擺爛: 'ABSTRACT' } });
  assert.equal(s.defs['努力'].text, '每週運動三次');
  assert.throws(() => normalizeState({ tags: { 擺爛: 'NOPE' } }));
  assert.throws(() => normalizeState(null));
});

test('loadState / saveState 使用注入的 storage，壞資料不炸', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadState(storage), emptyState());
  saveState(storage, { defs: { 好: { text: '三天內回覆', history: [] } }, tags: {} });
  assert.equal(loadState(storage).defs['好'].text, '三天內回覆');
  mem.set(STORAGE_KEY, '{壞掉');
  assert.deepEqual(loadState(storage), emptyState());
  assert.equal(saveState({ setItem() { throw new Error('quota'); } }, emptyState()), false);
});
