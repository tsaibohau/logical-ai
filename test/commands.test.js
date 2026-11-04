import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInput, executeCommands, checkDefinition } from '../src/commands.js';
import { emptyState } from '../src/lexicon.js';

const run = (input, state = emptyState()) => {
  const p = parseInput(input);
  return { ...p, ...executeCommands(p.commands, state) };
};

test('指令行從本文移除，只認行首', () => {
  const p = parseInput('/def 努力 = 每週運動三次\n我很努力。\n這行有 /def 不算');
  assert.equal(p.commands.length, 1);
  assert.equal(p.body, '我很努力。\n這行有 /def 不算');
});

test('寬容解析：全形斜線、全形等號、前後空白', () => {
  const r = run('　／def　 努力 ＝  每週運動三次  ');
  assert.equal(r.state.defs['努力'].text, '每週運動三次');
  const r2 = run('/ＤＥＦ 認真=每天讀書兩小時');
  assert.equal(r2.state.defs['認真'].text, '每天讀書兩小時');
});

test('/def 可操作定義不警告', () => {
  const r = run('/def 努力 = 每週運動三次');
  assert.ok(r.state.defs['努力'].operational);
  assert.ok(!r.messages.some((m) => m.level === 'warn'));
});

test('/def 空泛定義：警告並列出抽象詞', () => {
  const r = run('/def 成功 = 過得幸福又有意義');
  const w = r.messages.find((m) => m.data?.kind === 'vague');
  assert.ok(w);
  assert.deepEqual(w.data.abstract, ['幸福', '有意義']);
  assert.equal(r.state.defs['成功'].operational, false);
});

test('/def 循環定義', () => {
  const r = run('/def 努力 = 很努力地做事');
  assert.ok(r.messages.some((m) => m.data?.kind === 'circular'));
});

test('/def 定義漂移：列出前後兩版', () => {
  const r1 = run('/def 努力 = 每週運動三次');
  const r2 = run('/def 努力 = 每天讀書一小時', r1.state);
  const d = r2.messages.find((m) => m.data?.kind === 'drift');
  assert.deepEqual([d.data.before, d.data.after], ['每週運動三次', '每天讀書一小時']);
  assert.deepEqual(r2.state.defs['努力'].history, ['每週運動三次']);
});

test('/def 原樣存字串，不補充', () => {
  const r = run('/def 好 = 我說好就好');
  assert.equal(r.state.defs['好'].text, '我說好就好');
});

test('/undef、/defs', () => {
  const r1 = run('/def 努力 = 每週運動三次\n/def 認真 = 每天讀書兩小時');
  const r2 = run('/undef 努力\n/defs', r1.state);
  assert.ok(!r2.state.defs['努力']);
  assert.match(r2.messages[1].text, /認真/);
  assert.equal(run('/undef 不存在').messages[0].level, 'error');
});

test('/tag 驗證類別、/untag', () => {
  const r = run('/tag 擺爛 = abstract\n/tag 某詞 = FOO');
  assert.equal(r.state.tags['擺爛'], 'ABSTRACT');
  assert.equal(r.messages[1].level, 'error');
  const r2 = run('/tag 擺爛 = EMOTION', r.state);
  assert.equal(r2.messages[0].data.kind, 'retag');
  const r3 = run('/untag 擺爛', r2.state);
  assert.ok(!r3.state.tags['擺爛']);
});

test('/reset 需二次確認', () => {
  const r1 = run('/def 努力 = 每週運動三次');
  const r2 = run('/reset', r1.state);
  assert.ok(r2.state.defs['努力']);
  assert.equal(r2.messages[0].data.kind, 'confirm-reset');
  const r3 = run('/reset 確認', r1.state);
  assert.deepEqual(r3.state, emptyState());
});

test('未知指令回報錯誤但不中斷', () => {
  const r = run('/foo bar\n/def 努力 = 每週運動三次');
  assert.equal(r.messages[0].level, 'error');
  assert.ok(r.state.defs['努力']);
});

test('/help', () => {
  assert.match(run('/help').messages[0].text, /\/def/);
});

test('executeCommands 不改動傳入的 state', () => {
  const s = emptyState();
  run('/def 努力 = 每週運動三次', s);
  assert.deepEqual(s, emptyState());
});

test('checkDefinition 認得時間與行為動詞', () => {
  assert.ok(checkDefinition('認真', '上課不遲到', emptyState()).operational);
  assert.ok(checkDefinition('穩定', '連續三個月', emptyState()).operational);
});
