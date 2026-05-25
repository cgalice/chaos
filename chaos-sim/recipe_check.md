# デッキレシピ OS整合性チェック

## 統計
- 総数: 2608
- 正常(60枚, OS正常): 33
- incomplete(60枚未満): 2445
- over(60枚超過): 106
- os_mix(OS混在): 1527

## フラグ仕様
`recipes.json`の各レシピに`flags`配列を付与:
- `incomplete` — 合計60枚未満（人力補完が必要）
- `over` — 合計60枚超過（OCR誤認識の可能性）
- `os_mix` — ネオスタンダードOS違反（特例ルール考慮済み）

フラグなし = 正常レシピ

## 画像参照
`source_img`フィールドにGitHub raw URLを格納済み。
例: `https://raw.githubusercontent.com/CGAlice/chaos/master/shots/recipe/-recipe-2018_akita.png`
