// 回報：把這次對話的輸入與整理結果做成 GitHub issue 的內容。
// 不在背景傳送任何東西：只產生網址，由使用者按下按鈕後在新分頁開啟 GitHub，自己確認送出。

export const REPORT_REPO = 'tsaibohau/logical-ai';
export const REPORT_VERSION = '2026-11-04';
export const REPORT_MARKER = '<!-- logic-audit-report v1 -->';
// GitHub 新增 issue 的網址太長會失敗，超過就改用剪貼簿。
export const MAX_URL_LENGTH = 7000;

const quote = (s) => String(s).split('\n').map((l) => `> ${l}`).join('\n');
const SLOT_NAMES = { EVENT: '發生了什麼', FEELING: '感受', WANT: '想要', BLOCK: '擋住你的', WORRY: '擔心' };

/** 一輪的摘要（Markdown）。 */
export function roundSection(r, i) {
  const lines = [`### 第 ${i + 1} 輪`, '', '**輸入**', '', quote(r.input.trim()), ''];
  const cl = r.clarify;
  if (r.empty) {
    lines.push(`**指令訊息**：${r.messages.map((m) => m.text.split('\n')[0]).join('／') || '（無）'}`, '');
    return lines.join('\n');
  }
  if (r.safety) lines.push(`- **安全提示**：${r.safety.level}（${r.safety.markers.join('、')}）`);
  if (cl) {
    lines.push(`- **草稿**：${cl.draft.text}`);
    lines.push(`- **卡點**：${cl.stuck ? `${cl.stuck.kind}｜${cl.stuck.note}` : '（無）'}`);
    lines.push(`- **問題**：${cl.question ? `${cl.question.id}｜${cl.question.text}` : (cl.confirmed ? '（已確認，停止追問）' : cl.note || '（無）')}`);
    const counts = Object.entries(cl.current).filter(([, v]) => v.length).map(([k, v]) => `${SLOT_NAMES[k]} ${v.length}`);
    lines.push(`- **本輪分格**：${counts.join('、') || '（無）'}`);
    for (const [k, v] of Object.entries(cl.current)) {
      for (const it of v.slice(0, 3)) lines.push(`  - ${SLOT_NAMES[k]}：${it.text}`);
    }
  }
  const clues = (r.findings || []).filter((f) => f.severity >= 0.35).map((f) => `${f.ruleId}:${f.severity}`);
  lines.push(`- **線索**：${clues.join(' ') || '（無）'}`);
  const msgs = (r.messages || []).filter((m) => m.level !== 'info');
  if (msgs.length) lines.push(`- **提示訊息**：${msgs.map((m) => m.text).join('／')}`);
  lines.push('');
  return lines.join('\n');
}

/**
 * @param {object[]} rounds audit 結果（依輪次）
 * @param {{note?: string, now?: Date}} opts
 */
export function buildReport(rounds, opts = {}) {
  const now = opts.now || new Date();
  const title = `[回報] ${firstLine(rounds)}`;
  const body = [
    REPORT_MARKER,
    '## 說清楚：使用回報',
    '',
    `- 版本：${REPORT_VERSION}`,
    `- 輪數：${rounds.length}`,
    `- 時間：${now.toISOString()}`,
    '',
    ...rounds.map(roundSection),
    '## 哪裡怪？',
    '',
    opts.note || '（請在這裡寫你覺得哪裡不對：問得奇怪、分錯格、草稿不像你想說的……）',
    '',
  ].join('\n');
  return { title, body };
}

function firstLine(rounds) {
  const r = rounds.find((x) => !x.empty) || rounds[0];
  const t = r ? (r.body || r.input || '').replace(/\s+/g, ' ').trim() : '';
  return t.length > 30 ? `${t.slice(0, 30)}…` : t || '（空白）';
}

export function issueUrl(title, body, repo = REPORT_REPO) {
  return `https://github.com/${repo}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/**
 * 產生要開啟的網址。內容太長時回傳短版網址，並要求把完整內容放進剪貼簿。
 * @returns {{url:string, full:string, needsClipboard:boolean}}
 */
export function prepareReport(rounds, opts = {}) {
  const { title, body } = buildReport(rounds, opts);
  const url = issueUrl(title, body);
  if (url.length <= MAX_URL_LENGTH) return { url, full: body, needsClipboard: false };
  const short = [
    REPORT_MARKER,
    '## 說清楚：使用回報',
    '',
    '內容太長，網址放不下。完整回報已複製到剪貼簿，**請把這段文字整個刪掉，然後貼上**。',
    '',
  ].join('\n');
  return { url: issueUrl(title, short), full: body, needsClipboard: true };
}
