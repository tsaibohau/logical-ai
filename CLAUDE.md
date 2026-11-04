# CLAUDE.md

給之後在這個 repo 工作的 Claude。回覆使用者請用繁體中文。

## 這是什麼

「說清楚」：純前端、離線的網站，幫**不善於表達自己真正問題的人**，用他自己的字把問題拼出來。不是挑使用者的錯。

流程：輸入 → 分進五格（發生了什麼／感受／想要／擋住你的／擔心）→ 問題草稿「我想要［W］，但是［B］，我的感受是［F］。」→ 卡點 → 一次只問一題 → 回答填進被問的格子 → 草稿齊了就確認 → 使用者說「是」就停。

**核心原則：**
- 不挑錯。`src/rules.js` 的規則只當線索，畫面上不出現「漏洞」「錯誤」。
- 不鑽牛角尖。沒有困擾的事實與安排不出題（`test/audit.test.js`「不挑錯」）。
- 一次只問一題，同一題不重複問。

入口是 `src/audit.js` 的 `audit(input, userState, { previous })`，整理結果在 `result.clarify`。

## 鐵則（違反任何一條都算失敗）

0. **安全例外（優先於下面所有規則）。** 原文出現傷害自己、期待受傷、撐不下去、想結束生命等字句時（`src/safety.js`），在最上方顯示固定的求助資訊（安心專線 1925、生命線 1995、張老師 1980、119）。這是唯一允許出現「非使用者原文」與「建議」的地方，內容固定在 `data/templates.json` 的 `safety`，不得隨原文改寫。寫到想結束生命（high）時，這一輪不追問。不要為了減少誤報而移除字詞；寧可多顯示，不可漏掉。

1. **零網路、零 API、零外部資料。** `src/` 不得出現 `fetch(`、`XMLHttpRequest`、`WebSocket` 等。資料只能透過 `src/data.js` 的 JSON module 靜態載入。唯一例外是「回報給 Claude」按鈕（`src/report.js`）：只在使用者按下並確認後，用 `window.open` 開啟 GitHub 新增 issue 頁面，內容預填在網址裡，由使用者自己在 GitHub 送出。不得改成背景傳送，也不得在頁面裡放任何金鑰。
2. **輸出只能是「模板固定字串 + 使用者原文片段」。** 不得寫入使用者沒寫過的人事物或常識判斷。新增模板放 `data/templates.json`，欄位 `{X}` 等只能填原文子字串；`{D}` 填使用者 `/def` 寫下的定義。
3. **不給建議、行動清單，不寒暄、不安慰、不稱讚。**
4. **不捏造、不硬問。** 線索低於 `CONFIG.threshold` 就不算；原文看不出困擾就不出題。
5. **可追溯。** 每個 finding 帶 `ruleId` 與 `spans`（原文位置），`result.trace` 彙整所有判斷。
6. 純 HTML + ES Modules + 原生 JS。不要加打包工具、框架或 npm 執行期依賴。測試只用 `node:test`。

## 結構

- `src/tokenize.js`：先切段（空行）→ 切句（Intl.Segmenter，另補切「；」與換行）→ 詞典最長匹配直接掃原文 → Segmenter 詞界只用來填空隙。沒有 Segmenter 時退化成標點切句、單字切詞。
- `src/lexicon.js`：合併優先序 `/def` > `/tag` > 內建。含「…」的詞是不連續詞（如「要嘛…要嘛」）。
- `src/commands.js`：純函式，`parseInput` + `executeCommands`。不碰 DOM／storage。
- `src/rules.js`：8 條規則（第 8 條 `DEF_MISMATCH` 是使用者回報後加的），每條 `(tokens, sentences, state) -> Finding[]`。門檻與權重都在 `CONFIG`。
- `src/skeleton.js`、`src/questions.js`：骨架與斷點提問。
- `src/blindspots.js`：盲點，只看原文有沒有寫到代價、改變條件、反方向理由。
- `src/clarify.js`：五格分類、草稿、卡點（由線索轉換，或句型「明明知道…但…」）、提問優先序與多輪累積。引號裡的字（別人說的話）不當成使用者的想法，但引號裡的「如果…怎麼辦」算擔心。
- `src/safety.js`：安全提示偵測（見鐵則 0）。
- `src/ui.js`：上半部是可測試的純函式，`init()` 只在瀏覽器執行。
- `data/lexicon.json` 類別固定為 10 類；`data/observable.json` 是輔助字表（不能 /tag）。

## 測試與評估

```sh
node --test        # 全部測試
node eval/run.js   # 產生 eval/report.md
```

守門測試：
- `test/guard-no-network.test.js`：stub 掉 fetch/XHR/WebSocket 後跑 audit，必須零呼叫。
- `test/guard-no-external-words.test.js`：gold 每筆的草稿、卡點、提問都要能由模板 + 原文片段反推。
- `test/fixtures/long-case.txt`：使用者回報的長篇真實風格敘述，`test/audit.test.js` 有對應的回歸測試。

改規則或詞典後，兩者都要跑。`eval/gold.json` 目前是合成資料（`labeled_by: "draft"`），數字不代表真實準確度；不要為了讓 eval 數字好看而對 gold 過度調參。

## 收回報

使用者按「回報給 Claude」後會在 repo 建立標題以 `[回報]` 開頭、內文以 `<!-- logic-audit-report v1 -->` 開頭的 issue（repo 是公開的，issue 也是公開的）。使用者說「看回報」時，用 GitHub 工具列出這些 issue、逐筆讀內容，重現問題（可把輸入存成 `test/fixtures/` 的回歸測試）再修。修完是否回覆或關閉 issue，先問使用者。

## 部署

GitHub Pages：`main` 分支根目錄。所有路徑都是相對路徑，`.nojekyll` 已就位。
