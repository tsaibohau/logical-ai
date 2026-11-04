// 測試共用：用模板反推輸出，確認每個欄位都是原文子字串。
import { templates } from '../src/data.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function templateRegex(t) {
  const parts = t.split(/(\{[A-Z]\})/);
  return new RegExp('^' + parts.map((p) => (/^\{[A-Z]\}$/.test(p) ? '(.+?)' : esc(p))).join('') + '$', 's');
}

export function allTemplates() {
  const out = [];
  for (const list of Object.values(templates.findings)) for (const x of list) out.push(typeof x === 'string' ? x : x.t);
  for (const list of Object.values(templates.questions)) out.push(...list);
  out.push(...templates.fallback);
  return out;
}

/** 使用者自己寫下的文字：本文 + /def 的定義內容。 */
export function userSources(result) {
  return [result.body, ...Object.values(result.state.defs).map((d) => d.text)];
}

/** 輸出是否能由某個模板、且只用使用者原文片段填出。sources 可以是字串或字串陣列。 */
export function explainedBy(output, sources, list = allTemplates()) {
  const src = Array.isArray(sources) ? sources : [sources];
  for (const t of list) {
    const m = output.match(templateRegex(t));
    if (m && m.slice(1).every((g) => src.some((x) => x.includes(g)))) return t;
  }
  return null;
}

/** 骨架輸出是否只來自原文。 */
export function skeletonOk(sk, body) {
  if (sk.found) return body.includes(sk.text);
  const s = templates.skeleton;
  if (sk.text === s.none) return true;
  const m = sk.text.match(new RegExp(`^${esc(s.none)}。${esc(s.undefinedPrefix)}(.+)$`));
  if (!m) return false;
  return [...m[1].matchAll(/『(.+?)』/g)].every((x) => body.includes(x[1]));
}
