// 載入並合併詞典。優先序：使用者 /def > 使用者 /tag > 內建詞典。
import { lexicon as BUILTIN, observable as AUX } from './data.js';

/** 第 4 節的固定類別，/tag 只能用這些。 */
export const CATEGORIES = [
  'ABSOLUTE', 'CAUSAL', 'OBLIGATION', 'MINDREAD', 'EMOTION',
  'BINARY', 'ABSTRACT', 'VAGUE', 'GOAL', 'CONTRAST',
];
/** 輔助字表的標籤（不可 /tag）。 */
export const AUX_TAGS = ['ACTION', 'EVIDENCE', 'STANDARD', 'PLAIN'];

export const PRIORITY = { builtin: 1, tag: 2, def: 3 };
export const PAIR_SEP = /[…]+|\.{3}/;

export function emptyState() {
  return { defs: {}, tags: {} };
}

/**
 * @param {{defs?:object, tags?:object}} userState
 * @param {{builtin?:object, aux?:object}} sources 測試時可替換
 */
export function buildLexicon(userState = emptyState(), sources = {}) {
  const builtin = sources.builtin || BUILTIN;
  const aux = sources.aux || AUX;
  const words = new Map();
  const pairs = new Map();

  const put = (w, entry) => {
    if (PAIR_SEP.test(w)) {
      const parts = w.split(PAIR_SEP).map((s) => s.trim()).filter(Boolean);
      if (parts.length !== 2) return;
      const raw = parts.join('…');
      const prev = pairs.get(raw);
      pairs.set(raw, mergeEntry(prev, { ...entry, parts, raw }));
      return;
    }
    words.set(w, mergeEntry(words.get(w), entry));
  };

  for (const cat of CATEGORIES) {
    for (const item of builtin[cat] || []) {
      put(item.w, { tags: [cat], weight: item.weight ?? 1, priority: PRIORITY.builtin, source: 'builtin' });
    }
  }
  for (const tag of AUX_TAGS) {
    for (const w of aux[tag] || []) {
      put(w, { tags: [tag], weight: 1, priority: PRIORITY.builtin, source: 'builtin' });
    }
  }

  // /tag：取代該詞原本的類別（保留輔助標籤）。
  for (const [w, cat] of Object.entries(userState.tags || {})) {
    const target = PAIR_SEP.test(w) ? null : words.get(w);
    const keep = target ? target.tags.filter((t) => AUX_TAGS.includes(t)) : [];
    const entry = { tags: [...keep, cat], weight: 1, priority: PRIORITY.tag, source: 'tag' };
    if (PAIR_SEP.test(w)) put(w, entry);
    else words.set(w, entry);
  }

  // /def：加上 DEFINED，保留原有類別。
  for (const [w, d] of Object.entries(userState.defs || {})) {
    const prev = words.get(w);
    words.set(w, {
      tags: [...new Set([...(prev ? prev.tags : []), 'DEFINED'])],
      weight: prev ? prev.weight : 1,
      priority: PRIORITY.def,
      source: 'def',
      def: d.text,
    });
  }

  let maxLen = 0;
  for (const w of words.keys()) maxLen = Math.max(maxLen, w.length);
  return { words, pairs: [...pairs.values()], maxLen };
}

function mergeEntry(prev, next) {
  if (!prev) return { ...next, tags: [...next.tags] };
  if (next.priority > prev.priority) return { ...next, tags: [...next.tags] };
  if (next.priority < prev.priority) return prev;
  return { ...prev, tags: [...new Set([...prev.tags, ...next.tags])], weight: Math.max(prev.weight, next.weight) };
}

/** 回傳某個詞目前的類別標籤（只含第 4 節類別與 DEFINED）。 */
export function categoriesOf(lex, w) {
  const e = lex.words.get(w);
  if (!e) return [];
  return e.tags.filter((t) => CATEGORIES.includes(t) || t === 'DEFINED');
}
