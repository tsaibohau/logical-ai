// 提問模板與選題。輸出只會是 data/templates.json 的模板，欄位只填使用者原文片段。
import { templates } from './data.js';

const SLOT_RE = /\{([A-Z])\}/g;

/** 模板用到的欄位。 */
export function slotsOf(t) {
  return [...new Set([...t.matchAll(SLOT_RE)].map((m) => m[1]))];
}

/** 填入欄位；任何欄位缺值就回傳 null。 */
export function renderTemplate(t, slots = {}) {
  if (slotsOf(t).some((k) => !slots[k])) return null;
  return t.replace(SLOT_RE, (_, k) => slots[k]);
}

/** 穩定雜湊，讓同一段輸入每次挑到同一個模板。 */
export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pick(list, slots, seed) {
  const ok = list.map((t, i) => ({ t, i, text: renderTemplate(t, slots) })).filter((x) => x.text);
  if (!ok.length) return null;
  return ok[seed % ok.length];
}

/**
 * 只針對推論鏈的斷點出題（預設只問最嚴重的一個）。
 * @param {object[]} selected 已選出的 finding（規則不重複）
 * @param {object[]} tokens
 * @param {string} body 原文，用於雜湊
 */
export function buildQuestions(selected, tokens, body, { max = 1 } = {}) {
  const seed = hashString(body);
  const out = [];
  for (const f of selected) {
    if (out.some((q) => q.ruleId === f.ruleId)) continue; // 不可來自同一規則
    const list = templates.questions[f.ruleId] || [];
    const p = pick(list, f.slots, seed);
    if (p) out.push({ ruleId: f.ruleId, templateId: `${f.ruleId}#${p.i}`, text: p.text, slots: f.slots, spans: f.spans });
    if (out.length >= max) break;
  }
  // 沒有漏洞時不硬問：推論成立就不出題（盲點另由 blindspots.js 判斷）。
  return out;
}
