// 說清楚：把使用者的片段分進五格，拼成問題草稿，找出卡點，只問一題。
// 原本的推論規則在這裡只當「線索」，不對外顯示成錯誤。
// 所有輸出都是 data/templates.json 的模板 + 使用者原文片段。
import { templates } from './data.js';
import { renderTemplate, hashString } from './questions.js';
import { CONFIG } from './rules.js';
import { quoteRanges } from './tokenize.js';

const T = templates.clarify;
export const SLOTS = ['EVENT', 'FEELING', 'WANT', 'BLOCK', 'WORRY'];

const CLAUSE_PUNCT = /[，,；;：:。！？!?\n]/;
const LEAD = /^(但是|可是|不過|然而|但|而且|而|所以|因此|於是|然後|結果|因為|雖然)+/;
const GOAL_LEAD = /^[也又還再更能要去]+/;
// 負面評價才算困擾；「努力」「穩定」這類中性或正面的評價不算。
const NEGATIVE_EVAL = new Set(['失敗', '不夠', '沒用', '爛', '廢', '差勁', '太差', '很差', '不值得', '沒意義', '沒有意義', '浪費', '不正常', '退步', '失職']);
const WORRY_MARKERS = ['擔心', '害怕', '怕', '萬一', '會不會', '恐怕', '不知道會不會', '怎麼辦'];
// 「想抽自己兩巴掌」是自責，不是想要。
const SELF_PUNISH = ['抽自己', '打自己', '罵自己', '掐自己', '厭惡這樣的自己', '討厭自己', '恨自己'];
// 「明明知道…但…」：知道該怎麼做，卻做不出來。
const KNOW_BUT_CANT = /(明明知道|明明就知道|道理我都懂|我都知道|我也知道)([^。！？!?\n]*?)(?:但是|可是|但|卻)([^。！？!?\n]+)/g;
const INABILITY = ['沒辦法', '做不到', '做不出', '擠不出', '說不出', '講不出', '給不起', '來不及', '不能', '不行', '不敢', '不讓', '沒時間', '沒錢', '卡住', '卡死'];
// 「想像」「想到」不是想要。
const NOT_WANT = /^想(像|到|起|說|過|法|必|通|來|著)/;
// 回答提問時常見的開頭：「我最先做不出來的，就是……」。整段當成答案，填進被問的格子。
const ANSWER_FRAME = /^(\s*我?)((?:最先|第一步|最)?(?:做不出來|做不到|卡住|放不下|害怕|怕)的[，,、]?\s*(?:就|其實)?是[^，,。！？!?\n]+)/;
// 回答「是不是先解決 B」時說「不是」，同一則又寫了別的：「不是 X，而是 Y」或「是 Y」。
const FOCUS_AFTER = /而是([^，,。！？!?\n]+)/;
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

function item(slot, clause, key, round, keyStart, extra = {}) {
  return { slot, text: clause.text, start: clause.start, end: clause.end, key, keyStart, round, ...extra };
}

/** 把本輪的子句分進五格。每個子句只進一格。 */
export function sortIntoSlots(body, tokens, sentences, skeleton, round = 0, hint = null, opts = {}) {
  const slots = Object.fromEntries(SLOTS.map((s) => [s, []]));
  const unsorted = [];
  let all = clauses(body, sentences);
  // 先處理「回答的開頭」：答案整段進被問的格子，裡面的子句不再分格。
  const taken = [];
  if (hint) {
    const m = body.match(ANSWER_FRAME);
    if (m) {
      const start = m[1].length;
      const fr = { text: m[2], start, end: start + m[2].length };
      slots[hint].push(item(hint, fr, m[2].replace(/^\s+|\s+$/g, ''), round, start));
      taken.push(fr);
    }
  }
  if (opts.rejected || NO.test(body)) {
    const f = focusAfterNo(body, sentences);
    if (f) { slots.WANT.push(item('WANT', f.span, f.key, round, f.keyStart, { focus: true })); taken.push(f.span); }
  }
  all = all.filter((c) => !taken.some((t) => c.start < t.end && c.end > t.start));
  // 引號裡的字（別人說的話、想像的台詞）不拿來判斷。
  const quotes = quoteRanges(body);
  const masked = [...body].map((ch, i) => (quotes.some(([a, b]) => i >= a && i < b) ? ' ' : ch)).join('');
  for (const c of all) {
    const own = masked.slice(c.start, c.end);
    if (!/\p{Script=Han}/u.test(own)) continue;
    if (NO.test(c.text) && !c.text.replace(NO, '').replace(/[。！!，,\s]/g, '')) continue; // 單獨的「不是」
    const ct = tokens.filter((t) => t.start >= c.start && t.end <= c.end && !has(t, 'PUNCT') && !has(t, 'QUOTED'));
    // 「不想」「不希望」是狀態，不是想要。
    const negatedGoal = (g) => body.slice(Math.max(0, g.start - 1), g.start) === '不' || body.slice(Math.max(0, g.start - 2), g.start) === '不太';
    const goal = ct.find((t) => has(t, 'GOAL') && t.text !== '準備' && !negatedGoal(t) && !NOT_WANT.test(body.slice(t.start, t.start + 2)));
    const heavy = ct.some((t) => (has(t, 'ABSOLUTE') && t.weight >= 0.7) || (has(t, 'ABSTRACT') && NEGATIVE_EVAL.has(t.text)))
      || own.includes('被') || ct.some((t) => has(t, 'GOAL') && negatedGoal(t));
    const emo = ct.find((t) => has(t, 'EMOTION'));
    // 引號裡的「如果…怎麼辦」是使用者腦中的擔心，仍算擔心。
    const worry = WORRY_MARKERS.some((m) => own.includes(m)) || /「[^」]*(怎麼辦|會不會|萬一)[^」]*」/.test(c.text);
    const selfPunish = SELF_PUNISH.some((m) => own.includes(m));
    const blocky = ct.some((t) => has(t, 'MINDREAD') || has(t, 'BINARY') || has(t, 'OBLIGATION'))
      || INABILITY.some((m) => own.includes(m))
      // 轉折後面帶著否定（「可是我不知道…」）才算擋住；「但房租可以省一半」不算。
      || (body.slice(Math.max(0, c.start - 4), c.start).match(/但是|可是|不過|然而|但|卻/) && !goal && /不|沒|無法/.test(own));
    const eventy = ct.some((t) => has(t, 'NUMBER') || has(t, 'TIME') || has(t, 'ACTION') || has(t, 'EVIDENCE'))
      || (skeleton && skeleton.found && skeleton.text.includes(c.text));
    if (worry) slots.WORRY.push(item('WORRY', c, c.text, round));
    else if (selfPunish) slots.FEELING.push(item('FEELING', c, c.text.replace(/^我/, '') || c.text, round));
    else if (goal) {
      const rest = body.slice(goal.end, c.end);
      const lead = rest.length - rest.replace(GOAL_LEAD, '').length;
      const key = rest.slice(lead).replace(/^\s+|\s+$/g, '');
      slots.WANT.push(item('WANT', c, key || c.text, round, key ? goal.end + lead : c.start));
    } else if (emo) slots.FEELING.push(item('FEELING', c, emo.text, round, emo.start, { emo: true }));
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

/** 「不是。如果只能先…，不是 X，而是 Y」：取 Y 當成使用者自己說的重點。 */
export function focusAfterNo(body, sentences) {
  const rest = sentences.filter((s) => !NO.test(s.text) || s.text.replace(NO, '').replace(/[。！!，,\s]/g, ''));
  const s = rest.find((x) => /\p{Script=Han}/u.test(x.text.replace(NO, '')));
  if (!s) return null;
  const m = s.text.match(FOCUS_AFTER);
  if (!m) return null;
  const key = m[1].replace(/^\s+|\s+$/g, '');
  const keyStart = s.start + m.index + 2 + (m[1].length - m[1].replace(/^\s+/, '').length);
  const span = { text: s.text.replace(/[。！？!?\s]+$/, ''), start: s.start, end: s.start + s.text.replace(/[。！？!?\s]+$/, '').length };
  return { key, keyStart, span };
}

/** 合併前幾輪的格子：同一格新的放前面。 */
export function mergeSlots(prev, cur) {
  const out = {};
  for (const s of SLOTS) out[s] = [...(cur[s] || []), ...((prev && prev[s]) || [])];
  return out;
}

/** 「明明知道 A，但 B」：取最後一次出現（通常是總結）。 */
export function knowButCant(body) {
  let last = null;
  KNOW_BUT_CANT.lastIndex = 0;
  let m;
  while ((m = KNOW_BUT_CANT.exec(body))) last = m;
  if (!last) return null;
  const firstClause = (s) => s.split(/[，,；;]/).map((x) => x.trim()).filter(Boolean)[0] || '';
  const A = firstClause(last[2]).replace(/^(我|自己)/, '');
  const B = firstClause(last[3]);
  if (!A || !B) return null;
  return { kind: 'KNOW_BUT_CANT', slots: { A, B }, spans: [{ start: last.index, end: last.index + last[0].length, text: last[0] }], from: 'PATTERN' };
}

/** 卡點的提問：「知道卻做不到」若原文已寫出擔心，改問先卡在哪一步。 */
function stuckQuestions(stuck, slots) {
  const list = T.stuck[stuck.kind].questions;
  if (stuck.kind === 'KNOW_BUT_CANT') return slots.WORRY.length ? [list[1]] : [list[0]];
  return list;
}

/** 卡點題的答案要填進哪一格：問「最怕什麼」填擔心，問「做不出哪一步」填擋住。 */
function stuckAnswerSlot(stuck, slots) {
  if (stuck.kind !== 'KNOW_BUT_CANT') return null;
  return slots.WORRY.length ? 'BLOCK' : 'WORRY';
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

function bigrams(s) {
  const t = s.replace(/[^\p{Script=Han}]/gu, '');
  const out = new Set();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

function closest(w, list) {
  const wb = bigrams(w);
  let best = null;
  let score = 1;
  for (const x of list) {
    let n = 0;
    for (const g of bigrams(x.text)) if (wb.has(g)) n++;
    if (n > score) { best = x; score = n; }
  }
  return best;
}

/** 用五格拼出草稿；缺的格子以「？」顯示。 */
export function buildDraft(slots, stuck, rejected = []) {
  const W = first(slots, 'WANT');
  const blocks = (slots.BLOCK || []).filter((x) => !rejected.includes(x.key));
  // 「想要」和某個「擋住」寫到同一件事（共用兩個以上的雙字詞）時，取那一個。
  let B = (W && closest(W.key, blocks)) || blocks[0] || null;
  // 感受優先取有明確情緒詞的那一句。
  const F = (slots.FEELING || []).find((x) => x.emo) || first(slots, 'FEELING') || first(slots, 'WORRY');
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
export function clarify({ body, tokens, sentences, findings, skeleton, blindspot, prev = null, safety = null }) {
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
  const hint = prev && prev.question ? prev.question.answerSlot || ASKED_SLOT[prev.question.id] || null : null;
  const current = sortIntoSlots(body, tokens, sentences, skeleton, round, hint, { rejected });
  // 說「不是」的那個「擋住」不再放進草稿。
  const rejectedKeys = [...((prev && prev.rejected) || [])];
  if (rejected && prev.draft.parts.B) rejectedKeys.push(prev.draft.parts.B);
  const focusGiven = current.WANT.some((x) => x.focus);
  const slots = mergeSlots(prev && prev.slots, current);
  const fs = stuckFromFindings(findings, current.FEELING);
  const kbc = knowButCant(body);
  // 「知道卻做不到」比大多數線索更接近核心，只排在「標準不一致」之後。
  const findingStuck = fs && fs.kind === 'STANDARD' ? fs : (kbc || fs);
  const asked = new Set(prev ? prev.asked : []);
  let stuck = findingStuck || (prev && prev.stuck && prev.stuck.from !== 'SLOTS' ? prev.stuck : null);
  const W = first(slots, 'WANT');
  const B = first(slots, 'BLOCK');
  if (!stuck && W && B) stuck = { kind: 'BLOCKED', slots: { W: W.key, B: B.key }, spans: [], from: 'SLOTS' };
  const STRONG = new Set(['STANDARD', 'KNOW_BUT_CANT', 'CONFLICT', 'TWO_ROADS', 'ONE_ROAD', 'OTHERS_VIEW']);
  // 草稿已經齊了，較弱的線索就讓位給「想要 vs 擋住」。
  if (stuck && !STRONG.has(stuck.kind) && stuck.from !== 'SLOTS' && W && B && first(slots, 'FEELING')) {
    stuck = { kind: 'BLOCKED', slots: { W: W.key, B: B.key }, spans: [], from: 'SLOTS' };
  }
  if (stuck) {
    const st = T.stuck[stuck.kind];
    stuck = { ...stuck, note: renderTemplate(st.note, stuck.slots) };
  }
  const draft = buildDraft(slots, stuck, rejectedKeys);

  // 問題的優先序：卡點 → 缺「想要」→ 缺「擋住」→ 缺「發生了什麼」→ 模糊詞 → 盲點 → 確認
  const troubled = [...slots.FEELING, ...slots.WORRY, ...slots.BLOCK].length > 0 || !!stuck;
  const F = first(slots, 'FEELING');
  const anyClause = [...current.FEELING, ...current.WORRY, ...current.BLOCK, ...current.EVENT][0]
    || [...slots.FEELING, ...slots.WORRY, ...slots.BLOCK][0];
  const stuckQ = stuck && stuck.from !== 'SLOTS'
    ? { id: `STUCK_${stuck.kind}`, list: stuckQuestions(stuck, slots), slots: stuck.slots, spans: stuck.spans, answerSlot: stuckAnswerSlot(stuck, slots) } : null;
  const vague = findings.find((f) => f.ruleId === 'UNDEFINED_TERM' && f.severity >= CONFIG.threshold);
  // 代價題只在原文有決定或安排時才問；單純說「想要」不問代價。
  const decided = /決定|打算|所以|因此|於是/.test(body);
  const useBlind = blindspot && (blindspot.ruleId !== 'COST_UNSTATED' || decided);

  // 問題的優先序：明確卡點 → 缺「發生了什麼」→ 缺「想要」→ 缺「擋住」→ 草稿齊了就確認 → 其他卡點 → 模糊詞 → 盲點
  const candidates = [];
  if (rejected && !focusGiven && prev.draft.parts.B) candidates.push({ id: 'REJECTED', list: T.ask.REJECTED, slots: { B: prev.draft.parts.B } });
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
    if (c.answerSlot) question.answerSlot = c.answerSlot;
    break;
  }
  if (safety && safety.paused) question = null; // 寫到想結束生命時，這一輪不追問
  if (question) asked.add(question.id);

  const note = !question && !troubled ? T.noTrouble : '';
  return { round, slots, current, stuck, draft, question, asked: [...asked], confirmed: false, note, troubled, rejected: rejectedKeys };
}

function emptySlots() {
  return Object.fromEntries(SLOTS.map((s) => [s, []]));
}
