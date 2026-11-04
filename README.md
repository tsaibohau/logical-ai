# 邏輯審計（logic-audit）

一個純前端、完全離線的網站。貼上一段描述自己狀況或想法的文字，系統**只根據這段文字本身**輸出三個區塊：

1. **站得住腳的骨架**：從原文挑出一句（或一個子句）客觀可確認的事實，原樣輸出不改寫。找不到時輸出「無可確認事實」，並列出尚未定義的詞。
2. **致命邏輯漏洞／隱性假設**：1～2 項，只揭露原文內部的矛盾。全部低於門檻時輸出「未發現實質漏洞」。
3. **逼近本質的提問**：1～2 個封閉或半封閉問題（二選一、給數字、給界線、做取捨）。

不連網、不呼叫 API、沒有背景知識庫。所有輸出都是「模板固定字串 + 使用者原文片段」（含使用者自己 `/def` 寫下的定義）。已定義的詞不會再被追問邊界；它會被拿來比對：如果你用另一套依據證明它，會被指出「定義不符」。

## 使用

- 直接打字或貼上文字，按「送出」（或 Ctrl/⌘ + Enter）。
- 打開「顯示判斷依據」可以在原文上看到命中的詞、觸發的規則 id、位置與 severity。
- 在**行首**用斜線指令定義你的詞，指令行不會被審計：

| 指令 | 作用 |
|---|---|
| `/def 詞 = 定義` | 定義一個詞，之後不再被當成「未定義詞」。定義本身也會被檢查：沒有數字、時間範圍或可觀察行為會警告「空泛定義」；重複定義且內容不同會提示「定義漂移」。 |
| `/undef 詞` | 取消定義 |
| `/defs` | 列出所有定義 |
| `/tag 詞 = 類別` | 把詞加入自訂詞典（類別：ABSOLUTE、CAUSAL、OBLIGATION、MINDREAD、EMOTION、BINARY、ABSTRACT、VAGUE、GOAL、CONTRAST） |
| `/untag 詞` | 移除自訂標記 |
| `/reset` | 清除所有自訂狀態（要再輸入 `/reset 確認`） |
| `/help` | 顯示說明 |

全形／半形斜線、`=`／`＝`、前後空白都接受。定義與自訂詞存在瀏覽器的 `localStorage`，可在「定義與詞典」面板匯出／匯入 JSON。

## 八條漏洞規則

| id | 名稱 | 觸發條件（簡述） |
|---|---|---|
| `OVERGENERALIZE` | 以偏概全 | 出現絕對詞，且同段落沒有任何數字 |
| `CAUSAL_JUMP` | 因果跳接 | 有因果詞，但因與果都很短且沒有共同內容、只有時間先後，或把結果寫成必然（「只要…就一定」） |
| `UNDEFINED_TERM` | 未定義詞 | 抽象評價詞沒被 `/def`，且所在句沒有數字或標準用語 |
| `FALSE_BINARY` | 偽二選一 | 二選一句式，且全文沒有列出第三個選項 |
| `MINDREAD` | 讀心 | 推定他人想法，同句與下一句沒有「他說／她寫／對方表示」之類的依據 |
| `EMOTION_AS_FACT` | 情緒當事實 | 情緒詞與結論詞（義務、絕對、抽象評價）在同一句 |
| `GOAL_CONFLICT` | 目標衝突 | 同段兩個以上目標詞，中間有轉折詞，兩端目的不同 |
| `DEF_MISMATCH` | 定義不符 | 用了已 `/def` 的詞並給出依據（數字或因果詞），但依據裡沒有出現定義的內容 |

門檻與權重集中在 `src/rules.js` 的 `CONFIG`。詞與權重在 `data/lexicon.json`，提問與描述模板在 `data/templates.json`，都可以手動編輯。

## 準確度（重要）

`eval/report.md` 裡的數字來自 `eval/gold.json` 的 **30 筆合成資料**，由開發流程自己撰寫與標註（`labeled_by: "draft"`），**不能當作真實準確度**。要知道真實表現，需要用真實輸入與人工標註取代 gold 後重跑：

```sh
node eval/run.js
```

## 開發

需求：Node 20 以上（使用內建 `node:test` 與 JSON import attributes）。沒有任何 npm 依賴、沒有打包工具。

```sh
npm test          # 或 node --test
npm run eval      # 產生 eval/report.md
```

本機預覽（ES Modules 不能用 `file://` 開啟，需要任一靜態伺服器）：

```sh
python3 -m http.server 8000
# 打開 http://localhost:8000/
```

## 部署到 GitHub Pages

1. 到 GitHub repo 的 **Settings → Pages**。
2. **Source** 選 **Deploy from a branch**。
3. **Branch** 選 `main`，資料夾選 `/ (root)`，按 **Save**。
4. 一兩分鐘後網站會出現在 `https://<帳號>.github.io/<repo 名稱>/`。

repo 根目錄有 `.nojekyll`，讓 Pages 原樣提供所有檔案。所有路徑都是相對路徑，放在子路徑下也能運作。

瀏覽器需支援 ES Modules 的 JSON import（`import … with { type: 'json' }`）：Chrome／Edge 123+、Safari 17.2+、Firefox 138+。

## 目錄

```
index.html, style.css
src/
  tokenize.js   切句、最長匹配切詞、數字／時間／否定抽取
  lexicon.js    詞典合併（/def > /tag > 內建）
  commands.js   斜線指令解析與執行
  rules.js      8 條漏洞規則與 CONFIG
  skeleton.js   骨架挑選
  questions.js  提問模板與選題
  audit.js      全流程 audit(text, userState, opts)
  ui.js         DOM 與 localStorage
  data.js       以 JSON module 載入 data/
data/
  lexicon.json      內建詞典（10 類）
  observable.json   輔助字表（可觀察行為、言行依據、標準用語、防誤切詞）
  templates.json    漏洞描述與提問模板
eval/  gold.json, run.js, report.md
test/  單元測試與守門測試
```
