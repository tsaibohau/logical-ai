// 評估腳本：node eval/run.js
// 讀 eval/gold.json，輸出每條規則 precision / recall、無漏洞誤報率、骨架命中率，寫入 eval/report.md。
import { readFile, writeFile } from 'node:fs/promises';
import { audit } from '../src/audit.js';
import { RULE_IDS, CONFIG } from '../src/rules.js';
import { emptyState } from '../src/lexicon.js';

const here = new URL('./', import.meta.url);
const gold = JSON.parse(await readFile(new URL('gold.json', here), 'utf8'));

const stats = Object.fromEntries(RULE_IDS.map((r) => [r, { tp: 0, fp: 0, fn: 0, anyTp: 0 }]));
let negTotal = 0;
let negFalseAlarm = 0;
let posTotal = 0;
let posMissedAll = 0;
let skTotal = 0;
let skHit = 0;
const failures = [];
const rows = [];

for (const g of gold) {
  const r = audit(g.text, emptyState());
  const got = r.flaws.map((f) => f.ruleId);
  const aboveAll = [...new Set(r.findings.filter((f) => f.severity >= CONFIG.threshold).map((f) => f.ruleId))];
  const exp = g.expected.rules;
  const problems = [];

  for (const id of RULE_IDS) {
    const e = exp.includes(id);
    const o = got.includes(id);
    if (e && o) stats[id].tp++;
    else if (!e && o) { stats[id].fp++; problems.push(`誤報 ${id}`); }
    else if (e && !o) { stats[id].fn++; problems.push(`漏報 ${id}${aboveAll.includes(id) ? '（門檻以上但被擠出前 2 名）' : ''}`); }
    if (e && aboveAll.includes(id)) stats[id].anyTp++;
  }

  if (g.expected.should_report_no_flaw) {
    negTotal++;
    if (!r.noFlaw) { negFalseAlarm++; problems.push('無漏洞案例被誤報'); }
  } else {
    posTotal++;
    if (r.noFlaw) { posMissedAll++; problems.push('應有漏洞卻輸出「未發現實質漏洞」'); }
  }

  if (g.expected.skeleton_contains) {
    skTotal++;
    if (r.skeleton.text.includes(g.expected.skeleton_contains)) skHit++;
    else problems.push(`骨架未命中（期望含「${g.expected.skeleton_contains}」）`);
  }

  rows.push({ g, r, got, problems });
  if (problems.length) failures.push({ g, r, got, problems });
}

const pct = (a, b) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(0)}%`);
const lines = [];
lines.push('# 評估報告');
lines.push('');
lines.push('> **警告：以下數字來自 `eval/gold.json` 的 30 筆合成資料（`labeled_by: "draft"`），由同一個開發流程撰寫與標註，不能當作真實準確度。** 真實準確度需以真實輸入與人工標註重新評估。');
lines.push('');
lines.push(`- 資料筆數：${gold.length}（應有漏洞 ${posTotal}、應無漏洞 ${negTotal}）`);
lines.push(`- 門檻 threshold：${CONFIG.threshold}；每次最多輸出 ${CONFIG.maxFlaws} 項`);
lines.push('');
lines.push('## 每條規則（以實際輸出的 1～2 項計算）');
lines.push('');
lines.push('| 規則 | TP | FP | FN | Precision | Recall | 門檻以上即算的 Recall |');
lines.push('|---|---:|---:|---:|---:|---:|---:|');
let TP = 0; let FP = 0; let FN = 0;
for (const id of RULE_IDS) {
  const s = stats[id];
  TP += s.tp; FP += s.fp; FN += s.fn;
  lines.push(`| ${id} | ${s.tp} | ${s.fp} | ${s.fn} | ${pct(s.tp, s.tp + s.fp)} | ${pct(s.tp, s.tp + s.fn)} | ${pct(s.anyTp, s.tp + s.fn)} |`);
}
lines.push(`| **合計（micro）** | ${TP} | ${FP} | ${FN} | ${pct(TP, TP + FP)} | ${pct(TP, TP + FN)} | |`);
lines.push('');
lines.push('## 整體');
lines.push('');
lines.push(`- 無漏洞案例誤報率：${negFalseAlarm}/${negTotal} = ${pct(negFalseAlarm, negTotal)}`);
lines.push(`- 有漏洞案例完全漏抓（輸出無漏洞）：${posMissedAll}/${posTotal} = ${pct(posMissedAll, posTotal)}`);
lines.push(`- 骨架命中率：${skHit}/${skTotal} = ${pct(skHit, skTotal)}`);
lines.push(`- 完全正確的案例：${gold.length - failures.length}/${gold.length}`);
lines.push('');
lines.push('## 失敗案例');
lines.push('');
if (!failures.length) lines.push('（無）');
for (const f of failures) {
  lines.push(`### ${f.g.id}`);
  lines.push('');
  lines.push('```');
  lines.push(f.g.text);
  lines.push('```');
  lines.push(`- 期望：${f.g.expected.rules.join('、') || '（無漏洞）'}；實際：${f.got.join('、') || '（無漏洞）'}`);
  lines.push(`- 骨架輸出：${f.r.skeleton.text}`);
  lines.push(`- 問題：${f.problems.join('；')}`);
  const all = f.r.findings.map((x) => `${x.ruleId}:${x.severity}`).join(' ');
  lines.push(`- 全部候選：${all || '（無）'}`);
  lines.push('');
}

const report = lines.join('\n') + '\n';
await writeFile(new URL('report.md', here), report);

const summary = {
  micro: { precision: pct(TP, TP + FP), recall: pct(TP, TP + FN) },
  perRule: Object.fromEntries(RULE_IDS.map((id) => [id, { P: pct(stats[id].tp, stats[id].tp + stats[id].fp), R: pct(stats[id].tp, stats[id].tp + stats[id].fn) }])),
  negativeFalseAlarm: pct(negFalseAlarm, negTotal),
  skeletonHit: pct(skHit, skTotal),
  failures: failures.length,
};
console.log(JSON.stringify(summary, null, 2));
console.log('已寫入 eval/report.md');
