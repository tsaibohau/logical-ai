import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSafety } from '../src/safety.js';

test('high：直接提到結束生命', () => {
  const s = detectSafety('有時候覺得活不下去。');
  assert.equal(s.level, 'high');
  assert.equal(s.paused, true);
  assert.equal(s.quote, '你寫到「有時候覺得活不下去」。');
});
test('concern：期待受傷，引用依嚴重度挑選', () => {
  const s = detectSafety('我想抽自己兩巴掌。後來我發現自己在期待受傷。');
  assert.equal(s.level, 'concern');
  assert.equal(s.paused, false);
  assert.match(s.quote, /期待受傷/);
});
test('一般文字不觸發', () => {
  assert.equal(detectSafety('最近工作很累，常常加班。'), null);
  assert.equal(detectSafety(''), null);
});
test('固定求助資訊包含 1925', () => {
  assert.match(detectSafety('撐不下去了').body, /1925/);
});

test('期待送醫也算安全提示', () => {
  assert.equal(detectSafety('被熱水燙到期待送醫').level, 'concern');
});
