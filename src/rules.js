// 漏洞規則。每條規則是純函式：(tokens, sentences, state) -> Finding[]
// Finding = {ruleId, severity(0-1), spans:[{start,end,text}], note, slots, sentIdx}
// note 只由 data/templates.json 的模板 + 使用者原文片段組成。
import { templates } from './data.js';
import { renderTemplate } from './questions.js';

/** 門檻與權重集中在這裡調整。 */
export const CONFIG = {
  threshold: 0.35,
  maxFlaws: 2,
  base: {
    OVERGENERALIZE: 0.6,
    CAUSAL_JUMP: 0.55,
    UNDEFINED_TERM: 0.5,
    FALSE_BINARY: 0.65,
    MINDREAD: 0.65,
    EMOTION_AS_FACT: 0.6,
    GOAL_CONFLICT: 0.6,
    DEF_MISMATCH: 0.7,
  },
  countBonus: 0.08, // 每多一個命中加分
  maxCountBonus: 0.24,
  counterPenalty: 0.25, // 句中已有反證（例如數字）時扣分
  causal: { shortLen: 12, timeOnlyBonus: 0.15, certainBonus: 0.15 },
  emotion: { minConclusionWeight: 0.5, multiConclusionBonus: 0.1 },
  binary: { onlyXPenalty: 0.05 },
  slotMaxLen: 24,
};

export const RULE_IDS = Object.keys(CONFIG.base);

// 啟發式用的固定字串（不是背景知識，只是句式標記）。
const CAUSE_FIRST = new Set(['因為', '由於', '都是因為', '就是因為', '只因為', '之所以']);
const SEQ_MARKERS = ['之後', '以後', '後來', '自從', '從那天起', '從那時起', '那次之後'];
const CERTAIN_MARKERS = ['一定', '絕對', '肯定', '必然', '必定', '保證', '鐵定'];
const RESULT_SPLIT = ['所以', '才會', '因此', '於是', '結果', '導致', '造成', '使得'];
const MORE_OPTIONS = ['第三', '其他選項', '其他選擇', '另一個選項', '另一個選擇', '還有一個選項', '還可以', '或者也可以'];
const CLAUSE_PUNCT = /[，,；;：:。！？!?\n]/;
const STRIP = /^[\s，,；;：:。！？!?、「」『』（）()…—~～]+|[\s，,；;：:。！？!?、「」『』（）()…—~～]+$/g;
const STOP_CHARS = new Set('我你他她它們的了是在也都很就又還有和與跟被把這那個不要會'.split(''));

const has = (t, tag) => t.tags.includes(tag);
const span = (t) => ({ start: t.start, end: t.end, text: t.text });
const clamp = (x) => Math.max(0, Math.min(1, Math.round(x * 100) / 100));
const strip = (s) => s.replace(STRIP, '');

function bonus(n) {
  return Math.min(CONFIG.maxCountBonus, CONFIG.countBonus * Math.max(0, n - 1));
}

function bySentence(tokens) {
  const m = new Map();
  for (const t of tokens) {
    if (!m.has(t.sentIdx)) m.set(t.sentIdx, []);
    m.get(t.sentIdx).push(t);
  }
  return m;
}

/** 取 pos 所在的子句（以逗號等切開），位置是絕對位置。 */
export function clauseAt(sent, pos) {
  const rel = pos - sent.start;
  let a = rel;
  while (a > 0 && !CLAUSE_PUNCT.test(sent.text[a - 1])) a--;
  let b = rel;
  while (b < sent.text.length && !CLAUSE_PUNCT.test(sent.text[b])) b++;
  return { start: sent.start + a, end: sent.start + b, text: sent.text.slice(a, b) };
}

/** 句子在 [from, to) 的原文片段。 */
function slice(sent, from, to) {
  return sent.text.slice(Math.max(0, from - sent.start), Math.max(0, to - sent.start));
}

/** 把過長的片段收斂成貼近 anchor 的子句，保證仍是原文子字串。 */
function trimSlot(s, side = 'end') {
  let out = strip(s);
  if (out.length > CONFIG.slotMaxLen) {
    const parts = out.split(CLAUSE_PUNCT).map(strip).filter(Boolean);
    out = side === 'end' ? parts[parts.length - 1] || '' : parts[0] || '';
    if (out.length > CONFIG.slotMaxLen) {
      out = side === 'end' ? out.slice(-CONFIG.slotMaxLen) : out.slice(0, CONFIG.slotMaxLen);
    }
  }
  return out;
}

const LEAD_CONTRAST = /^(但是|可是|不過|然而|但|而且|而)/;
function quoteClause(sent, tok) {
  const c = strip(clauseAt(sent, tok.start).text).replace(LEAD_CONTRAST, '');
  return c.length >= 4 ? trimSlot(c, 'start') : trimSlot(sent.text, 'start');
}

function bigrams(s) {
  const out = new Set();
  const chars = [...s].filter((c) => /\p{Script=Han}|[A-Za-z0-9]/u.test(c));
  for (let i = 0; i + 1 < chars.length; i++) {
    if (STOP_CHARS.has(chars[i]) && STOP_CHARS.has(chars[i + 1])) continue;
    out.add(chars[i] + chars[i + 1]);
  }
  return out;
}

function sharesContent(a, b) {
  const A = bigrams(a);
  for (const g of bigrams(b)) if (A.has(g)) return true;
  return false;
}

function makeNote(ruleId, slots, flags = {}) {
  const list = templates.findings[ruleId] || [];
  for (const item of list) {
    const t = typeof item === 'string' ? { t: item } : item;
    if (t.when && !flags[t.when]) continue;
    const out = renderTemplate(t.t, slots);
    if (out) return out;
  }
  return '';
}

function finding(ruleId, severity, spans, slots, sentIdx, flags = {}) {
  return { ruleId, severity: clamp(severity), spans, slots, sentIdx, flags, note: makeNote(ruleId, slots, flags) };
}

function paragraphs(sentences) {
  const m = new Map();
  for (const s of sentences) {
    if (!m.has(s.paraIdx)) m.set(s.paraIdx, []);
    m.get(s.paraIdx).push(s);
  }
  return [...m.values()];
}

function prevToken(tokens, tok) {
  let best = null;
  for (const t of tokens) if (t.end <= tok.start && t.sentIdx === tok.sentIdx && !has(t, 'PUNCT')) best = t;
  return best;
}

// ---------------------------------------------------------------- 1
export function OVERGENERALIZE(tokens, sentences) {
  const out = [];
  const bs = bySentence(tokens);
  for (const para of paragraphs(sentences)) {
    const paraTokens = para.flatMap((s) => bs.get(s.idx) || []);
    if (paraTokens.some((t) => has(t, 'NUMBER'))) continue; // 同段有次數或比例：不觸發
    for (const sent of para) {
      const st = bs.get(sent.idx) || [];
      const hits = st.filter((t) => has(t, 'ABSOLUTE')).filter((t) => {
        const p = prevToken(st, t);
        return !(p && has(p, 'NEGATION') && p.end === t.start); // 「不是每次」不算
      });
      if (!hits.length) continue;
      const top = hits.reduce((a, b) => (b.weight > a.weight ? b : a));
      const sev = CONFIG.base.OVERGENERALIZE * top.weight + bonus(hits.length);
      out.push(finding('OVERGENERALIZE', sev, hits.map(span), { X: top.text, S: quoteClause(sent, top) }, sent.idx));
    }
  }
  return out;
}

// ---------------------------------------------------------------- 2
export function CAUSAL_JUMP(tokens, sentences) {
  const out = [];
  const bs = bySentence(tokens);
  for (const sent of sentences) {
    const st = bs.get(sent.idx) || [];
    const causal = st.filter((t) => has(t, 'CAUSAL'));
    if (!causal.length) continue;
    const used = new Set();
    let best = null;
    // 每個因果詞都檢查一次，同一句只保留最強的一項。
    causal.forEach((c, ci) => {
      if (used.has(c)) return;
      const prevEnd = ci > 0 ? causal[ci - 1].end : sent.start;
      const nextStart = ci + 1 < causal.length ? causal[ci + 1].start : sent.end;
      const atStart = strip(slice(sent, sent.start, c.start)) === '';
      let cause = '';
      let effect = '';
      if (CAUSE_FIRST.has(c.text)) {
        if (atStart) {
          const second = causal.find((t) => t !== c && RESULT_SPLIT.includes(t.text));
          if (second) {
            used.add(second);
            cause = slice(sent, c.end, second.start);
            effect = slice(sent, second.end, sent.end);
          } else {
            const cl = clauseAt(sent, c.end);
            cause = slice(sent, c.end, cl.end);
            effect = slice(sent, cl.end, sent.end);
          }
        } else {
          effect = slice(sent, prevEnd, c.start);
          cause = slice(sent, c.end, nextStart);
        }
      } else {
        cause = slice(sent, prevEnd, c.start);
        effect = slice(sent, c.end, sent.end);
        if (!strip(cause)) {
          const prev = sentences[sent.idx - 1];
          if (prev && prev.paraIdx === sent.paraIdx) cause = prev.text;
        }
      }
      let A = trimSlot(cause, 'end');
      let B = trimSlot(effect, 'start');
      const certain = CERTAIN_MARKERS.some((m) => effect.includes(m)) || /只要.+就/.test(effect);
      if (certain) {
        // 「只要 X，(…)就一定 Y」：X 是前提，Y 是被寫成必然的結果。
        const parts = effect.split(CLAUSE_PUNCT).map(strip).filter(Boolean);
        const yi = parts.findIndex((x) => CERTAIN_MARKERS.some((m) => x.includes(m)) || x.includes('就'));
        if (yi >= 0) B = trimSlot(parts[yi], 'start');
        const cond = effect.match(/只要([^，,；;。！？!?]+?)(?:[，,]|就)/);
        if (cond && strip(cond[1])) A = trimSlot(cond[1], 'start');
      }
      if (!A || !B) return;

      const hasNumber = st.some((t) => has(t, 'NUMBER'));
      const timeOnly = SEQ_MARKERS.some((m) => sent.text.includes(m) || cause.includes(m));
      const short = strip(cause).length <= CONFIG.causal.shortLen && strip(effect).length <= CONFIG.causal.shortLen;
      const linked = sharesContent(cause, effect);
      if (!timeOnly && !certain && !(short && !linked)) return;

      let sev = CONFIG.base.CAUSAL_JUMP * c.weight + bonus(causal.length);
      if (timeOnly) sev += CONFIG.causal.timeOnlyBonus;
      if (certain) sev += CONFIG.causal.certainBonus;
      else if (hasNumber) sev -= CONFIG.counterPenalty;
      const f = finding('CAUSAL_JUMP', sev, causal.map(span), { X: c.text, A, B, S: trimSlot(sent.text, 'start') }, sent.idx, { timeOnly, certain });
      if (!best || f.severity > best.severity) best = f;
    });
    if (best) out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------- 3
export function UNDEFINED_TERM(tokens, sentences) {
  const bs = bySentence(tokens);
  const byWord = new Map();
  for (const sent of sentences) {
    const st = bs.get(sent.idx) || [];
    const hasStandard = st.some((t) => has(t, 'NUMBER') || has(t, 'STANDARD'));
    if (hasStandard) continue;
    for (const t of st) {
      if (!has(t, 'ABSTRACT') || has(t, 'DEFINED')) continue;
      if (!byWord.has(t.text)) byWord.set(t.text, { first: t, sent, hits: [] });
      byWord.get(t.text).hits.push(t);
    }
  }
  const out = [];
  for (const [w, { first, sent, hits }] of byWord) {
    const sev = CONFIG.base.UNDEFINED_TERM * first.weight + bonus(hits.length);
    out.push(finding('UNDEFINED_TERM', sev, hits.map(span), { X: w, S: quoteClause(sent, first) }, sent.idx));
  }
  return out;
}

// ---------------------------------------------------------------- 4
const ELSE_MARKERS = ['不然就', '要不然就', '否則就'];
export function FALSE_BINARY(tokens, sentences) {
  const out = [];
  const bs = bySentence(tokens);
  const fullText = sentences.map((s) => s.text).join('');
  if (MORE_OPTIONS.some((m) => fullText.includes(m))) return out; // 全文已列出兩個以上選項
  for (const sent of sentences) {
    const st = bs.get(sent.idx) || [];
    const hits = st.filter((t) => has(t, 'BINARY'));
    if (!hits.length) continue;
    if ((sent.text.match(/、/g) || []).length >= 2) continue;
    let A = '';
    let B = '';
    const first = hits[0];
    if (first.pairId) {
      const second = hits.find((t) => t.pairId === first.pairId && t.part === 1);
      A = slice(sent, first.end, second.start);
      B = clauseAt(sent, second.end).end > second.end ? slice(sent, second.end, clauseAt(sent, second.end).end) : '';
      if (first.pattern === '非…不可') B = '';
    } else {
      const elseTok = hits.find((t) => ELSE_MARKERS.includes(t.text));
      const only = hits.find((t) => !ELSE_MARKERS.includes(t.text));
      if (only) {
        const cl = clauseAt(sent, only.end);
        A = slice(sent, only.end, elseTok && elseTok.start < cl.end ? elseTok.start : cl.end);
      }
      if (elseTok) {
        B = slice(sent, elseTok.end, clauseAt(sent, elseTok.end).end);
        if (!only) {
          const prevClause = clauseAt(sent, Math.max(sent.start, elseTok.start - 1));
          A = slice(sent, prevClause.start, elseTok.start);
        }
      }
    }
    A = trimSlot(A, 'start');
    B = trimSlot(B, 'start');
    let sev = CONFIG.base.FALSE_BINARY * first.weight;
    if (!A || !B) sev -= CONFIG.binary.onlyXPenalty;
    const slots = { X: first.text, S: trimSlot(sent.text, 'start') };
    if (A) slots.A = A;
    if (B) slots.B = B;
    out.push(finding('FALSE_BINARY', sev, hits.map(span), slots, sent.idx));
  }
  return out;
}

// ---------------------------------------------------------------- 5
export function MINDREAD(tokens, sentences) {
  const out = [];
  const bs = bySentence(tokens);
  for (const sent of sentences) {
    const st = bs.get(sent.idx) || [];
    const hits = st.filter((t) => has(t, 'MINDREAD'));
    if (!hits.length) continue;
    const next = sentences[sent.idx + 1];
    const scope = [...st, ...(next && next.paraIdx === sent.paraIdx ? bs.get(next.idx) || [] : [])];
    if (scope.some((t) => has(t, 'EVIDENCE'))) continue; // 有可觀察依據
    const top = hits[0];
    const sev = CONFIG.base.MINDREAD * top.weight + bonus(hits.length);
    out.push(finding('MINDREAD', sev, hits.map(span), { X: top.text, S: quoteClause(sent, top) }, sent.idx));
  }
  return out;
}

// ---------------------------------------------------------------- 6
const CONCLUSION_TAGS = ['OBLIGATION', 'ABSOLUTE', 'ABSTRACT'];
export function EMOTION_AS_FACT(tokens, sentences) {
  const out = [];
  const bs = bySentence(tokens);
  for (const sent of sentences) {
    const st = bs.get(sent.idx) || [];
    const emo = st.filter((t) => has(t, 'EMOTION'));
    if (!emo.length) continue;
    const concl = st.filter((t) => !has(t, 'EMOTION') && t.weight >= CONFIG.emotion.minConclusionWeight
      && CONCLUSION_TAGS.some((g) => has(t, g)));
    if (!concl.length) continue;
    const E = emo[0];
    const K = concl.find((t) => t.start > E.start) || concl[0];
    const cl = clauseAt(sent, K.start);
    let C;
    if (E.start >= cl.start && E.end <= cl.end) {
      C = K.start > E.start ? slice(sent, E.end, cl.end) : slice(sent, cl.start, E.start);
    } else C = cl.text;
    C = trimSlot(C, K.start > E.start ? 'start' : 'end');
    if (!C) continue;
    const kinds = new Set(concl.flatMap((t) => t.tags.filter((g) => CONCLUSION_TAGS.includes(g))));
    const sev = CONFIG.base.EMOTION_AS_FACT * E.weight + (kinds.size > 1 ? CONFIG.emotion.multiConclusionBonus : 0);
    out.push(finding('EMOTION_AS_FACT', sev, [...emo, ...concl].map(span).sort((a, b) => a.start - b.start),
      { E: E.text, C, S: trimSlot(sent.text, 'start') }, sent.idx));
  }
  return out;
}

// ---------------------------------------------------------------- 7
const GOAL_LEAD = /^[也又還再更能要去]+/;
export function GOAL_CONFLICT(tokens, sentences) {
  const out = [];
  const bs = bySentence(tokens);
  const target = (tok, limit) => {
    const sent = sentences[tok.sentIdx];
    const cl = clauseAt(sent, tok.end);
    const end = limit != null ? Math.min(limit, cl.end) : cl.end;
    return trimSlot(slice(sent, tok.end, end).replace(GOAL_LEAD, ''), 'start');
  };
  for (const para of paragraphs(sentences)) {
    const pt = para.flatMap((s) => bs.get(s.idx) || []);
    const goals = pt.filter((t) => has(t, 'GOAL'));
    const contrasts = pt.filter((t) => has(t, 'CONTRAST'));
    if (goals.length < 2 || !contrasts.length) continue;
    for (let i = 0; i + 1 < goals.length; i++) {
      const g1 = goals[i];
      const g2 = goals[i + 1];
      const k = contrasts.find((t) => t.start >= g1.end && t.end <= g2.start);
      if (!k) continue;
      const A = target(g1, k.sentIdx === g1.sentIdx ? k.start : null);
      const B = target(g2);
      if (!A || !B || A === B || sharesContent(A, B)) continue;
      const sev = CONFIG.base.GOAL_CONFLICT * ((g1.weight + g2.weight) / 2) + bonus(goals.length - 1);
      out.push(finding('GOAL_CONFLICT', sev, [g1, k, g2].map(span), { A, B, X: k.text }, g1.sentIdx));
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 8
// 定義不符：子句中用了已 /def 的詞，也拿出了依據（數字或因果詞），
// 但依據裡完全沒有出現定義的內容——等於用另一套標準下結論。
export function DEF_MISMATCH(tokens, sentences) {
  const out = [];
  const bs = bySentence(tokens);
  for (const sent of sentences) {
    const st = bs.get(sent.idx) || [];
    for (const t of st) {
      if (!has(t, 'DEFINED') || !t.def) continue;
      const cl = clauseAt(sent, t.start);
      const hasBasis = st.some((x) => x.start >= cl.start && x.end <= cl.end && (has(x, 'NUMBER') || has(x, 'CAUSAL')));
      if (!hasBasis) continue;
      const rest = sent.text.slice(0, t.start - sent.start) + sent.text.slice(t.end - sent.start);
      if (!bigrams(t.def).size || sharesContent(t.def, rest)) continue;
      const sev = CONFIG.base.DEF_MISMATCH * (t.weight || 1);
      out.push(finding('DEF_MISMATCH', sev, [span(t)], { X: t.text, D: t.def, S: quoteClause(sent, t) }, sent.idx));
      break;
    }
  }
  return out;
}

export const RULES = {
  OVERGENERALIZE, CAUSAL_JUMP, UNDEFINED_TERM, FALSE_BINARY, MINDREAD, EMOTION_AS_FACT, GOAL_CONFLICT, DEF_MISMATCH,
};

/** 跑全部規則，依 severity 由高到低排序。 */
export function runRules(tokens, sentences, state) {
  const all = [];
  for (const id of RULE_IDS) all.push(...RULES[id](tokens, sentences, state));
  return all.sort((a, b) => b.severity - a.severity || a.sentIdx - b.sentIdx);
}

/** 取 severity 最高、且規則不重複的 1～2 項；全部低於門檻則回傳空陣列。 */
export function selectFindings(findings, cfg = CONFIG) {
  const out = [];
  for (const f of findings) {
    if (f.severity < cfg.threshold) break;
    if (out.some((o) => o.ruleId === f.ruleId)) continue;
    out.push(f);
    if (out.length >= cfg.maxFlaws) break;
  }
  return out;
}
