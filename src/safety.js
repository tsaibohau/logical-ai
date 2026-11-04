// 安全提示：偵測到傷害自己、期待受傷、撐不下去等字句時，顯示固定的求助資訊。
// 這是「只用使用者的字」與「不給建議」的唯一例外（見 CLAUDE.md）。
import { templates } from './data.js';
import { renderTemplate } from './questions.js';

// high：直接提到結束生命或傷害自己，這一輪不追問。
export const HIGH = ['想死', '去死', '不想活', '活不下去', '活著沒意思', '活著沒有意義', '自殺', '輕生', '結束生命', '結束自己', '一了百了', '消失就好', '不如死', '死了算了', '割腕', '跳樓', '傷害自己', '自殘'];
// concern：期待受傷、用疼痛把自己拉回來、撐不下去，顯示資訊但仍可繼續。
// 依嚴重程度排序：引用時取排在最前面的那一個。
export const CONCERN = ['期待受傷', '期待送醫', '希望被送醫', '想被送醫', '希望受傷', '希望自己受傷', '受傷就不用', '受傷就可以', '痛到暈倒', '被救護車載走', '撐不下去', '讓痛覺', '掐著大腿', '喘不過氣', '抽自己'];

const CLAUSE_PUNCT = /[，,；;：:。！？!?\n「」]/;

function clauseAround(text, i, len) {
  let a = i;
  while (a > 0 && !CLAUSE_PUNCT.test(text[a - 1])) a--;
  let b = i + len;
  while (b < text.length && !CLAUSE_PUNCT.test(text[b])) b++;
  const raw = text.slice(a, b);
  const lead = raw.length - raw.replace(/^\s+/, '').length;
  const t = raw.trim();
  return { start: a + lead, end: a + lead + t.length, text: t };
}

/** @returns {null | {level:'high'|'concern', markers:string[], spans:object[], quote:string, body:string, paused:boolean}} */
export function detectSafety(body) {
  if (!body) return null;
  const hits = [];
  for (const [level, list] of [['high', HIGH], ['concern', CONCERN]]) {
    for (const m of list) {
      let i = body.indexOf(m);
      while (i >= 0) { hits.push({ level, m, i, rank: list.indexOf(m) }); i = body.indexOf(m, i + 1); }
    }
  }
  if (!hits.length) return null;
  const level = hits.some((h) => h.level === 'high') ? 'high' : 'concern';
  const main = hits.filter((h) => h.level === level).sort((a, b) => a.rank - b.rank || a.i - b.i)[0];
  const clause = clauseAround(body, main.i, main.m.length);
  const S = templates.safety;
  return {
    level,
    markers: [...new Set(hits.map((h) => h.m))],
    spans: hits.map((h) => ({ start: h.i, end: h.i + h.m.length, text: h.m })),
    quote: renderTemplate(S.quote, { S: clause.text }),
    body: S.body,
    paused: level === 'high',
  };
}
