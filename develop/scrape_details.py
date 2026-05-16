"""遊々亭 ChaosTCG 個別カードページから詳細情報を取得する。"""

import requests
from bs4 import BeautifulSoup
import sqlite3
import time
import re
import sys
from datetime import datetime

DB_PATH = "/home/alice26/chaos/develop/chaos_cards.db"
BASE_URL = "https://yuyu-tei.jp"
IMAGE_BASE = "https://card.yuyu-tei.jp/chaos/100_140"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ChaosTCG-archiver/1.0)"}
INTERVAL = 5
RETRY_WAIT = 120


def init_details_table(db):
    db.execute("""
        CREATE TABLE IF NOT EXISTS card_details (
            card_number TEXT NOT NULL,
            ver_code TEXT NOT NULL,
            product_id TEXT NOT NULL,
            reading TEXT,
            series_title TEXT,
            attribute TEXT,
            gender TEXT,
            atk TEXT,
            bp TEXT,
            atk_mod TEXT,
            bp_mod TEXT,
            effect_text TEXT,
            flavor_text TEXT,
            image_url TEXT,
            fetched_at TEXT,
            PRIMARY KEY (ver_code, product_id)
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_details_card ON card_details(card_number)")
    db.commit()


def get_pending_urls(db, limit=None):
    """未取得のURLを取得（カード番号ごとに1件）"""
    query = """
        SELECT cu.card_number, cu.ver_code, cu.product_id, cu.url
        FROM card_urls cu
        LEFT JOIN card_details cd ON cu.ver_code = cd.ver_code AND cu.product_id = cd.product_id
        WHERE cd.fetched_at IS NULL
        GROUP BY cu.card_number
        ORDER BY cu.ver_code, cu.product_id
    """
    if limit:
        query += f" LIMIT {limit}"
    return db.execute(query).fetchall()


def parse_detail_page(html, ver_code, product_id):
    """個別ページHTMLからカード情報を抽出"""
    soup = BeautifulSoup(html, "html.parser")
    info = {}

    # 最初のテーブルから情報取得
    table = soup.find("table")
    if table:
        rows = table.find_all("tr")
        i = 0
        while i < len(rows):
            cells = rows[i].find_all(["th", "td"])
            texts = [c.get_text(strip=True) for c in cells]

            if len(texts) == 2:
                key, val = texts
                if key == "参加作品":
                    info["series_title"] = val
                elif key == "属性":
                    info["attribute"] = val
                elif key == "性別":
                    info["gender"] = val
                elif key == "攻撃力":
                    info["atk"] = val
                elif key == "耐久力":
                    info["bp"] = val
                elif key == "攻撃力(補正)":
                    info["atk_mod"] = val
                elif key == "耐久力(補正)":
                    info["bp_mod"] = val
            elif len(texts) == 4:
                for j in range(0, 4, 2):
                    key, val = texts[j], texts[j+1]
                    if key == "属性":
                        info["attribute"] = val
                    elif key == "性別":
                        info["gender"] = val
                    elif key == "攻撃力":
                        info["atk"] = val
                    elif key == "耐久力":
                        info["bp"] = val
                    elif key == "攻撃力(補正)":
                        info["atk_mod"] = val
                    elif key == "耐久力(補正)":
                        info["bp_mod"] = val
            elif len(texts) == 1:
                # ヘッダー行→次の行が値
                key = texts[0]
                if key in ("効果", "フレーバー") and i + 1 < len(rows):
                    val = rows[i+1].get_text(strip=True)
                    if key == "効果":
                        info["effect_text"] = val
                    else:
                        info["flavor_text"] = val
                    i += 1
            i += 1

    # 読み: h3タグから "カード名（読み）" を抽出
    for h3 in soup.find_all("h3"):
        text = h3.get_text(strip=True)
        m = re.search(r'[（(]([^）)]+)[）)]', text)
        if m and any(c in text for c in ['「', '"', '＆']):
            info["reading"] = m.group(1)
            break

    info["image_url"] = f"{IMAGE_BASE}/{ver_code}/{product_id}.jpg"
    return info


def main():
    limit = None
    if len(sys.argv) > 1 and sys.argv[1] == "--limit":
        limit = int(sys.argv[2])

    print(f"=== カード詳細スクレイピング ===")
    print(f"間隔: {INTERVAL}秒")
    if limit:
        print(f"上限: {limit}件")

    db = sqlite3.connect(DB_PATH)
    init_details_table(db)

    pending = get_pending_urls(db, limit)
    print(f"未取得: {len(pending)}件\n")

    if not pending:
        print("全件取得済み")
        return

    success = 0
    errors = 0

    for i, (card_number, ver_code, product_id, url) in enumerate(pending, 1):
        print(f"[{i}/{len(pending)}] {card_number} ({ver_code}/{product_id})...", end=" ", flush=True)
        try:
            resp = requests.get(url, headers=HEADERS, timeout=30)
            if resp.status_code == 429 or resp.status_code >= 500:
                print(f"{resp.status_code} - waiting {RETRY_WAIT}s...")
                time.sleep(RETRY_WAIT)
                resp = requests.get(url, headers=HEADERS, timeout=30)
            resp.raise_for_status()

            info = parse_detail_page(resp.text, ver_code, product_id)
            now = datetime.now().isoformat()

            db.execute("""
                INSERT OR REPLACE INTO card_details
                (card_number, ver_code, product_id, reading, series_title,
                 attribute, gender, atk, bp, atk_mod, bp_mod,
                 effect_text, flavor_text, image_url, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                card_number, ver_code, product_id,
                info.get("reading"), info.get("series_title"),
                info.get("attribute"), info.get("gender"),
                info.get("atk"), info.get("bp"),
                info.get("atk_mod"), info.get("bp_mod"),
                info.get("effect_text"), info.get("flavor_text"),
                info.get("image_url"), now
            ))
            db.commit()
            success += 1
            print("OK")

        except Exception as e:
            errors += 1
            print(f"ERROR: {e}")

        time.sleep(INTERVAL)

    print(f"\n完了: 成功={success}, エラー={errors}")
    db.close()


if __name__ == "__main__":
    main()
