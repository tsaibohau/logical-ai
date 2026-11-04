// 斜線指令解析與執行。純函式：不碰 DOM、不碰 localStorage。
import { CATEGORIES, buildLexicon, emptyState } from './lexicon.js';
import { tokenize } from './tokenize.js';

const CMD_LINE = /^[ \t　]*[\/／]/;
const EQ = /[=＝]/;

export const HELP_TEXT = [
  '/def 詞 = 定義　定義一個詞；之後該詞不再被當成未定義詞。',
  '/undef 詞　取消定義。',
  '/defs　列出目前所有定義。',
  '/tag 詞 = 類別　把詞加入自訂詞典。類別：' + CATEGORIES.join('、'),
  '/untag 詞　移除自訂標記。',
  '/reset　清除所有自訂狀態（需再輸入「/reset 確認」）。',
  '/help　顯示這份說明。',
  '指令必須寫在行首；指令行不會被審計。',
].join('\n');

const RESET_CONFIRM = new Set(['確認', 'confirm', 'yes', 'y']);

function cleanSpaces(s) {
  return s.replace(/^[\s　]+|[\s　]+$/g, '');
}

/**
 * 把輸入拆成指令與待審計本文。
 * @returns {{commands: {name:string,arg:string,raw:string,lineNo:number}[], body:string}}
 */
export function parseInput(input) {
  const lines = String(input ?? '').split(/\r?\n/);
  const commands = [];
  const bodyLines = [];
  lines.forEach((line, lineNo) => {
    if (!CMD_LINE.test(line)) { bodyLines.push(line); return; }
    const rest = line.replace(CMD_LINE, '');
    const m = rest.match(/^([A-Za-zＡ-Ｚａ-ｚ]*)(.*)$/s);
    const name = m[1].normalize('NFKC').toLowerCase();
    commands.push({ name, arg: cleanSpaces(m[2]), raw: line, lineNo });
  });
  const body = bodyLines.join('\n').replace(/^\s+|\s+$/g, '');
  return { commands, body };
}

function splitAssign(arg) {
  const m = arg.match(EQ);
  if (!m) return null;
  const i = m.index;
  return { left: cleanSpaces(arg.slice(0, i)), right: cleanSpaces(arg.slice(i + 1)) };
}

function cloneState(state) {
  const s = state || emptyState();
  return {
    defs: Object.fromEntries(Object.entries(s.defs || {}).map(([k, v]) => [k, { ...v, history: [...(v.history || [])] }])),
    tags: { ...(s.tags || {}) },
  };
}

/**
 * 審計一則定義本身：是否可操作、是否循環、仍含哪些抽象詞。
 * 只檢查使用者給的字串，不補充任何外部知識。
 */
export function checkDefinition(word, text, state) {
  const others = cloneState(state);
  delete others.defs[word];
  const lex = buildLexicon(others);
  const r = tokenize(text, lex);
  const numbers = r.numbers.map((t) => t.text);
  const times = r.times.map((t) => t.text);
  const actions = r.tokens.filter((t) => t.tags.includes('ACTION')).map((t) => t.text);
  const abstract = [...new Set(r.tokens
    .filter((t) => t.tags.includes('ABSTRACT') && !t.tags.includes('DEFINED'))
    .map((t) => t.text))];
  const circular = text.includes(word);
  const operational = numbers.length + times.length + actions.length > 0;
  return { operational, circular, numbers, times, actions, abstract };
}

/**
 * 依序執行指令，回傳新狀態與訊息。不會因單一錯誤中斷。
 * @returns {{state, messages: {level:'info'|'warn'|'error', cmd:string, text:string, data?:any}[]}}
 */
export function executeCommands(commands, state) {
  let s = cloneState(state);
  const messages = [];
  const say = (level, cmd, text, data) => messages.push(data ? { level, cmd, text, data } : { level, cmd, text });

  for (const c of commands) {
    const cmd = c.name;
    switch (cmd) {
      case 'def': {
        const a = splitAssign(c.arg);
        if (!a || !a.left || !a.right) { say('error', cmd, '格式應為：/def 詞 = 定義'); break; }
        const { left: word, right: text } = a;
        const prev = s.defs[word];
        if (prev && prev.text === text) { say('info', cmd, `『${word}』的定義未變更。`); break; }
        const q = checkDefinition(word, text, s);
        const history = prev ? [...prev.history, prev.text] : [];
        s.defs[word] = { text, history, operational: q.operational };
        say('info', cmd, `已定義『${word}』＝「${text}」。`);
        if (prev) {
          say('warn', cmd, `定義漂移：『${word}』前一版是「${prev.text}」，這一版是「${text}」。`, {
            kind: 'drift', word, before: prev.text, after: text,
          });
        }
        if (q.circular) {
          say('warn', cmd, `循環定義：『${word}』的定義裡又出現了『${word}』。`, { kind: 'circular', word });
        }
        if (!q.operational) {
          const tail = q.abstract.length ? `定義中仍屬抽象評價的詞：${q.abstract.map((w) => `『${w}』`).join('、')}。` : '';
          say('warn', cmd, `空泛定義：「${text}」沒有數字、時間範圍或可觀察的行為。${tail}`, {
            kind: 'vague', word, abstract: q.abstract,
          });
        }
        break;
      }
      case 'undef': {
        const word = c.arg;
        if (!word) { say('error', cmd, '格式應為：/undef 詞'); break; }
        if (!s.defs[word]) { say('error', cmd, `『${word}』目前沒有定義。`); break; }
        delete s.defs[word];
        say('info', cmd, `已取消『${word}』的定義。`);
        break;
      }
      case 'defs': {
        const entries = Object.entries(s.defs);
        if (!entries.length) { say('info', cmd, '目前沒有任何定義。'); break; }
        say('info', cmd, entries.map(([w, d]) => `『${w}』＝「${d.text}」`).join('\n'), { kind: 'list', defs: s.defs });
        break;
      }
      case 'tag': {
        const a = splitAssign(c.arg);
        if (!a || !a.left || !a.right) { say('error', cmd, '格式應為：/tag 詞 = 類別'); break; }
        const cat = a.right.normalize('NFKC').toUpperCase();
        if (!CATEGORIES.includes(cat)) {
          say('error', cmd, `未知類別「${a.right}」。可用類別：${CATEGORIES.join('、')}`);
          break;
        }
        const prev = s.tags[a.left];
        s.tags[a.left] = cat;
        if (prev && prev !== cat) say('warn', cmd, `『${a.left}』原本標為 ${prev}，改為 ${cat}。`, { kind: 'retag', word: a.left, before: prev, after: cat });
        else say('info', cmd, `已將『${a.left}』標為 ${cat}。`);
        break;
      }
      case 'untag': {
        const word = c.arg;
        if (!word) { say('error', cmd, '格式應為：/untag 詞'); break; }
        if (!s.tags[word]) { say('error', cmd, `『${word}』沒有自訂標記。`); break; }
        delete s.tags[word];
        say('info', cmd, `已移除『${word}』的自訂標記。`);
        break;
      }
      case 'reset': {
        if (!RESET_CONFIRM.has(c.arg.toLowerCase())) {
          say('warn', cmd, '這會清除所有定義與自訂標記。確定的話請輸入：/reset 確認', { kind: 'confirm-reset' });
          break;
        }
        s = emptyState();
        say('info', cmd, '已清除所有自訂狀態。');
        break;
      }
      case 'help': {
        say('info', cmd, HELP_TEXT);
        break;
      }
      default:
        say('error', cmd, `未知指令：${c.raw.trim()}。輸入 /help 看全部指令。`);
    }
  }
  return { state: s, messages };
}
