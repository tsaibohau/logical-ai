import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit, compareTurns } from '../src/audit.js';
import { emptyState } from '../src/lexicon.js';
import { explainedBy, skeletonOk, userSources } from './helpers.js';

test('全流程輸出三區塊與 trace', () => {
  const r = audit('我每天都很努力工作，但是老闆覺得我不夠認真。我總是被忽略。');
  assert.ok(r.skeleton);
  assert.ok(r.flaws.length >= 1 && r.flaws.length <= 2);
  assert.ok(r.questions.length >= 1 && r.questions.length <= 2);
  assert.ok(r.trace.some((t) => t.section === 'flaw'));
  for (const t of r.trace) for (const s of t.spans) assert.equal(r.body.slice(s.start, s.end), s.text);
});

test('無漏洞：輸出「未發現實質漏洞」且只有一題', () => {
  const r = audit('上週我跑步三次，每次五公里。');
  assert.equal(r.noFlaw, true);
  assert.equal(r.flawText, '未發現實質漏洞');
  assert.equal(r.questions.length, 1);
  assert.equal(r.skeleton.text, '上週我跑步三次');
});

test('指令行不被審計，狀態向後帶', () => {
  const r1 = audit('/def 努力 = 每週運動三次\n我很努力。');
  assert.equal(r1.body, '我很努力。');
  assert.ok(r1.state.defs['努力']);
  assert.ok(!r1.findings.some((f) => f.ruleId === 'UNDEFINED_TERM' && f.slots.X === '努力'));
  assert.ok(r1.trace.some((t) => t.section === 'defined' && t.def === '每週運動三次'));
  const r2 = audit('我還是很努力。', r1.state, { previous: r1 });
  assert.ok(!r2.findings.some((f) => f.ruleId === 'UNDEFINED_TERM' && f.slots.X === '努力'));
});

test('只有指令時不輸出審計區塊', () => {
  const r = audit('/help');
  assert.equal(r.empty, true);
  assert.equal(r.messages.length, 1);
});

test('跨輪：同詞類別改變、定義漂移', () => {
  const r1 = audit('我覺得很擺爛。', emptyState());
  const r2 = audit('/tag 擺爛 = EMOTION\n我覺得很擺爛。', r1.state, { previous: r1 });
  assert.ok(r2.crossTurn.some((n) => n.kind === 'retag' && n.word === '擺爛'));
  const r3 = audit('/def 努力 = 每週運動三次', r2.state);
  const r4 = audit('/def 努力 = 每天讀書', r3.state, { previous: r3 });
  assert.ok(r4.crossTurn.some((n) => n.kind === 'drift'));
  assert.deepEqual(compareTurns(null, {}, []), []);
});

test('輸出可由模板與原文片段完整解釋', () => {
  const samples = [
    '我好煩，我一定是個失敗的人。',
    '我要嘛辭職，要嘛繼續忍。',
    '因為他遲到，所以我被罵。',
    '我想要升遷，但是我也想準時下班。',
  ];
  for (const s of samples) {
    const r = audit(s);
    for (const f of r.flaws) assert.ok(explainedBy(f.note, userSources(r)), f.note);
    for (const q of r.questions) assert.ok(explainedBy(q.text, userSources(r)), q.text);
    assert.ok(skeletonOk(r.skeleton, r.body), r.skeleton.text);
  }
});

test('Segmenter 關閉時仍可運作', () => {
  const r = audit('我總是被忽略。', emptyState(), { useSegmenter: false });
  assert.equal(r.flaws[0].ruleId, 'OVERGENERALIZE');
});

test('回歸：使用者回報的案例（已定義的詞不被追問、定義被拿來比對）', () => {
  const input = '/def 成功 = 營收翻倍\n/def 核心指標 = APP 下載量\n我們公司上個季度的 APP 下載量比去年同期暴增300%，這證明我們的產品策略極為成功。下載量激增是因為我們投放了百萬級別的免費送咖啡廣告，因此只要下個季度再加倍投放廣告，公司的淨利潤就一定能翻倍。';
  const r = audit(input);
  assert.equal(r.skeleton.text, '我們公司上個季度的 APP 下載量比去年同期暴增300%');
  assert.deepEqual(r.flaws.map((f) => f.ruleId).sort(), ['CAUSAL_JUMP', 'DEF_MISMATCH']);
  assert.ok(!r.messages.some((m) => m.data?.kind === 'vague' && m.data.word === '成功'), '「營收翻倍」是可操作定義');
  for (const q of r.questions) assert.ok(explainedBy(q.text, userSources(r)), q.text);
});

test('無漏洞時的邊界提問不挑已定義的詞', () => {
  const r = audit('/def 成功 = 營收翻倍\n我想要成功，也想要快樂。');
  for (const q of r.questions) assert.ok(!q.slots.X || q.slots.X !== '成功', q.text);
});
