// 說清楚：把使用者的片段分進五格，拼成問題草稿，找出卡點，只問一題。
// 原本的推論規則在這裡只當「線索」，不對外顯示成錯誤。
// 所有輸出都是 data/templates.json 的模板 + 使用者原文片段。
import { templates } from './data.js';
import { renderTemplate, hashString } from './questions.js';
import { CONFIG } from './rules.js';

const T = templates.clarify;
export const SLOTS = ['EVENT', 'FEELING', 'WANT', 'BLOCK', 'WORRY'];

const CLAUSE_PUNCT = /[，,；;：:。！？!?\n]/;
const LEAD = /^(但是|可是|不過|然而|但|而且|而|所以|因此|於是|然後|結果|因為|雖然)+/;
const GOAL_LEAD = /^[也又還再更能要去]+/;
// 負面評價才算困擾；「努力」「穩定」這類中性或正面的評價不算。
const NEGATIVE_EVAL = new Set(['失敗', '不夠', '沒用', '爛', '廢', '差勁', '太差', '很差', '不值得', '沒意義', '沒有意義', '浪費', '不正常', '退步', '失職']);
const WORRY_MARKERS = ['擔心', '害怕', '怕', '萬一', '會不會', '恐怕', '不知道會不會'];
const INABILITY = ['沒辦法', '做不到', '來不及', '不能', '不行', '不敢', '不讓', '沒時間', '沒錢', '卡住'];
const YES = /^\s*(是|對|沒錯|嗯|就是|是的|對的)[。！!，,]?\s*$/;
const NO = /^\s*(不是|不對|不太對|不完全是|也不是)/;

const has = (t, g) => t.tags.includes(g);

function clauses(body, sentences) {
  const out = [];
  for (const s of sentences) {
    let a = 0;
    for (let i = 0; i <= s.text.length; i++) {
      if (i === s.text.length || CLAUSE_PUNCT.test(s.text[i])) {
        const raw = s.text.slice(a, i);
        let text = raw.replace(/^\s+|\s+$/g, '');
        let start = s.start + a + (raw.length - raw.replace(/^\s+/, '').length);
        const m = text.match(LEAD);
        if (m && text.length > m[0].length) { start += m[0].length; text = text.slice(m[0].length); }
        if (text) out.push({ text, start, end: start + text.length, sentIdx: s.idx });
        a = i + 1;
      }
    }
  }
  return out;
}

function item(slot, clause, key, round, keyStart) {
  return { slot, text: clause.text, start: clause.start, end: clause.end, key, keyStart, round };
}

/** 把本輪的子句分進五格。每個子句只進一格。 */
export function sortIntoSlots(body, tokens, sentences, skeleton, round = 0, hint = null) {
  const slots = Object.fromEntries(SLOTS.map((s) => [s, []]));
  const unsorted = [];
  const all = clauses(body, sentences);
  for (const c of all) {
    const ct = tokens.filter((t) => t.start >= c.start && t.end <= c.end && !has(t, 'PUNCT'));
    // 「不想」「不希望」是狀態，不是想要。
    const negatedGoal = (g) => body.slice(Math.max(0, g.start - 1), g.start) === '不' || body.slice(Math.max(0, g.start - 2), g.start) === '不太';
    const goal = ct.find((t) => has(t, 'GOAL') && t.text !== '準備' && !negatedGoal(t));
    const heavy = ct.some((t) => (has(t, 'ABSOLUTE') && t.weight >= 0.7) || (has(t, 'ABSTRACT') && NEGATIVE_EVAL.has(t.text)))
      || c.text.includes('被') || ct.some((t) => has(t, 'GOAL') && negatedGoal(t));
    const emo = ct.find((t) => has(t, 'EMOTION'));
    const worry = WORRY_MARKERS.some((m) => c.text.includes(m));
    const blocky = ct.some((t) => has(t, 'MINDREAD') || has(t, 'BINARY') || has(t, 'OBLIGATION'))
      || INABILITY.some((m) => c.text.includes(m))
      // 轉折後面帶著否定（「可是我不知道…」）才算擋住；「但房租可以省一半」不算。
      || (body.slice(Math.max(0, c.start - 4), c.start).match(/但是|可是|不過|然而|但|卻/) && !goal && /不|沒|無法/.test(c.text));
    const eventy = ct.some((t) => has(t, 'NUMBER') || has(t, 'TIME') || has(t, 'ACTION') || has(t, 'EVIDENCE'))
      || (skeleton && skeleton.found && skeleton.text.includes(c.text));
    if (worry) slots.WORRY.push(item('WORRY', c, c.text, round));
    else if (goal) {
      const rest = body.slice(goal.end, c.end);
      const lead = rest.length - rest.replace(GOAL_LEAD, '').length;
      const key = rest.slice(lead).replace(/^\s+|\s+$/g, '');
      slots.WANT.push(item('WANT', c, key || c.text, round, key ? goal.end + lead : c.start));
    } else if (emo) slots.FEELING.push(item('FEELING', c, emo.text, round, emo.start));
    else if (blocky) slots.BLOCK.push(item('BLOCK', c, c.text, round));
    else if (eventy) slots.EVENT.push(item('EVENT', c, c.text, round));
    else if (heavy) {
      // 沒有情緒詞、但帶著「總是」「被」「不想」的句子，多半是感受。
      const key = c.text.replace(/^我/, '');
      slots.FEELING.push(item('FEELING', c, key || c.text, round, c.start + (c.text.length - key.length)));
    } else unsorted.push(c);
  }
  // 回答上一題時，答案優先填進那一題問的格子。
  if (hint && !slots[hint].length) {
    let c = unsorted[0];
    if (!c) {
      for (const s of SLOTS) {
        if (s !== hint && slots[s].length) { c = slots[s].shift(); break; }
      }
    }
    if (c) {
      let key = c.key && hint === 'WANT' ? c.key : c.text;
      if (hint === 'WANT') key = key.replace(/^我?(想要|希望|想)/, '') || key;
      slots[hint].push(item(hint, c, key, round));
    }
  }
  return slots;
}

/** 合併前幾輪的格子：同一格新的放前面。 */
export function mergeSlots(prev, cur) {
  const out = {};
  for (const s of SLOTS) out[s] = [...(cur[s] || []), ...((prev && prev[s]) || [])];
  return out;
}

const STUCK_ORDER = ['DEF_MISMATCH', 'GOAL_CONFLICT', 'FALSE_BINARY', 'MINDREAD', 'EMOTION_AS_FACT', 'CAUSAL_JUMP', 'OVERGENERALIZE'];

/** 從線索（原推論規則的 finding）推出卡點。 */
export function stuckFromFindings(findings, feelings = []) {
  const strong = findings.filter((f) => f.severity >= CONFIG.threshold);
  for (const id of STUCK_ORDER) {
    const f = strong.find((x) => x.ruleId === id);
    if (!f) continue;
    const s = f.slots;
    switch (id) {
      case 'DEF_MISMATCH': return { kind: 'STANDARD', slots: { X: s.X, D: s.D, S: s.S }, spans: f.spans, from: id };
      case 'GOAL_CONFLICT': return { kind: 'CONFLICT', slots: { A: s.A, B: s.B }, spans: f.spans, from: id };
      case 'FALSE_BINARY':
        if (s.A && s.B) return { kind: 'TWO_ROADS', slots: { A: s.A, B: s.B }, spans: f.spans, from: id };
        if (s.A) return { kind: 'ONE_ROAD', slots: { A: s.A }, spans: f.spans, from: id };
        break;
      case 'MINDREAD': return { kind: 'OTHERS_VIEW', slots: { S: s.S }, spans: f.spans, from: id };
      case 'EMOTION_AS_FACT':
        // 「很累，每天都提不起勁」是兩個感受，不是用感受推出結論。
        if (feelings.some((x) => x.text.includes(s.C) || s.C.includes(x.text))) break;
        return { kind: 'EMOTION_LOAD', slots: { E: s.E, C: s.C }, spans: f.spans, from: id };
      case 'CAUSAL_JUMP': return { kind: 'CAUSE', slots: { A: s.A, B: s.B }, spans: f.spans, from: id };
      case 'OVERGENERALIZE': return { kind: 'ALWAYS', slots: { S: s.S }, spans: f.spans, from: id };
      default:
    }
  }
  return null;
}

function pickTemplate(list, slots, seed) {
  const ok = list.map((t, i) => ({ i, text: renderTemplate(t, slots) })).filter((x) => x.text);
  return ok.length ? ok[seed % ok.length] : null;
}

const first = (slots, s) => (slots[s] && slots[s][0]) || null;

/** 用五格拼出草稿；缺的格子以「？」顯示。 */
export function buildDraft(slots, stuck) {
  const W = first(slots, 'WANT');
  let B = first(slots, 'BLOCK');
  const F = first(slots, 'FEELING') || first(slots, 'WORRY');
  const parts = { W: W ? W.key : '', B: B ? B.key : '', F: F ? F.key : '' };
  if (stuck && stuck.kind === 'CONFLICT') { parts.W = stuck.slots.A; parts.B = stuck.slots.B; B = { key: stuck.slots.B }; }
  const filled = { W: !!parts.W, B: !!parts.B, F: !!parts.F };
  const text = renderTemplate(T.draft, {
    W: parts.W || T.missing, B: parts.B || T.missing, F: parts.F || T.missing,
  });
  return { text, filled, parts, complete: filled.W && filled.B && filled.F };
}

/**
 * @param {object} p
 * @param {string} p.body
 * @param {object[]} p.tokens, p.sentences, p.findings
 * @param {object} p.skeleton
 * @param {object|null} p.blindspot
 * @param {object|null} p.prev 上一輪的 clarify 結果
 */
export function clarify({ body, tokens, sentences, findings, skeleton, blindspot, prev = null }) {
  const round = prev ? prev.round + 1 : 0;
  const seed = hashString(body);

  // 回應上一輪的確認題
  if (prev && prev.question && prev.question.id === 'CONFIRM') {
    if (YES.test(body)) {
      return { ...prev, round, confirmed: true, question: null, note: T.done, current: emptySlots() };
    }
  }
  const rejected = prev && prev.question && prev.question.id === 'CONFIRM' && NO.test(body);

  const ASKED_SLOT = { ASK_WANT: 'WANT', ASK_BLOCK: 'BLOCK', ASK_EVENT: 'EVENT' };
  const hint = prev && prev.question ? ASKED_SLOT[prev.question.id] || null : null;
  const current = sortIntoSlots(body, tokens, sentences, skeleton, round, hint);
  const slots = mergeSlots(prev && prev.slots, current);
  const findingStuck = stuckFromFindings(findings, current.FEELING);
  const asked = new Set(prev ? prev.asked : []);
  let stuck = findingStuck || (prev && prev.stuck && prev.stuck.from !== 'SLOTS' ? prev.stuck : null);
  const W = first(slots, 'WANT');
  const B = first(slots, 'BLOCK');
  if (!stuck && W && B) stuck = { kind: 'BLOCKED', slots: { W: W.key, B: B.key }, spans: [], from: 'SLOTS' };
  const STRONG = new Set(['STANDARD', 'CONFLICT', 'TWO_ROADS', 'ONE_ROAD', 'OTHERS_VIEW']);
  // 草稿已經齊了，較弱的線索就讓位給「想要 vs 擋住」。
  if (stuck && !STRONG.has(stuck.kind) && stuck.from !== 'SLOTS' && W && B && first(slots, 'FEELING')) {
    stuck = { kind: 'BLOCKED', slots: { W: W.key, B: B.key }, spans: [], from: 'SLOTS' };
  }
  if (stuck) {
    const st = T.stuck[stuck.kind];
    stuck = { ...stuck, note: renderTemplate(st.note, stuck.slots) };
  }
  const draft = buildDraft(slots, stuck);

  // 問題的優先序：卡點 → 缺「想要」→ 缺「擋住」→ 缺「發生了什麼」→ 模糊詞 → 盲點 → 確認
  const troubled = [...slots.FEELING, ...slots.WORRY, ...slots.BLOCK].length > 0 || !!stuck;
  const F = first(slots, 'FEELING');
  const anyClause = [...current.FEELING, ...current.WORRY, ...current.BLOCK, ...current.EVENT][0]
    || [...slots.FEELING, ...slots.WORRY, ...slots.BLOCK][0];
  const stuckQ = stuck && stuck.from !== 'SLOTS'
    ? { id: `STUCK_${stuck.kind}`, list: T.stuck[stuck.kind].questions, slots: stuck.slots, spans: stuck.spans } : null;
  const vague = findings.find((f) => f.ruleId === 'UNDEFINED_TERM' && f.severity >= CONFIG.threshold);
  // 代價題只在原文有決定或安排時才問；單純說「想要」不問代價。
  const decided = /決定|打算|所以|因此|於是/.test(body);
  const useBlind = blindspot && (blindspot.ruleId !== 'COST_UNSTATED' || decided);

  // 問題的優先序：明確卡點 → 缺「發生了什麼」→ 缺「想要」→ 缺「擋住」→ 草稿齊了就確認 → 其他卡點 → 模糊詞 → 盲點
  const candidates = [];
  if (rejected && draft.parts.B) candidates.push({ id: 'REJECTED', list: T.ask.REJECTED, slots: { B: draft.parts.B } });
  if (stuckQ && STRONG.has(stuck.kind)) candidates.push(stuckQ);
  if (F && !slots.EVENT.length) candidates.push({ id: 'ASK_EVENT', list: T.ask.EVENT, slots: { F: F.key } });
  if (!draft.filled.W && troubled && anyClause) candidates.push({ id: 'ASK_WANT', list: T.ask.WANT, slots: { S: anyClause.text }, spans: [anyClause] });
  if (draft.filled.W && !draft.filled.B) candidates.push({ id: 'ASK_BLOCK', list: T.ask.BLOCK, slots: { W: draft.parts.W } });
  if (draft.complete) candidates.push({ id: 'CONFIRM', list: T.ask.CONFIRM, slots: { B: draft.parts.B } });
  if (stuckQ && !STRONG.has(stuck.kind)) candidates.push(stuckQ);
  if (vague) candidates.push({ id: `ASK_VAGUE_${vague.slots.X}`, list: T.ask.VAGUE, slots: { X: vague.slots.X }, spans: vague.spans });
  if (useBlind) candidates.push({ id: `BLIND_${blindspot.ruleId}`, direct: blindspot });

  let question = null;
  for (const c of candidates) {
    if (asked.has(c.id) && c.id !== 'CONFIRM') continue;
    if (c.direct) {
      question = { id: c.id, ruleId: c.direct.ruleId, text: c.direct.text, templateId: c.direct.templateId, spans: c.direct.spans, slots: c.direct.slots };
      break;
    }
    const p = pickTemplate(c.list, c.slots, seed);
    if (!p) continue;
    const spans = (c.spans || []).filter((s) => s.round === undefined || s.round === round)
      .map((s) => ({ start: s.start, end: s.end, text: s.text }));
    question = { id: c.id, ruleId: c.id, text: p.text, templateId: `${c.id}#${p.i}`, spans, slots: c.slots };
    break;
  }
  if (question) asked.add(question.id);

  const note = !question && !troubled ? T.noTrouble : '';
  return { round, slots, current, stuck, draft, question, asked: [...asked], confirmed: false, note, troubled };
}

function emptySlots() {
  return Object.fromEntries(SLOTS.map((s) => [s, []]));
}
