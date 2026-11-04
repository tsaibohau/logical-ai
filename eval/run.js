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
let bsTotal = 0;
let bsHit = 0;
let quietTotal = 0;
let quietOk = 0;
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

  // 盲點：只評估有標註的案例（null 表示應該沒有盲點）。
  if ('blindspot' in g.expected) {
    bsTotal++;
    const gotB = r.blindspot ? r.blindspot.ruleId : null;
    if (gotB === g.expected.blindspot) bsHit++;
    else problems.push(`盲點不符（期望 ${g.expected.blindspot ?? '無'}，實際 ${gotB ?? '無'}）`);
    // 推論成立、也沒有盲點的案例：一題都不該問。
    if (g.expected.should_report_no_flaw && g.expected.blindspot === null && !g.expected.troubled) {
      quietTotal++;
      if (r.questions.length === 0) quietOk++;
      else problems.push(`應該完全不問，卻問了 ${r.questions.length} 題`);
    }
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
lines.push('# 評估報告（線索偵測）');
lines.push('');
lines.push('> 改版為「說清楚」後，這裡的規則不再對使用者顯示成漏洞，而是當作找卡點的**線索**。本報告只評估線索偵測；「問題草稿是否說中使用者真正的問題」需要真人測試，目前沒有評估。');
lines.push('');
lines.push(`> **警告：以下數字來自 \`eval/gold.json\` 的 ${gold.length} 筆合成資料（\`labeled_by: "draft"\`），由同一個開發流程撰寫與標註，不能當作真實準確度。** 真實準確度需以真實輸入與人工標註重新評估。`);
lines.push('>');
lines.push('> 設計改為「推論成立就放行，只問結構性盲點」後，g07～g09 依新設計改標為無漏洞；g31～g40 是改版後新寫、改規則時沒有用過的「推論成立」案例。改為「說清楚」後，g07、g09 標為 `troubled: true`（原文本身就是困擾，應該問一題），不列入「完全不問」的分母。');
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
lines.push(`- 盲點判斷正確率（有標註者）：${bsHit}/${bsTotal} = ${pct(bsHit, bsTotal)}`);
lines.push(`- 「沒有困擾、也沒有盲點」案例完全不問的比例：${quietOk}/${quietTotal} = ${pct(quietOk, quietTotal)}`);
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
  if (f.r.questions.length) lines.push(`- 提問：${f.r.questions.map((q) => q.text).join(' ／ ')}`);
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
  blindspot: pct(bsHit, bsTotal),
  quietWhenSound: `${quietOk}/${quietTotal}`,
  failures: failures.length,
};
console.log(JSON.stringify(summary, null, 2));
console.log('已寫入 eval/report.md');
