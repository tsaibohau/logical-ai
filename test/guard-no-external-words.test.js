// 守門：對 gold 每一筆，提問與漏洞描述只能是「模板固定字串 + 原文片段」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { audit } from '../src/audit.js';
import { emptyState } from '../src/lexicon.js';
import { explainedBy, skeletonOk, userSources } from './helpers.js';

const gold = JSON.parse(readFileSync(new URL('../eval/gold.json', import.meta.url), 'utf8'));

test('gold 至少 30 筆且全部標為 draft', () => {
  assert.ok(gold.length >= 30);
  for (const g of gold) assert.equal(g.labeled_by, 'draft', g.id);
});

for (const g of gold) {
  test(`無外部詞：${g.id}`, () => {
    const r = audit(g.text, emptyState());
    for (const f of r.flaws) assert.ok(explainedBy(f.note, userSources(r)), `漏洞描述含外部詞：${f.note}`);
    for (const q of r.questions) assert.ok(explainedBy(q.text, userSources(r)), `提問含外部詞：${q.text}`);
    assert.ok(skeletonOk(r.skeleton, r.body), `骨架不是原文：${r.skeleton.text}`);
    if (r.noFlaw) assert.equal(r.flawText, '未發現實質漏洞');
    // 每個判斷都可追溯
    for (const t of r.trace) {
      assert.ok(t.ruleId);
      for (const s of t.spans) assert.equal(r.body.slice(s.start, s.end), s.text);
    }
  });
}
