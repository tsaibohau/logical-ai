// 切句、切詞、保留原文位置。
// 詞典比對一律用「最長匹配」直接掃原文；Intl.Segmenter 只用來取句界與補充詞界。

/** 時間詞（內建，不屬於可擴充詞典）。 */
export const TIME_WORDS = [
  '昨天', '今天', '明天', '前天', '後天', '昨晚', '今晚', '今早', '昨日', '今日',
  '上週', '上周', '上星期', '上禮拜', '這週', '這周', '本週', '下週', '下周', '下星期',
  '上個月', '這個月', '下個月', '上月', '本月', '下月', '去年', '今年', '明年', '前年',
  '每天', '每日', '每週', '每周', '每月', '每年', '每晚', '每早',
  '早上', '晚上', '中午', '下午', '半夜', '凌晨', '週末', '周末', '平日',
  '剛才', '剛剛', '當時', '那天', '那時', '年初', '年底', '月初', '月底', '寒假', '暑假',
  '星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日', '星期天',
  '週一', '週二', '週三', '週四', '週五', '週六', '週日',
  '禮拜一', '禮拜二', '禮拜三', '禮拜四', '禮拜五', '禮拜六', '禮拜天',
];

/** 否定詞（內建）。 */
export const NEGATION_WORDS = ['不', '沒', '沒有', '別', '無', '未', '不是', '不會', '不能', '沒辦法', '並非'];

// 中文數字與數量單位。
const CN_DIGITS = '零〇一二兩三四五六七八九十百千萬億';
const UNITS = [
  '個小時', '個星期', '個禮拜', '個月', '塊錢', '萬元', '公斤', '公里', '分鐘', '小時', '星期', '禮拜',
  '%', '％', '成', '倍', '個', '次', '年', '月', '天', '日', '週', '周', '秒', '元', '塊', '萬', '千',
  '歲', '本', '件', '份', '位', '人', '頁', '題', '點', '號', '回', '遍', '趟', '餐', '杯', '堂',
  '章', '篇', '張', '場', '輪', '名', '家', '間', '台', '分',
];
const TIME_UNITS = new Set(['個小時', '個星期', '個禮拜', '個月', '分鐘', '小時', '星期', '禮拜', '年', '月', '天', '日', '週', '周', '秒', '點']);
// 「一個」「一點」等多半是不定量詞，不當數字。
const INDEFINITE_ONE_UNITS = new Set(['個', '點', '位', '件', '分', '家', '間', '台', '本', '張', '場', '名', '人']);
// 看起來像數字、其實不是的詞。
const NON_NUMERIC = [
  '萬一', '一定', '一些', '一直', '一起', '一切', '一樣', '一般', '一下', '一點', '統一', '唯一', '一旦',
  '一向', '一律', '一再', '一致', '十分', '千萬', '一輩子', '一無是處', '一無所有', '亂七八糟', '七上八下',
  '萬萬', '一心', '一味', '一邊', '一面', '一方面', '一番', '一陣子', '一陣', '一時', '一口氣', '一句話',
];

const UNIT_ALT = UNITS.map(escapeRe).join('|');
const NUM_RE = new RegExp(
  `(?:[0-9０-９]+(?:[.．][0-9０-９]+)?|[${CN_DIGITS}]+)(?:\\s?(${UNIT_ALT}))?`,
  'y',
);
const PUNCT_RE = /^[\s，。！？、；：,.!?;:「」『』（）()《》〈〉“”"'‘’…—\-~～·\[\]【】]+$/u;
const SENT_FALLBACK_RE = /[^。！？!?；;\n]+[。！？!?；;]*\n?|\n/g;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&');
}

export function hasSegmenter() {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

/**
 * 切段落（空行分隔）與句子。回傳 [{idx, paraIdx, start, end, text}]，位置對應原文。
 */
export function splitSentences(text, { useSegmenter = true } = {}) {
  const sentences = [];
  const paraRe = /\n[ \t　]*\n/g;
  const paras = [];
  let last = 0;
  let m;
  while ((m = paraRe.exec(text))) {
    paras.push([last, m.index]);
    last = m.index + m[0].length;
  }
  paras.push([last, text.length]);

  const seg = useSegmenter && hasSegmenter() ? new Intl.Segmenter('zh-Hant', { granularity: 'sentence' }) : null;
  paras.forEach(([pStart, pEnd], paraIdx) => {
    const pText = text.slice(pStart, pEnd);
    const pieces = [];
    if (seg) {
      for (const s of seg.segment(pText)) pieces.push([s.index, s.index + s.segment.length]);
    } else {
      SENT_FALLBACK_RE.lastIndex = 0;
      let mm;
      while ((mm = SENT_FALLBACK_RE.exec(pText))) {
        if (mm[0].length === 0) { SENT_FALLBACK_RE.lastIndex++; continue; }
        pieces.push([mm.index, mm.index + mm[0].length]);
      }
    }
    for (const [a, b] of pieces) {
      // Segmenter 不一定在「；」斷句，這裡再補切一次，讓兩種環境結果一致。
      const chunk = pText.slice(a, b);
      const sub = [];
      let s0 = 0;
      for (let i = 0; i < chunk.length; i++) {
        if (chunk[i] === '；' || chunk[i] === ';' || chunk[i] === '\n') {
          sub.push([s0, i + 1]);
          s0 = i + 1;
        }
      }
      sub.push([s0, chunk.length]);
      for (const [x, y] of sub) {
        let start = pStart + a + x;
        let end = pStart + a + y;
        while (start < end && /\s/.test(text[start])) start++;
        while (end > start && /\s/.test(text[end - 1])) end--;
        if (end > start && !PUNCT_RE.test(text.slice(start, end))) {
          sentences.push({ idx: sentences.length, paraIdx, start, end, text: text.slice(start, end) });
        }
      }
    }
  });
  return sentences;
}

/** 從 pos 開始嘗試比對數字（含中文數字與單位）。回傳 {text, tags} 或 null。 */
export function matchNumberAt(text, pos) {
  for (const w of NON_NUMERIC) {
    if (text.startsWith(w, pos)) return null;
  }
  NUM_RE.lastIndex = pos;
  const m = NUM_RE.exec(text);
  if (!m) return null;
  let str = m[0];
  let unit = m[1] || '';
  const digits = unit ? str.slice(0, str.length - unit.length).trim() : str;
  const isArabic = /[0-9０-９]/.test(digits);
  if (!isArabic) {
    if (!unit && digits.length < 2) return null;
    if (digits === '一' && INDEFINITE_ONE_UNITS.has(unit)) return null;
    // 「萬」「千」在中文數字中可同時是數字或單位，若只剩單位字則不算。
    if (/^[萬千百億]+$/.test(digits)) return null;
  }
  const tags = ['NUMBER'];
  if (TIME_UNITS.has(unit)) tags.push('TIME');
  return { text: str, tags };
}

/** 抽出全文中的數字 span。 */
export function extractNumbers(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const n = matchNumberAt(text, i);
    if (n) {
      out.push({ text: n.text, start: i, end: i + n.text.length, tags: n.tags });
      i += n.text.length;
    } else i++;
  }
  return out;
}

function scanWordList(text, words, tag) {
  const sorted = [...words].sort((a, b) => b.length - a.length);
  const out = [];
  let i = 0;
  while (i < text.length) {
    const w = sorted.find((x) => text.startsWith(x, i));
    if (w) {
      out.push({ text: w, start: i, end: i + w.length, tags: [tag] });
      i += w.length;
    } else i++;
  }
  return out;
}

/** 抽出時間詞（字表 + 「數字＋時間單位」）。 */
export function extractTimeWords(text) {
  const listed = scanWordList(text, TIME_WORDS, 'TIME');
  const numeric = extractNumbers(text).filter((n) => n.tags.includes('TIME'));
  return [...listed, ...numeric].sort((a, b) => a.start - b.start);
}

/** 抽出否定詞。 */
export function extractNegations(text) {
  return scanWordList(text, NEGATION_WORDS, 'NEGATION');
}

/** 空詞典（tokenize 不帶詞典時使用）。 */
export function emptyLexicon() {
  return { words: new Map(), pairs: [], maxLen: 0 };
}

/**
 * 主函式。
 * @param {string} text
 * @param {{words: Map<string,{tags:string[],weight:number,priority:number,def?:string}>, pairs: any[], maxLen:number}} lex
 * @param {{useSegmenter?: boolean}} opts
 * @returns {{text, sentences, tokens, numbers, times, negations}}
 */
export function tokenize(text, lex = emptyLexicon(), opts = {}) {
  const useSegmenter = opts.useSegmenter !== false && hasSegmenter();
  const sentences = splitSentences(text, { useSegmenter });

  // 內建時間詞與否定詞也以最長匹配參與，優先度最低。
  const base = new Map();
  for (const w of TIME_WORDS) base.set(w, { tags: ['TIME'], weight: 1, priority: 0 });
  for (const w of NEGATION_WORDS) base.set(w, { tags: ['NEGATION'], weight: 1, priority: 0 });
  const maxLen = Math.max(lex.maxLen || 0, ...TIME_WORDS.map((w) => w.length));

  const lookup = (w) => {
    const a = lex.words.get(w);
    const b = base.get(w);
    if (a && b) return { ...a, tags: [...new Set([...a.tags, ...b.tags])] };
    return a || b || null;
  };

  const special = [];
  for (const sent of sentences) {
    const reserved = [];
    // 1) 不連續詞（例如「要嘛…要嘛」）
    for (const pair of lex.pairs || []) {
      const [p1, p2] = pair.parts;
      let from = sent.start;
      while (from < sent.end) {
        const i1 = text.indexOf(p1, from);
        if (i1 < 0 || i1 + p1.length > sent.end) break;
        const i2 = text.indexOf(p2, i1 + p1.length);
        if (i2 < 0 || i2 + p2.length > sent.end || i2 === i1 + p1.length) { from = i1 + 1; continue; }
        const overl = reserved.some((r) => (i1 < r.end && i1 + p1.length > r.start) || (i2 < r.end && i2 + p2.length > r.start));
        if (overl) { from = i1 + 1; continue; }
        const pairId = `${sent.idx}:${i1}`;
        const t1 = { text: p1, start: i1, end: i1 + p1.length, sentIdx: sent.idx, tags: [...pair.tags], weight: pair.weight, pattern: pair.raw, pairId, part: 0 };
        const t2 = { text: p2, start: i2, end: i2 + p2.length, sentIdx: sent.idx, tags: [...pair.tags], weight: pair.weight, pattern: pair.raw, pairId, part: 1 };
        special.push(t1, t2);
        reserved.push(t1, t2);
        from = i2 + p2.length;
      }
    }
    // 2) 最長匹配：詞典、時間、否定、數字
    let i = sent.start;
    while (i < sent.end) {
      const r = reserved.find((x) => x.start === i);
      if (r) { i = r.end; continue; }
      const limit = Math.min(maxLen, sent.end - i);
      let best = null;
      for (let L = limit; L >= 1; L--) {
        const w = text.slice(i, i + L);
        if (reserved.some((x) => i < x.end && i + L > x.start)) continue;
        const hit = lookup(w);
        if (hit) { best = { text: w, ...hit }; break; }
      }
      const num = matchNumberAt(text, i);
      if (num && i + num.text.length <= sent.end && !reserved.some((x) => i < x.end && i + num.text.length > x.start)) {
        if (!best || num.text.length > best.text.length) {
          best = { text: num.text, tags: num.tags, weight: 1, priority: 0 };
        } else if (num.text.length === best.text.length) {
          best = { ...best, tags: [...new Set([...best.tags, ...num.tags])] };
        }
      }
      if (best) {
        const tok = {
          text: best.text, start: i, end: i + best.text.length, sentIdx: sent.idx,
          tags: [...best.tags], weight: best.weight ?? 1,
        };
        if (best.def !== undefined) tok.def = best.def;
        if (best.source) tok.source = best.source;
        special.push(tok);
        i += best.text.length;
      } else i++;
    }
  }
  special.sort((a, b) => a.start - b.start);

  // 3) 補充詞界：Segmenter 切出的詞，扣掉已被詞典占用的區間。
  const fill = [];
  const wordSeg = useSegmenter ? new Intl.Segmenter('zh-Hant', { granularity: 'word' }) : null;
  for (const sent of sentences) {
    const occupied = special.filter((t) => t.sentIdx === sent.idx);
    const pieces = [];
    if (wordSeg) {
      for (const s of wordSeg.segment(sent.text)) pieces.push([sent.start + s.index, sent.start + s.index + s.segment.length]);
    } else {
      for (let k = sent.start; k < sent.end; k++) pieces.push([k, k + 1]);
    }
    for (const [a, b] of pieces) {
      let segs = [[a, b]];
      for (const o of occupied) {
        segs = segs.flatMap(([x, y]) => {
          if (o.end <= x || o.start >= y) return [[x, y]];
          const res = [];
          if (o.start > x) res.push([x, o.start]);
          if (o.end < y) res.push([o.end, y]);
          return res;
        });
      }
      for (const [x, y] of segs) {
        const t = text.slice(x, y);
        if (!t.trim()) continue;
        fill.push({ text: t, start: x, end: y, sentIdx: sent.idx, tags: [PUNCT_RE.test(t) ? 'PUNCT' : 'WORD'], weight: 0 });
      }
    }
  }

  const tokens = [...special, ...fill].sort((a, b) => a.start - b.start);
  return {
    text,
    sentences,
    tokens,
    numbers: tokens.filter((t) => t.tags.includes('NUMBER')),
    times: tokens.filter((t) => t.tags.includes('TIME')),
    negations: tokens.filter((t) => t.tags.includes('NEGATION')),
  };
}
