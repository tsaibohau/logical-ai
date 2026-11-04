// 守門：audit 全流程不得呼叫 fetch / XMLHttpRequest / WebSocket。
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('audit 全流程不發出任何網路請求', async () => {
  const calls = [];
  const saved = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, WebSocket: globalThis.WebSocket };
  globalThis.fetch = (...a) => { calls.push(['fetch', a]); throw new Error('fetch 被呼叫'); };
  globalThis.XMLHttpRequest = class { constructor() { calls.push(['XMLHttpRequest']); throw new Error('XHR 被呼叫'); } };
  globalThis.WebSocket = class { constructor() { calls.push(['WebSocket']); throw new Error('WebSocket 被呼叫'); } };
  try {
    // 在 stub 之後才載入模組，連模組初始化也一起檢查。
    const { audit } = await import(`../src/audit.js?guard=${Date.now()}`);
    const inputs = [
      '/def 努力 = 每週運動三次\n/tag 擺爛 = ABSTRACT\n我很努力，但大家都覺得我在擺爛。',
      '我要嘛辭職要嘛忍耐。因為他遲到，所以我被罵。',
      '我想要升遷，但是我也想準時下班。我好煩，我一定是個失敗的人。',
      '/defs\n/help\n/reset\n/reset 確認',
      '上週我跑步三次，每次五公里。',
    ];
    let prev = null;
    let state;
    for (const s of inputs) {
      prev = audit(s, state, { previous: prev });
      state = prev.state;
    }
    assert.deepEqual(calls, []);
  } finally {
    Object.assign(globalThis, saved);
  }
});

test('src 原始碼不含網路 API 字樣', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const dir = new URL('../src/', import.meta.url);
  for (const f of await readdir(dir)) {
    const code = await readFile(new URL(f, dir), 'utf8');
    for (const bad of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'navigator.sendBeacon', 'EventSource', 'importScripts']) {
      assert.ok(!code.includes(bad), `${f} 含有 ${bad}`);
    }
    assert.ok(!/import\s[^;]*from\s+['"]https?:/.test(code), `${f} 從網址載入模組`);
  }
});
