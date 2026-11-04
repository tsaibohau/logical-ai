# 評估報告

> **警告：以下數字來自 `eval/gold.json` 的 30 筆合成資料（`labeled_by: "draft"`），由同一個開發流程撰寫與標註，不能當作真實準確度。** 真實準確度需以真實輸入與人工標註重新評估。

- 資料筆數：30（應有漏洞 21、應無漏洞 9）
- 門檻 threshold：0.35；每次最多輸出 2 項

## 每條規則（以實際輸出的 1～2 項計算）

| 規則 | TP | FP | FN | Precision | Recall | 門檻以上即算的 Recall |
|---|---:|---:|---:|---:|---:|---:|
| OVERGENERALIZE | 3 | 4 | 1 | 43% | 75% | 75% |
| CAUSAL_JUMP | 3 | 0 | 1 | 100% | 75% | 75% |
| UNDEFINED_TERM | 6 | 0 | 1 | 100% | 86% | 86% |
| FALSE_BINARY | 3 | 0 | 0 | 100% | 100% | 100% |
| MINDREAD | 2 | 0 | 1 | 100% | 67% | 67% |
| EMOTION_AS_FACT | 3 | 0 | 0 | 100% | 100% | 100% |
| GOAL_CONFLICT | 3 | 0 | 0 | 100% | 100% | 100% |
| DEF_MISMATCH | 0 | 0 | 0 | — | — | — |
| **合計（micro）** | 23 | 4 | 4 | 85% | 85% | |

## 整體

- 無漏洞案例誤報率：0/9 = 0%
- 有漏洞案例完全漏抓（輸出無漏洞）：1/21 = 5%
- 骨架命中率：28/30 = 93%
- 完全正確的案例：24/30

## 失敗案例

### g04

```
因為我胖，所以沒人喜歡我。
```
- 期望：CAUSAL_JUMP、OVERGENERALIZE；實際：CAUSAL_JUMP
- 骨架輸出：無可確認事實
- 問題：漏報 OVERGENERALIZE
- 全部候選：CAUSAL_JUMP:0.63

### g06

```
昨天沒睡好，結果今天報告講得很爛。
```
- 期望：CAUSAL_JUMP、UNDEFINED_TERM；實際：（無漏洞）
- 骨架輸出：無可確認事實。尚未定義：『好』、『爛』
- 問題：漏報 CAUSAL_JUMP；漏報 UNDEFINED_TERM；應有漏洞卻輸出「未發現實質漏洞」；骨架未命中（期望含「昨天沒睡好」）
- 全部候選：CAUSAL_JUMP:0.33 UNDEFINED_TERM:0.3 UNDEFINED_TERM:0.15

### g13

```
同事最近都不約我吃飯，他們一定是覺得我很無聊。
```
- 期望：MINDREAD；實際：MINDREAD、OVERGENERALIZE
- 骨架輸出：無可確認事實
- 問題：誤報 OVERGENERALIZE
- 全部候選：MINDREAD:0.65 OVERGENERALIZE:0.56

### g14

```
她已讀不回，她心裡一定在嫌棄我。
```
- 期望：MINDREAD；實際：MINDREAD、OVERGENERALIZE
- 骨架輸出：她已讀不回
- 問題：誤報 OVERGENERALIZE
- 全部候選：MINDREAD:0.73 OVERGENERALIZE:0.48

### g15

```
主管把案子交給別人，他根本就不信任我。
```
- 期望：MINDREAD；實際：OVERGENERALIZE
- 骨架輸出：無可確認事實
- 問題：誤報 OVERGENERALIZE；漏報 MINDREAD；骨架未命中（期望含「主管把案子交給別人」）
- 全部候選：OVERGENERALIZE:0.48

### g16

```
我真的受不了了，這段關係根本就是錯的。
```
- 期望：EMOTION_AS_FACT；實際：EMOTION_AS_FACT、OVERGENERALIZE
- 骨架輸出：無可確認事實
- 問題：誤報 OVERGENERALIZE
- 全部候選：EMOTION_AS_FACT:0.6 OVERGENERALIZE:0.48

