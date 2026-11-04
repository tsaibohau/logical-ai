# 說清楚

**很多人說不出自己真正卡在哪裡**：只會講一堆感受、抱怨或片段。這個網站不挑你的錯，而是用**你自己的字**，一輪一輪幫你把真正的問題拼出來。

純前端、完全離線：不連網、不呼叫 API、沒有背景知識庫。所有輸出都是「模板固定字串 + 你寫下的原文片段」。

## 它怎麼運作

1. **你說了什麼**：把你的句子分進五格：發生了什麼、你的感受、你想要的、擋住你的、你擔心的。
2. **你的問題草稿**：用你自己的字拼成一句，缺的格子顯示「？」：

   > 我想要［可以準時下班］，但是［專案一直被插單］，我的感受是［很累］。

3. **你可能卡在這裡**：從你的文字結構找出卡點，例如兩個想要在拉扯、覺得只剩兩條路、很在意別人怎麼看你、心裡的標準和拿來衡量的不是同一把尺。
4. **下一個問題（一次只問一題）**：補最關鍵的空格。你直接回答，答案會填進被問的那一格，草稿越來越完整；草稿齊了就問「是這件事嗎？」，你回答「是」就停止追問。

沒有困擾的文字（例如「要搬家，所以先打包」）不會被追問。

**安全提示**：原文寫到傷害自己、期待受傷、撐不下去或想結束生命時，最上方會顯示固定的求助資訊（安心專線 1925（24 小時）、生命線 1995、張老師 1980、緊急時 119）。這是唯一不只使用你原文的地方。寫到想結束生命時，那一輪不會追問。

### 一段實際的對話

| 你寫 | 系統問 |
|---|---|
| 我也不知道怎麼說，就是覺得很累，每天上班都提不起勁。 | 讓你「很累」的，是哪一件具體發生的事？ |
| 昨天又加班到十點。 | 關於「昨天又加班到十點」，你最希望哪件事改變？ |
| 我希望可以準時下班。 | 你想要「可以準時下班」，現在是什麼擋住了它？ |
| 專案一直被插單。 | 如果只能先解決一件事，是「專案一直被插單」嗎？ |
| 對 | （停止追問）這就是你想說的問題。 |

## 使用

- 直接打字或貼上文字，按「送出」（或 Ctrl/⌘ + Enter）。回答下一個問題時一樣寫在輸入框。按「重新開始」清空這次對話（定義會保留）。
- 打開「顯示判斷依據」可以在原文上看到每個子句被分進哪一格，以及卡點來自哪一條線索。
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

## 線索（不對使用者顯示）

原本的推論規則保留在 `src/rules.js`，現在只當成找卡點的**線索**，畫面上不會出現「漏洞」「錯誤」：

| 線索 | 轉成的卡點 |
|---|---|
| `DEF_MISMATCH` 定義不符 | 你心裡的標準和拿來衡量的不是同一把尺 |
| `GOAL_CONFLICT` 目標衝突 | 兩個想要在拉扯 |
| `FALSE_BINARY` 偽二選一 | 你覺得只剩兩條（或一條）路 |
| `MINDREAD` 讀心 | 你很在意別人怎麼看你 |
| `EMOTION_AS_FACT` 情緒當事實 | 感受讓你得出了某個結論 |
| `CAUSAL_JUMP` 因果跳接 | 你把一件事連到另一件事上 |
| `OVERGENERALIZE` 以偏概全 | 這件事聽起來不是第一次 |
| `UNDEFINED_TERM` 未定義詞 | 問你這個詞具體是什麼樣子 |

盲點（`src/blindspots.js`：代價未寫、改變條件、只看一邊）在草稿成形、而且你寫到了決定時才會問。

門檻與權重在 `src/rules.js` 的 `CONFIG`；五格分類、卡點與提問順序在 `src/clarify.js`；詞與權重在 `data/lexicon.json`，所有模板在 `data/templates.json`。

## 準確度（重要）

`eval/report.md` 只評估**線索偵測**，數字來自 `eval/gold.json` 的 **40 筆合成資料**，由開發流程自己撰寫與標註（`labeled_by: "draft"`），**不能當作真實準確度**。「草稿有沒有說中使用者真正的問題」目前沒有評估，需要真人測試。要知道真實表現，需要用真實輸入與人工標註取代 gold 後重跑：

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
  rules.js      8 條線索規則與 CONFIG
  skeleton.js   骨架挑選
  blindspots.js 盲點判斷（代價、改變條件、只看一邊）
  clarify.js    五格分類、問題草稿、卡點、一次一題
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
