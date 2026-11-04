import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildReport, prepareReport, issueUrl, REPORT_MARKER, MAX_URL_LENGTH } from '../src/report.js';
import { audit } from '../src/audit.js';

function converse(lines) {
  const out = [];
  let prev = null;
  let state;
  for (const l of lines) { const r = audit(l, state, { previous: prev }); out.push(r); prev = r; state = r.state; }
  return out;
}

test('回報內容包含每一輪的輸入、草稿、卡點、問題與線索', () => {
  const rounds = converse(['我想要升遷，但是我也想準時下班。', '/help', '先顧升遷。']);
  const { title, body } = buildReport(rounds, { now: new Date('2026-11-04T00:00:00Z') });
  assert.match(title, /^\[回報\] 我想要升遷/);
  assert.ok(body.startsWith(REPORT_MARKER));
  assert.match(body, /輪數：3/);
  assert.match(body, /> 我想要升遷，但是我也想準時下班。/);
  assert.match(body, /卡點\*\*：CONFLICT/);
  assert.match(body, /問題\*\*：STUCK_CONFLICT/);
  assert.match(body, /線索\*\*：GOAL_CONFLICT/);
  assert.match(body, /指令訊息/);
  assert.match(body, /## 哪裡怪？/);
});

test('網址指向 repo 的新增 issue 頁，參數有編碼', () => {
  const u = issueUrl('標題 & 1', '內容#2');
  assert.equal(u, 'https://github.com/tsaibohau/logical-ai/issues/new?title=%E6%A8%99%E9%A1%8C%20%26%201&body=%E5%85%A7%E5%AE%B9%232');
});

test('短對話直接放進網址；長文改用剪貼簿', () => {
  const short = prepareReport(converse(['我想要升遷。']));
  assert.equal(short.needsClipboard, false);
  assert.ok(short.url.length <= MAX_URL_LENGTH);
  const long = readFileSync(new URL('./fixtures/long-case.txt', import.meta.url), 'utf8');
  const rep = prepareReport(converse([long]));
  assert.equal(rep.needsClipboard, true);
  assert.ok(rep.url.length <= MAX_URL_LENGTH);
  assert.match(rep.full, /安全提示\*\*：concern/);
});
