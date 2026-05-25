# スマホOCR → recipes.json 変換フロー

## 全体像

```
[GitHub] shots/recipe/        [iPhone Shortcuts]          [PC] parse_ocr_text.py
323枚PNG (既存)                RecipeOCR ショートカット      テキストファイル群
  ↓ raw URL経由でダウンロード   画像を1枚ずつ処理              → card_map正規化
shortcut_urls.txt              Extract Text from Image     → recipes.json
(323件のURL一覧)               ↓
                           このiPhone内/Shortcuts/*.txt
                               ↓ 圧縮してPC転送
```

---

## Step 1: iPhone Shortcuts のセットアップ（一回だけ）

「ショートカット」アプリ → 右上`+` → 以下の6アクションを順番に追加。

### アクション一覧

**① URLの内容を取得**
```
https://raw.githubusercontent.com/CGAlice/chaos/master/develop/doc/shortcut_urls.txt
```

**② テキストを分割**
- 入力: ①の結果
- 区切り: 改行

**③ 各項目を繰り返す**
- 入力: ②の結果

**④ URLの内容を取得**（ループ内）
- URL: 繰り返し項目

**⑤ 画像からテキストを抽出**（ループ内）
- 入力: ④の結果

**⑥ ファイルを保存**（ループ内）
- 入力: ⑤の結果
- 保存先: このiPhone内 / Shortcuts /
- ファイル名: `繰り返し項目` の `最後のパスコンポーネント` + `.txt`
- 上書き確認: OFF

ショートカット名: `RecipeOCR`

---

## Step 2: 実行前の準備

- 設定 → 画面表示と明るさ → 自動ロック → **しない**
- 充電器を繋ぐ
- WiFi接続確認

---

## Step 3: Shortcut実行

`RecipeOCR` をタップ → **約30〜40分**放置

完了後、ファイルアプリ → このiPhone内 → Shortcuts に `.txt` が323件あればOK

---

## Step 4: PCへ転送

ファイルアプリ → このiPhone内 → Shortcuts フォルダを長押し → **圧縮**
→ `Shortcuts.zip` を共有 → Google Drive / メール等でPCへ

```bash
# PC側で解凍
unzip Shortcuts.zip -d /home/kitajima/chaos/shots/ocr_output/
```

---

## Step 5: JSONに変換（PC）

```bash
cd /home/kitajima/chaos
.venv/bin/python3 develop/parse_ocr_text.py
```

出力: `chaos-sim/recipes.json`

---

## トラブルシュート

### 画像からテキストを抽出が空になる
→ Live Text設定を確認: 設定 → 一般 → 言語と地域 → ライブテキスト をオン

### 元画像が縦長すぎてOCRが途中で切れる
→ `prep_for_ocr.py` で3800px以下に分割してpush、`shortcut_urls.txt` を再生成
```bash
.venv/bin/python3 develop/prep_for_ocr.py
.venv/bin/python3 develop/gen_shortcut_urls.py  # ocr_input/のURLに切り替わる
git add shots/ocr_input/ develop/doc/shortcut_urls.txt && git push
```

### デッキ分割がおかしい
→ `shots/ocr_output/` 内の該当テキストファイルを確認・修正してから再実行
