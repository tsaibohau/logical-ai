# CLAUDE.md

給之後在這個 repo 工作的 Claude。回覆使用者請用繁體中文。

## 這是什麼

純前端、離線的「邏輯審計」網站：輸入一段文字 → 輸出骨架、1～2 個漏洞、1～2 個封閉式提問。入口是 `src/audit.js` 的 `audit(input, userState, { previous })`。

## 鐵則（違反任何一條都算失敗）

1. **零網路、零 API、零外部資料。** `src/` 不得出現 `fetch(`、`XMLHttpRequest`、`WebSocket` 等。資料只能透過 `src/data.js` 的 JSON module 靜態載入。
2. **輸出只能是「模板固定字串 + 使用者原文片段」。** 不得寫入使用者沒寫過的人事物或常識判斷。新增模板放 `data/templates.json`，欄位 `{X}` 等只能填原文子字串。
3. **不給建議、行動清單，不寒暄、不安慰、不稱讚。**
4. **不捏造漏洞。** 低於 `CONFIG.threshold` 就輸出「未發現實質漏洞」。
5. **可追溯。** 每個 finding 帶 `ruleId` 與 `spans`（原文位置），`result.trace` 彙整所有判斷。
6. 純 HTML + ES Modules + 原生 JS。不要加打包工具、框架或 npm 執行期依賴。測試只用 `node:test`。

## 結構

- `src/tokenize.js`：先切段（空行）→ 切句（Intl.Segmenter，另補切「；」與換行）→ 詞典最長匹配直接掃原文 → Segmenter 詞界只用來填空隙。沒有 Segmenter 時退化成標點切句、單字切詞。
- `src/lexicon.js`：合併優先序 `/def` > `/tag` > 內建。含「…」的詞是不連續詞（如「要嘛…要嘛」）。
- `src/commands.js`：純函式，`parseInput` + `executeCommands`。不碰 DOM／storage。
- `src/rules.js`：7 條規則，每條 `(tokens, sentences, state) -> Finding[]`。門檻與權重都在 `CONFIG`。
- `src/skeleton.js`、`src/questions.js`：骨架與提問。
- `src/ui.js`：上半部是可測試的純函式，`init()` 只在瀏覽器執行。
- `data/lexicon.json` 類別固定為 10 類；`data/observable.json` 是輔助字表（不能 /tag）。

## 測試與評估

```sh
node --test        # 全部測試
node eval/run.js   # 產生 eval/report.md
```

守門測試：
- `test/guard-no-network.test.js`：stub 掉 fetch/XHR/WebSocket 後跑 audit，必須零呼叫。
- `test/guard-no-external-words.test.js`：gold 每筆的輸出都要能由模板 + 原文片段反推。

改規則或詞典後，兩者都要跑。`eval/gold.json` 目前是合成資料（`labeled_by: "draft"`），數字不代表真實準確度；不要為了讓 eval 數字好看而對 gold 過度調參。

## 部署

GitHub Pages：`main` 分支根目錄。所有路徑都是相對路徑，`.nojekyll` 已就位。
