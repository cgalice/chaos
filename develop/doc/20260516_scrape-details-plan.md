# カード詳細スクレイピング計画

## 概要

遊々亭の個別カードページから詳細情報を取得し `card_details` テーブルに格納する。

## データソース

```
https://yuyu-tei.jp/sell/chaos/card/{ver_code}/{product_id}
```

## 取得項目

| カラム | 内容 | 例 |
|--------|------|-----|
| card_number | カード番号 | NP-003 |
| ver_code | 弾コード | ntp1.0 |
| product_id | 商品ID | 10004 |
| reading | カード名読み | テンサイ"エトワール"「スピカ」 |
| series_title | 参加作品 | スマガ |
| attribute | 属性 | 火 |
| gender | 性別 | 女 |
| atk | 攻撃力 | 6 |
| bp | 耐久力 | 6 |
| atk_mod | 攻撃力(補正) | 1 |
| bp_mod | 耐久力(補正) | - |
| effect_text | 効果テキスト | 【登場】〔自分の...〕 |
| flavor_text | フレーバーテキスト | なにやってるの？... |
| image_url | カード画像URL | https://card.yuyu-tei.jp/chaos/100_140/ntp1.0/10004.jpg |
| fetched_at | 取得日時 | 2026-05-17T02:00:00 |

## サーバー負荷対策

| 項目 | 設定 |
|------|------|
| リクエスト間隔 | 5秒 |
| 総リクエスト数 | 約15,800回 |
| 所要時間 | 約22時間 |
| 分割実行 | 1回1,000件（約1.5時間） |
| エラー対応 | 429/503→120秒待機後リトライ |
| 中断・再開 | fetched_at IS NULL のみ処理 |

## 画像URL

一覧ページのimgタグから判明した画像URLパターン:
```
https://card.yuyu-tei.jp/chaos/100_140/{ver_code}/{product_id}.jpg
```

## 実行コマンド

```bash
cd /home/alice26/chaos/develop
python3 scrape_details.py [--limit 1000]
```
