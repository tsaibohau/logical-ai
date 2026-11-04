import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audit, compareTurns } from '../src/audit.js';
import { emptyState } from '../src/lexicon.js';
import { unexplainedOutputs } from './helpers.js';

/** 模擬多輪對話，回傳每一輪的結果。 */
function converse(lines, state = emptyState()) {
  const out = [];
  let prev = null;
  for (const l of lines) {
    const r = audit(l, state, { previous: prev });
    out.push(r);
    prev = r;
    state = r.state;
  }
  return out;
}

test('全流程：草稿、卡點、一題，且 trace 對得回原文', () => {
  const r = audit('我每天都很努力工作，但是老闆覺得我不夠認真。我總是被忽略。');
  const cl = r.clarify;
  assert.match(cl.draft.text, /^我想要［.+］，但是［.+］，我的感受是［.+］。$/);
  assert.equal(cl.stuck.kind, 'OTHERS_VIEW');
  assert.equal(r.questions.length, 1);
  for (const t of r.trace) for (const s of t.spans) assert.equal(r.body.slice(s.start, s.end), s.text);
});

test('不挑錯：沒有困擾的事實與安排，不出題', () => {
  for (const s of [
    '我下個月要搬家，所以這週末先打包書房。',
    '因為明天早上九點要開會，所以我今晚十一點前睡覺。',
    '上週我跑步三次，每次五公里。',
  ]) {
    const r = audit(s);
    assert.equal(r.questions.length, 0, `${s} → ${r.questions.map((q) => q.text)}`);
    assert.equal(r.clarify.troubled, false, s);
  }
});

test('說不清楚的人：一輪一輪補齊草稿，確認後停止追問', () => {
  const rs = converse([
    '我也不知道怎麼說，就是覺得很累，每天上班都提不起勁。',
    '昨天又加班到十點。',
    '我希望可以準時下班。',
    '專案一直被插單。',
    '對',
  ]);
  assert.equal(rs[0].clarify.question.id, 'ASK_EVENT', '先問發生了什麼');
  assert.equal(rs[1].clarify.question.id, 'ASK_WANT', '再問想要什麼');
  assert.equal(rs[2].clarify.question.id, 'ASK_BLOCK', '再問擋住的是什麼');
  assert.equal(rs[3].clarify.question.id, 'CONFIRM', '草稿齊了就確認');
  assert.equal(rs[3].clarify.draft.text, '我想要［可以準時下班］，但是［專案一直被插單］，我的感受是［很累］。');
  assert.equal(rs[4].clarify.confirmed, true);
  assert.equal(rs[4].questions.length, 0);
  rs.forEach((r, i) => assert.deepEqual(unexplainedOutputs(r, rs.slice(0, i).map((x) => x.body)), []));
});

test('回答填進被問的那一格', () => {
  const rs = converse(['我想要升遷。', '主管一直把機會給別人。']);
  assert.equal(rs[0].clarify.question.id, 'ASK_BLOCK');
  assert.equal(rs[1].clarify.slots.BLOCK[0].text, '主管一直把機會給別人');
});

test('同一題不重複問', () => {
  const rs = converse(['最近好煩。', '不知道。', '就是很煩。']);
  const ids = rs.map((r) => r.clarify.question && r.clarify.question.id).filter(Boolean);
  assert.equal(new Set(ids).size, ids.length, ids.join(','));
});

test('原本的邏輯規則變成線索：衝突就是卡點', () => {
  const r = audit('我想要升遷，但是我也想準時下班。');
  assert.equal(r.clarify.stuck.kind, 'CONFLICT');
  assert.equal(r.clarify.draft.parts.W, '升遷');
  assert.equal(r.clarify.draft.parts.B, '準時下班');
  assert.match(r.questions[0].text, /只能先顧一個/);
});

test('「不想」不是想要', () => {
  const r = audit('最近好煩，什麼都不想做。');
  assert.equal(r.clarify.draft.filled.W, false);
});

test('兩個感受互相描述，不當成卡點', () => {
  const r = audit('就是覺得很累，每天上班都提不起勁。');
  assert.equal(r.clarify.stuck, null);
});

test('指令行不被整理，狀態向後帶', () => {
  const r1 = audit('/def 努力 = 每週運動三次\n我很努力。');
  assert.equal(r1.body, '我很努力。');
  assert.ok(r1.state.defs['努力']);
  assert.ok(r1.trace.some((t) => t.section === 'defined' && t.def === '每週運動三次'));
  const r2 = audit('我還是很努力。', r1.state, { previous: r1 });
  assert.ok(r2.state.defs['努力']);
});

test('只有指令時沿用上一輪的整理', () => {
  const r1 = audit('我想要升遷。');
  const r2 = audit('/help', r1.state, { previous: r1 });
  assert.equal(r2.empty, true);
  assert.equal(r2.clarify, r1.clarify);
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

test('回歸：已定義的詞拿來比對標準', () => {
  const input = '/def 成功 = 營收翻倍\n我們公司上個季度的 APP 下載量比去年同期暴增300%，這證明我們的產品策略極為成功。下載量激增是因為我們投放了百萬級別的免費送咖啡廣告，因此只要下個季度再加倍投放廣告，公司的淨利潤就一定能翻倍。';
  const r = audit(input);
  assert.equal(r.clarify.stuck.kind, 'STANDARD');
  assert.deepEqual(unexplainedOutputs(r), []);
});

test('Segmenter 關閉時仍可運作', () => {
  const r = audit('我想要升遷，但是我也想準時下班。', emptyState(), { useSegmenter: false });
  assert.equal(r.clarify.stuck.kind, 'CONFLICT');
});

test('回歸：長篇敘述（使用者回報）——不湊錯想要，抓到「知道卻做不到」，並顯示安全提示', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('./fixtures/long-case.txt', import.meta.url), 'utf8');
  const r = audit(text);
  const cl = r.clarify;
  assert.equal(r.safety.level, 'concern');
  assert.match(r.safety.quote, /期待受傷/);
  assert.equal(cl.draft.filled.W, false, `不該有想要：${cl.draft.parts.W}`);
  assert.ok(!cl.slots.WANT.some((x) => /抽自己|晚餐|採買/.test(x.text)));
  assert.notEqual(cl.stuck.kind, 'CONFLICT');
  assert.equal(cl.stuck.kind, 'KNOW_BUT_CANT');
  assert.match(cl.draft.parts.B, /沒辦法開口/);
  assert.ok(cl.slots.WORRY.some((x) => x.text.includes('怎麼辦')));
  assert.equal(r.questions.length, 1);
  assert.deepEqual(unexplainedOutputs(r), []);
});

test('安全提示：寫到想結束生命時這一輪不追問', () => {
  const r = audit('我真的撐不下去了，有時候覺得不如死了算了。');
  assert.equal(r.safety.level, 'high');
  assert.equal(r.safety.paused, true);
  assert.equal(r.questions.length, 0);
});

test('安全提示：一般困擾不顯示', () => {
  assert.equal(audit('我想要升遷，但是我也想準時下班。').safety, null);
});

test('回歸：回報 #1（四輪長篇）——「想像」不是想要，回答進被問的格子，「不是…而是…」改寫重點', async () => {
  const { readFileSync } = await import('node:fs');
  const r1 = readFileSync(new URL('./fixtures/long-case.txt', import.meta.url), 'utf8');
  const rest = JSON.parse(readFileSync(new URL('./fixtures/report-1-rounds.json', import.meta.url), 'utf8'));
  const rs = converse([r1, ...rest]);
  // 第 2 輪：回答「最先做不出來的是哪一步」
  const c2 = rs[1].clarify;
  assert.ok(!c2.current.WANT.some((x) => x.text.includes('想像')), '「想像」不該當成想要');
  assert.match(c2.draft.parts.B, /發送邀請/);
  // 第 3 輪：「不是…而是 Y」，Y 成為想要，不再拿問題的框架「如果只能先動一個骨牌」當擋住
  const c3 = rs[2].clarify;
  assert.match(c3.draft.parts.W, /^回家把.*對不起.*講出來$/);
  assert.ok(!/骨牌/.test(c3.draft.parts.B), c3.draft.parts.B);
  assert.match(c3.draft.parts.B, /對不起.*擠不出來/);
  assert.notEqual(c3.question && c3.question.id, 'REJECTED');
  assert.equal(rs[2].safety.level, 'concern'); // 期待送醫
  assert.match(rs[3].clarify.draft.parts.F, /羞愧/);
  rs.forEach((r, i) => assert.deepEqual(unexplainedOutputs(r, rs.slice(0, i).map((x) => x.body)), []));
});

test('確認題回答「不是。…而是 Y」時，不再追問「除了…」，Y 當成想要', () => {
  const rs = converse(['上週主管退回我的報告，我想要升遷，但是我沒辦法準時交報告，覺得很累。', '是', ]);
  assert.ok(rs[1].clarify.confirmed);
  const rs2 = converse(['上週主管退回我的報告，我想要升遷，但是我沒辦法準時交報告，覺得很累。', '不是。不是報告，而是跟主管把話講開。']);
  const c = rs2[1].clarify;
  assert.equal(rs2[0].clarify.question.id, 'CONFIRM');
  assert.equal(c.draft.parts.W, '跟主管把話講開');
  assert.notEqual(c.draft.parts.B, '我沒辦法準時交報告');
  assert.notEqual(c.question && c.question.id, 'REJECTED');
  const rs3 = converse(['上週主管退回我的報告，我想要升遷，但是我沒辦法準時交報告，覺得很累。', '不是。']);
  assert.equal(rs3[1].clarify.question.id, 'REJECTED');
});
