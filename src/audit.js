// 串起全流程：audit(text, userState, opts) -> result
import { parseInput, executeCommands } from './commands.js';
import { buildLexicon, categoriesOf, emptyState, CATEGORIES } from './lexicon.js';
import { tokenize } from './tokenize.js';
import { runRules, selectFindings, CONFIG } from './rules.js';
import { pickSkeleton } from './skeleton.js';
import { buildQuestions, renderTemplate } from './questions.js';
import { detectBlindspot } from './blindspots.js';
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
    trace: [],
    wordTags: {},
    crossTurn: [],
  };
  if (!body) {
    result.crossTurn = compareTurns(opts.previous, {}, messages);
    return result;
  }

  const findings = runRules(tk.tokens, tk.sentences, state);
  const selected = selectFindings(findings, CONFIG);
  const skeleton = pickSkeleton(body, tk.tokens, tk.sentences);
  const breakQuestions = buildQuestions(selected, tk.tokens, body);
  const blindspot = detectBlindspot(body, tk.tokens);
  const questions = [...breakQuestions, ...(blindspot ? [{ ...blindspot, section: 'blindspot' }] : [])];
  const wordTags = collectWordTags(tk.tokens);

  result.findings = findings;
  result.flaws = selected.map((f) => ({ ruleId: f.ruleId, severity: f.severity, note: f.note, spans: f.spans, slots: f.slots }));
  result.noFlaw = selected.length === 0;
  result.flawText = result.noFlaw ? templates.noFlaw : '';
  result.skeleton = skeleton;
  result.questions = questions;
  result.blindspot = blindspot;
  result.blindspotText = blindspot ? '' : templates.noBlindspot;
  result.wordTags = wordTags;
  result.crossTurn = compareTurns(opts.previous, wordTags, messages);

  result.trace = [
    { section: 'skeleton', ruleId: skeleton.trace.ruleId, spans: skeleton.trace.spans, evidence: skeleton.trace.evidence || [] },
    ...selected.map((f) => ({ section: 'flaw', ruleId: f.ruleId, severity: f.severity, spans: f.spans })),
    ...breakQuestions.map((q) => ({ section: 'question', ruleId: q.ruleId, templateId: q.templateId, spans: q.spans })),
    ...(blindspot ? [{ section: 'blindspot', ruleId: blindspot.ruleId, templateId: blindspot.templateId, spans: blindspot.spans }] : []),
    ...tk.tokens.filter((t) => t.tags.includes('DEFINED')).map((t) => ({
      section: 'defined', ruleId: 'DEFINED', spans: [{ start: t.start, end: t.end, text: t.text }], def: t.def,
    })),
  ];
  return result;
}

export { categoriesOf };
