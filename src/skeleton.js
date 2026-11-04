// 骨架挑選：原句（或原子句）輸出，不改寫。
import { templates } from './data.js';

const EXCLUDE = ['EMOTION', 'ABSOLUTE', 'MINDREAD', 'OBLIGATION'];
const PENALTY = { ABSTRACT: 5, VAGUE: 4, CAUSAL: 3, CONTRAST: 3, GOAL: 3, BINARY: 3 };
const CLAUSE_SPLIT = /[，,；;：:]/;
const TRIM = /^[\s，,；;：:。！？!?、]+|[\s，,；;：:。！？!?、]+$/g;

function units(sentences) {
  const out = [];
  for (const s of sentences) {
    out.push({ start: s.start, end: s.end, sentIdx: s.idx, whole: true });
    let a = 0;
    const parts = [];
    for (let i = 0; i <= s.text.length; i++) {
      if (i === s.text.length || CLAUSE_SPLIT.test(s.text[i])) {
        parts.push([a, i]);
        a = i + 1;
      }
    }
    if (parts.length > 1) for (const [x, y] of parts) out.push({ start: s.start + x, end: s.start + y, sentIdx: s.idx, whole: false });
  }
  return out;
}

function trimUnit(text, u) {
  const raw = text.slice(u.start, u.end);
  const lead = raw.length - raw.replace(/^[\s，,；;：:。！？!?、]+/, '').length;
  const t = raw.replace(TRIM, '');
  return { start: u.start + lead, end: u.start + lead + t.length, text: t };
}

/**
 * @returns {{text:string, found:boolean, trace:object}}
 */
export function pickSkeleton(text, tokens, sentences) {
  const cands = [];
  for (const u of units(sentences)) {
    const toks = tokens.filter((t) => t.start >= u.start && t.end <= u.end);
    if (toks.some((t) => EXCLUDE.some((g) => t.tags.includes(g)))) continue;
    const nums = toks.filter((t) => t.tags.includes('NUMBER'));
    const times = toks.filter((t) => t.tags.includes('TIME'));
    const acts = toks.filter((t) => t.tags.includes('ACTION'));
    if (!nums.length && !times.length && !acts.length) continue;
    let penalty = 0;
    for (const [g, p] of Object.entries(PENALTY)) if (toks.some((t) => t.tags.includes(g))) penalty += p; // 已定義的評價詞仍是評價，不是事實
    const info = nums.length * 2 + times.length * 2 + acts.length;
    const score = info * 10 - penalty * 10 + (u.whole ? 1 : 0);
    const tu = trimUnit(text, u);
    if (!tu.text) continue;
    cands.push({ ...tu, score, info, evidence: [...nums, ...times, ...acts] });
  }
  cands.sort((a, b) => b.score - a.score || a.start - b.start);
  const best = cands.find((c) => c.score > 0);
  if (best) {
    return {
      text: best.text,
      found: true,
      trace: {
        ruleId: 'SKELETON',
        spans: [{ start: best.start, end: best.end, text: best.text }],
        evidence: best.evidence.map((t) => ({ start: t.start, end: t.end, text: t.text, tags: t.tags })),
      },
    };
  }
  const undefinedWords = [];
  const spans = [];
  for (const t of tokens) {
    if (t.tags.includes('ABSTRACT') && !t.tags.includes('DEFINED') && !undefinedWords.includes(t.text)) {
      undefinedWords.push(t.text);
      spans.push({ start: t.start, end: t.end, text: t.text });
    }
  }
  const top = undefinedWords.slice(0, 3);
  const s = templates.skeleton;
  const textOut = top.length ? `${s.none}。${s.undefinedPrefix}${top.map((w) => `『${w}』`).join('、')}` : s.none;
  return { text: textOut, found: false, undefinedWords: top, trace: { ruleId: 'SKELETON_NONE', spans: spans.slice(0, 3) } };
}
