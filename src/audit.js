// 串起全流程：audit(text, userState, opts) -> result
import { parseInput, executeCommands } from './commands.js';
import { buildLexicon, categoriesOf, emptyState, CATEGORIES } from './lexicon.js';
import { tokenize } from './tokenize.js';
import { runRules, selectFindings, CONFIG } from './rules.js';
import { pickSkeleton } from './skeleton.js';
import { renderTemplate } from './questions.js';
import { detectBlindspot } from './blindspots.js';
import { clarify, SLOTS as SLOT_KEYS } from './clarify.js';
import { templates } from './data.js';

/** 本輪出現過、且帶類別的詞 -> 類別（供下一輪比對）。 */
function collectWordTags(tokens) {
  const out = {};
  for (const t of tokens) {
    const cats = t.tags.filter((g) => CATEGORIES.includes(g)).sort();
    if (cats.length) out[t.text] = cats;
  }
  return out;
}

/** 最簡版跨輪矛盾：同一個詞兩輪類別不同、或定義漂移。 */
export function compareTurns(prev, wordTags, messages) {
  const notes = [];
  if (prev && prev.wordTags) {
    for (const [w, cats] of Object.entries(wordTags)) {
      const before = prev.wordTags[w];
      if (before && before.join(',') !== cats.join(',')) {
        notes.push({ kind: 'retag', word: w, text: renderTemplate(templates.crossTurn.retag, { X: w, A: before.join('/'), B: cats.join('/') }) });
      }
    }
  }
  for (const m of messages) {
    if (m.data?.kind === 'drift') {
      notes.push({ kind: 'drift', word: m.data.word, text: renderTemplate(templates.crossTurn.drift, { X: m.data.word, A: m.data.before, B: m.data.after }) });
    }
  }
  return notes;
}

/**
 * @param {string} input 使用者輸入（可含行首斜線指令）
 * @param {{defs:object, tags:object}} userState
 * @param {{previous?: object, useSegmenter?: boolean}} opts previous 為上一輪的 result
 */
export function audit(input, userState = emptyState(), opts = {}) {
  const { commands, body } = parseInput(input);
  const { state, messages } = executeCommands(commands, userState);
  const lex = buildLexicon(state);
  const tk = tokenize(body, lex, { useSegmenter: opts.useSegmenter });

  const result = {
    input,
    body,
    state,
    messages,
    empty: !body,
    sentences: tk.sentences,
    tokens: tk.tokens,
    findings: [],
    flaws: [],
    noFlaw: false,
    flawText: '',
    skeleton: null,
    questions: [],
    blindspot: null,
    blindspotText: '',
    clarify: null,
    trace: [],
    wordTags: {},
    crossTurn: [],
  };
  if (!body) {
    result.crossTurn = compareTurns(opts.previous, {}, messages);
    result.clarify = opts.previous ? opts.previous.clarify : null;
    return result;
  }

  const findings = runRules(tk.tokens, tk.sentences, state);
  const selected = selectFindings(findings, CONFIG);
  const skeleton = pickSkeleton(body, tk.tokens, tk.sentences);
  const blindspot = detectBlindspot(body, tk.tokens);
  const cl = clarify({
    body, tokens: tk.tokens, sentences: tk.sentences, findings, skeleton, blindspot,
    prev: opts.previous ? opts.previous.clarify : null,
  });
  // 對外只問一題：由 clarify 決定（卡點、補空格、盲點或確認）。
  const questions = cl.question ? [{ ...cl.question, section: 'clarify' }] : [];
  const wordTags = collectWordTags(tk.tokens);

  result.findings = findings;
  result.flaws = selected.map((f) => ({ ruleId: f.ruleId, severity: f.severity, note: f.note, spans: f.spans, slots: f.slots }));
  result.noFlaw = selected.length === 0;
  result.flawText = result.noFlaw ? templates.noFlaw : '';
  result.skeleton = skeleton;
  result.questions = questions;
  result.blindspot = blindspot;
  result.clarify = cl;
  result.blindspotText = blindspot ? '' : templates.noBlindspot;
  result.wordTags = wordTags;
  result.crossTurn = compareTurns(opts.previous, wordTags, messages);

  result.trace = [
    { section: 'skeleton', ruleId: skeleton.trace.ruleId, spans: skeleton.trace.spans, evidence: skeleton.trace.evidence || [] },
    ...selected.map((f) => ({ section: 'clue', ruleId: f.ruleId, severity: f.severity, spans: f.spans })),
    ...SLOT_KEYS.flatMap((k) => cl.current[k].map((it) => ({ section: 'slot', ruleId: k, spans: [{ start: it.start, end: it.end, text: it.text }] }))),
    ...(cl.stuck && cl.stuck.spans.length ? [{ section: 'stuck', ruleId: cl.stuck.kind, spans: cl.stuck.spans.map((x) => ({ start: x.start, end: x.end, text: x.text })) }] : []),
    ...(cl.question ? [{ section: 'question', ruleId: cl.question.id, templateId: cl.question.templateId, spans: cl.question.spans }] : []),
    ...tk.tokens.filter((t) => t.tags.includes('DEFINED')).map((t) => ({
      section: 'defined', ruleId: 'DEFINED', spans: [{ start: t.start, end: t.end, text: t.text }], def: t.def,
    })),
  ];
  return result;
}

export { categoriesOf };
