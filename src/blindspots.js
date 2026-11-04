// 盲點：推論本身成立，但原文的結構有缺口——沒寫代價、只列一邊的理由、沒寫什麼情況會改變。
// 只看原文「有沒有寫到」，不判斷內容對錯，也不補充任何外部知識。至多回傳一題；沒有缺口就回傳 null。
import { templates } from './data.js';
import { renderTemplate, hashString } from './questions.js';

// 句式標記：只用來判斷原文有沒有寫到某類考量。
const DECISION_MARKERS = ['決定', '下定決心', '選擇了', '我會'];
const NOT_DECISION = new Set(['準備']);
const OPINION_MARKERS = ['我覺得', '我認為', '我總覺得', '值得', '划算', '不錯'];
const COST_MARKERS = ['代價', '犧牲', '放棄', '損失', '成本', '風險', '缺點', '壞處', '少了', '失去', '會少', '得花', '要花', '花掉', '換來'];
const CONDITION_MARKERS = ['如果', '假如', '要是', '萬一', '除非', '若', '直到', '否則', '看情況', '視情況', '到時候', '一旦', '不然', '再看'];
const CERTAIN_MARKERS = ['一定', '絕對', '肯定', '必然', '必定', '保證', '鐵定'];
const RESULT_WORDS = new Set(['所以', '因此', '於是', '才會']);
const CLAUSE_PUNCT = /[，,；;：:。！？!?\n]/;
const TRIM = /^[\s，,；;：:。！？!?、]+|[\s，,；;：:。！？!?、]+$/g;
const LEAD = /^(但是|可是|不過|然而|但|而且|而|所以|因此|於是)/;

const has = (t, g) => t.tags.includes(g);

function clauseAt(text, pos) {
  let a = pos;
  while (a > 0 && !CLAUSE_PUNCT.test(text[a - 1])) a--;
  let b = pos;
  while (b < text.length && !CLAUSE_PUNCT.test(text[b])) b++;
  const raw = text.slice(a, b);
  const lead = raw.length - raw.replace(/^[\s]+/, '').length;
  let t = raw.replace(TRIM, '');
  let start = a + lead;
  const m = t.match(LEAD);
  if (m && t.length > m[0].length) { t = t.slice(m[0].length); start += m[0].length; }
  return { start, end: start + t.length, text: t };
}

// 數理由時，頓號列舉（成本低、上手快）也算分開的理由。
function countClauses(text) {
  return text.split(/[，,；;：:。！？!?\n、]/).map((s) => s.replace(TRIM, '')).filter(Boolean).length;
}

function make(ruleId, clause, anchors, body) {
  const t = templates.blindspots[ruleId];
  const slots = { S: clause.text };
  const list = t.questions.map((q) => renderTemplate(q, slots));
  const i = hashString(body) % list.length;
  return {
    ruleId,
    note: renderTemplate(t.note, slots),
    text: list[i],
    templateId: `${ruleId}#${i}`,
    slots,
    spans: [
      ...anchors.map((a) => ({ start: a.start, end: a.end, text: a.text })),
      { start: clause.start, end: clause.end, text: clause.text },
    ],
  };
}

/**
 * @param {string} body 審計本文
 * @param {object[]} tokens
 * @returns {object|null}
 */
export function detectBlindspot(body, tokens) {
  if (!body) return null;
  const words = tokens.filter((t) => !has(t, 'PUNCT'));
  // 「準備」多半是正在做的動作（準備考試），不當作決定。
  const decisions = words.filter((t) => (has(t, 'GOAL') && !NOT_DECISION.has(t.text)) || has(t, 'OBLIGATION'));
  for (const m of DECISION_MARKERS) {
    let i = body.indexOf(m);
    while (i >= 0) { decisions.push({ start: i, end: i + m.length, text: m }); i = body.indexOf(m, i + 1); }
  }
  decisions.sort((a, b) => a.start - b.start);
  const certain = [];
  for (const m of CERTAIN_MARKERS) {
    const i = body.indexOf(m);
    if (i >= 0) certain.push({ start: i, end: i + m.length, text: m });
  }
  const opinions = [];
  for (const m of OPINION_MARKERS) {
    const i = body.indexOf(m);
    if (i >= 0) opinions.push({ start: i, end: i + m.length, text: m });
  }
  const hasContrast = words.some((t) => has(t, 'CONTRAST'));
  const hasCost = hasContrast || COST_MARKERS.some((m) => body.includes(m));
  const hasCondition = CONDITION_MARKERS.some((m) => body.includes(m));

  // 決定落在哪一句：決定之後若接了「所以…」，以那個安排為準。
  const planClause = (anchor) => {
    const result = words.find((t) => t.start > anchor.start && RESULT_WORDS.has(t.text));
    return result ? clauseAt(body, result.end) : clauseAt(body, anchor.end);
  };

  if (decisions.length) {
    const last = decisions[decisions.length - 1];
    const clause = planClause(decisions[0]);
    if (clause.text && !hasCost) return make('COST_UNSTATED', clause, [last], body);
    if (clause.text && !hasCondition) return make('NO_REVISION', clause, [last], body);
  }
  if (certain.length && !hasCondition) {
    const clause = clauseAt(body, certain[0].start);
    if (clause.text) return make('NO_REVISION', clause, certain, body);
  }
  if ((opinions.length || decisions.length) && !hasCost && countClauses(body) >= 3) {
    const anchor = opinions[0] || decisions[0];
    const clause = clauseAt(body, anchor.end);
    if (clause.text) return make('ONE_SIDED', clause, [anchor], body);
  }
  return null;
}
