// DOM 與 localStorage。上半部是可在 Node 測試的純函式，下半部只在瀏覽器執行。
import { audit } from './audit.js';
import { emptyState, CATEGORIES } from './lexicon.js';
import { templates } from './data.js';
import { SLOTS } from './clarify.js';

export const STORAGE_KEY = 'logic-audit-state-v1'; // 沿用舊 key，保留使用者已存的定義

export const RULE_LABELS = {
  OVERGENERALIZE: '以偏概全',
  CAUSAL_JUMP: '因果跳接',
  UNDEFINED_TERM: '未定義詞',
  FALSE_BINARY: '偽二選一',
  MINDREAD: '讀心',
  EMOTION_AS_FACT: '情緒當事實',
  GOAL_CONFLICT: '目標衝突',
  DEF_MISMATCH: '定義不符',
  COST_UNSTATED: '代價未寫',
  ONE_SIDED: '只看一邊',
  NO_REVISION: '改變條件',
  EVENT: '發生了什麼',
  FEELING: '感受',
  WANT: '想要',
  BLOCK: '擋住你的',
  WORRY: '擔心',
  SKELETON: '骨架',
  SKELETON_NONE: '無骨架',
  DEFINED: '已定義',
};

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 在原文上標出 marks（可重疊）。marks: [{start,end,cls,title}]
 * 回傳安全的 HTML 字串。
 */
export function highlightHtml(text, marks) {
  const cuts = new Set([0, text.length]);
  for (const m of marks) {
    if (m.end > m.start) { cuts.add(Math.max(0, m.start)); cuts.add(Math.min(text.length, m.end)); }
  }
  const pts = [...cuts].sort((a, b) => a - b);
  let html = '';
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const seg = escapeHtml(text.slice(a, b));
    const cover = marks.filter((m) => m.start <= a && m.end >= b);
    if (!cover.length) { html += seg; continue; }
    const cls = [...new Set(cover.map((m) => m.cls))].join(' ');
    const title = [...new Set(cover.map((m) => m.title).filter(Boolean))].join('\n');
    html += `<mark class="${escapeHtml(cls)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${seg}</mark>`;
  }
  return html;
}

const SLOT_CLS = { EVENT: 'm-event', FEELING: 'm-feeling', WANT: 'm-want', BLOCK: 'm-block', WORRY: 'm-worry' };

/** 從 audit 結果的 trace 產生高亮標記：五格分色，已定義的詞帶出定義。 */
export function marksFromResult(result) {
  const marks = [];
  for (const t of result.trace || []) {
    for (const s of t.spans) {
      if (t.section === 'safety') marks.push({ ...s, cls: 'm-feeling', title: '安全提示' });
      else if (t.section === 'slot') marks.push({ ...s, cls: SLOT_CLS[t.ruleId], title: RULE_LABELS[t.ruleId] });
      else if (t.section === 'defined') marks.push({ ...s, cls: 'm-defined', title: `已定義：${t.def}` });
    }
  }
  return marks;
}

/** 草稿：［…］是使用者的字，［？］是還沒補上的格子。回傳安全的 HTML。 */
export function draftHtml(text, missing = templates.clarify.missing) {
  return escapeHtml(text).replace(/［(.*?)］/g, (_, inner) => (inner === escapeHtml(missing)
    ? '<span class="gap">？</span>'
    : `<span class="fill">${inner}</span>`));
}

/** 驗證並正規化匯入的 JSON 狀態；格式不符就丟錯。 */
export function normalizeState(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('不是有效的 JSON 物件');
  const out = emptyState();
  for (const [w, d] of Object.entries(obj.defs || {})) {
    const text = typeof d === 'string' ? d : d && d.text;
    if (typeof text !== 'string' || !w.trim()) throw new Error(`定義格式錯誤：${w}`);
    out.defs[w] = {
      text,
      history: Array.isArray(d.history) ? d.history.filter((x) => typeof x === 'string') : [],
      operational: !!(d && d.operational),
    };
  }
  for (const [w, c] of Object.entries(obj.tags || {})) {
    if (!CATEGORIES.includes(c)) throw new Error(`未知類別：${c}`);
    out.tags[w] = c;
  }
  return out;
}

export function loadState(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    return raw ? normalizeState(JSON.parse(raw)) : emptyState();
  } catch {
    return emptyState();
  }
}

export function saveState(storage, state) {
  try {
    storage && storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------ 瀏覽器端
function init(doc, win) {
  const $ = (id) => doc.getElementById(id);
  const storage = (() => { try { return win.localStorage; } catch { return null; } })();
  let state = loadState(storage);
  const rounds = []; // 多輪對話記錄（只在記憶體）
  let lastAudited = null;
  let lastResult = null;

  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function renderDict() {
    const defList = $('defList');
    const tagList = $('tagList');
    defList.replaceChildren();
    tagList.replaceChildren();
    const defs = Object.entries(state.defs);
    const tags = Object.entries(state.tags);
    if (!defs.length) defList.append(el('li', 'empty', '尚無定義'));
    for (const [w, d] of defs) {
      const li = el('li', null, `『${w}』＝「${d.text}」`);
      if (!d.operational) li.append(el('span', 'flag', '空泛定義'));
      if (d.history && d.history.length) li.append(el('span', 'flag', `已改 ${d.history.length} 次`));
      defList.append(li);
    }
    if (!tags.length) tagList.append(el('li', 'empty', '尚無自訂詞'));
    for (const [w, c] of tags) tagList.append(el('li', null, `『${w}』→ ${c}`));
  }

  function renderMessages(result) {
    const box = $('messages');
    box.replaceChildren();
    for (const m of result.messages) box.append(el('div', `msg ${m.level}`, m.text));
    for (const n of result.crossTurn) box.append(el('div', 'msg warn cross', `與上一輪比對：${n.text}`));
  }

  function renderHistory() {
    const box = $('history');
    box.replaceChildren();
    const past = rounds.slice(0, -1).filter((r) => !r.empty);
    box.hidden = !past.length;
    past.forEach((r, i) => {
      const d = el('details', 'history-item');
      d.append(el('summary', null, `第 ${i + 1} 輪：${r.body.slice(0, 24)}${r.body.length > 24 ? '…' : ''}`));
      d.append(el('p', null, r.body));
      const q = r.clarify && r.clarify.question;
      if (q) d.append(el('p', 'q', `問：${q.text}`));
      box.append(d);
    });
  }

  function renderSlots(cl) {
    const panel = $('slotsPanel');
    const list = $('slotsList');
    list.replaceChildren();
    const labels = templates.clarify.slotLabels;
    let any = false;
    for (const k of SLOTS) {
      const items = cl.slots[k] || [];
      if (!items.length) continue;
      any = true;
      const sec = el('div', 'slot');
      sec.append(el('h3', null, labels[k]));
      const ul = el('ul');
      // 長文時每格只列前三句，其餘收起來。
      for (const it of items.slice(0, 3)) ul.append(el('li', null, it.text));
      if (items.length > 3) ul.append(el('li', 'more', `還有 ${items.length - 3} 句`));
      sec.append(ul);
      list.append(sec);
    }
    panel.hidden = !any;
  }

  function renderResult(result) {
    const show = $('showTrace').checked;
    const section = $('result');
    const cl = result.clarify;
    if (!cl) { section.hidden = true; return; }
    section.hidden = false;
    $('restartBtn').hidden = false;

    const sf = result.safety;
    $('safetyBlock').hidden = !sf;
    if (sf) {
      $('safetyQuote').textContent = sf.quote;
      $('safetyBody').textContent = sf.body;
      $('safetyPaused').hidden = !sf.paused;
      $('safetyPaused').textContent = sf.paused ? templates.safety.paused : '';
    }

    $('draft').innerHTML = draftHtml(cl.draft.text);
    const dn = $('draftNote');
    dn.hidden = !cl.confirmed;
    dn.textContent = cl.confirmed ? cl.note : '';

    $('stuckBlock').hidden = !cl.stuck;
    $('stuck').textContent = cl.stuck ? cl.stuck.note : '';

    const qb = $('questionBlock');
    qb.hidden = !cl.question && !cl.note;
    $('question').textContent = cl.question ? cl.question.text : (cl.confirmed ? '' : cl.note);
    if (cl.confirmed) qb.hidden = true;
    qb.querySelector('.hint').hidden = !cl.question;

    renderSlots(cl);

    $('source').hidden = !show || result.empty;
    $('traceRaw').hidden = !show;
    if (show && !result.empty) {
      $('sourceText').innerHTML = highlightHtml(result.body, marksFromResult(result));
      const lines = [];
      if (cl.stuck) lines.push(`卡點 ${cl.stuck.kind}${cl.stuck.from ? `（線索：${cl.stuck.from}）` : ''}`);
      if (cl.question) lines.push(`提問 ${cl.question.templateId}`);
      for (const f of result.flaws) lines.push(`線索 ${f.ruleId} severity ${f.severity}`);
      $('traceLines').textContent = lines.join('｜');
      $('traceJson').textContent = JSON.stringify(result.trace, null, 2);
    }
  }

  function submit() {
    const input = $('input').value;
    if (!input.trim()) return;
    const result = audit(input, state, { previous: lastAudited });
    state = result.state;
    saveState(storage, state);
    rounds.push(result);
    if (!result.empty) lastAudited = result;
    lastResult = result.empty ? lastResult : result;
    renderMessages(result);
    renderHistory();
    renderDict();
    if (lastResult) renderResult(lastResult);
    $('input').value = '';
    if (!result.empty) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function restart() {
    rounds.length = 0;
    lastAudited = null;
    lastResult = null;
    $('result').hidden = true;
    $('history').hidden = true;
    $('slotsPanel').hidden = true;
    $('restartBtn').hidden = true;
    $('messages').replaceChildren();
    $('input').focus();
  }

  $('restartBtn').addEventListener('click', restart);
  $('form').addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  $('input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
  });
  $('showTrace').addEventListener('change', () => { if (lastResult) renderResult(lastResult); });

  $('exportBtn').addEventListener('click', () => {
    const blob = new win.Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = win.URL.createObjectURL(blob);
    const a = doc.createElement('a');
    a.href = url;
    a.download = 'logic-audit-state.json';
    doc.body.append(a);
    a.click();
    a.remove();
    win.setTimeout(() => win.URL.revokeObjectURL(url), 0);
  });

  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const box = $('messages');
    try {
      state = normalizeState(JSON.parse(await file.text()));
      saveState(storage, state);
      renderDict();
      box.replaceChildren(el('div', 'msg', `已匯入：${Object.keys(state.defs).length} 個定義、${Object.keys(state.tags).length} 個自訂詞。`));
    } catch (err) {
      box.replaceChildren(el('div', 'msg error', `匯入失敗：${err.message}`));
    }
    e.target.value = '';
  });

  $('resetBtn').addEventListener('click', () => {
    if (!win.confirm('確定要清除所有定義與自訂詞典嗎？')) return;
    state = emptyState();
    saveState(storage, state);
    renderDict();
    $('messages').replaceChildren(el('div', 'msg', '已清除所有自訂狀態。'));
  });

  renderDict();
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  init(document, window);
}
