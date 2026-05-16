"""遊々亭 ChaosTCG 弾一覧ページからカード番号→商品URL対照表を構築する。"""

import requests
from bs4 import BeautifulSoup
import sqlite3
import time
import re
import sys

DB_PATH = "/home/alice26/chaos/develop/chaos_cards.db"
BASE_URL = "https://yuyu-tei.jp"
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; ChaosTCG-archiver/1.0)"}
INTERVAL = 3  # 秒


def get_ver_codes():
    """弾コード一覧を取得"""
    resp = requests.get(f"{BASE_URL}/sell/chaos/s/ntp1.0", headers=HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    codes = []
    seen = set()
    for inp in soup.find_all("input", {"name": "vers[]"}):
        v = inp.get("value", "")
        if v and v not in seen:
            seen.add(v)
            codes.append(v)
    return codes


def scrape_ver_page(ver_code):
    """弾一覧ページからカード情報を抽出（imgのalt属性から取得）"""
    url = f"{BASE_URL}/sell/chaos/s/{ver_code}"
    resp = requests.get(url, headers=HEADERS)
    if resp.status_code == 429 or resp.status_code >= 500:
        print(f"  {resp.status_code} - waiting 60s...")
        time.sleep(60)
        resp = requests.get(url, headers=HEADERS)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    cards = []
    seen = set()

    # カード画像のalt属性に "カード番号 レアリティ カード名" が入っている
    for img in soup.find_all("img", class_="card"):
        alt = img.get("alt", "").strip()
        if not alt:
            continue

        # 親のaタグからURLを取得
        a = img.find_parent("a", href=re.compile(r"/sell/chaos/card/"))
        if not a:
            continue
        href = a.get("href", "")
        m = re.search(r"/sell/chaos/card/([^/]+)/(\d+)", href)
        if not m:
            continue
        card_ver = m.group(1)
        product_id = m.group(2)

        key = (card_ver, product_id)
        if key in seen:
            continue
        seen.add(key)

        # alt解析: "NP-003 R 天才"魔女"「スピカ」"
        # パターン: カード番号 レアリティ カード名
        RARITIES = r"(?:SEC|SPR|SP|SSP|GR|ISR|IMR|ETMSP|ETMR|MHR|SPP|EXSP|RRR|SRRR|SRR|SR|SC|EXR|EX|RR|R|U|C|T|SE|S-T|S-P|PR|BPR|∞|P|UD|-)"
        alt_match = re.match(rf"^(.+?)\s+({RARITIES})\s+(.+)$", alt)
        if alt_match:
            card_number = alt_match.group(1)
            rarity = alt_match.group(2)
            card_name = alt_match.group(3)
        else:
            card_number = alt
            rarity = ""
            card_name = ""

        full_url = f"{BASE_URL}/sell/chaos/card/{card_ver}/{product_id}"
        cards.append((card_number, rarity, card_name, card_ver, product_id, full_url))

    return cards


def init_db():
    """SQLiteテーブル作成"""
    db = sqlite3.connect(DB_PATH)
    db.execute("""
        CREATE TABLE IF NOT EXISTS card_urls (
            card_number TEXT NOT NULL,
            rarity TEXT,
            card_name TEXT,
            ver_code TEXT NOT NULL,
            product_id TEXT NOT NULL,
            url TEXT NOT NULL,
            PRIMARY KEY (ver_code, product_id)
        )
    """)
    db.execute("CREATE INDEX IF NOT EXISTS idx_card_number ON card_urls(card_number)")
    db.commit()
    return db


def main():
    print("=== 遊々亭 ChaosTCG スクレイピング ===")
    print(f"DB: {DB_PATH}")
    print(f"間隔: {INTERVAL}秒\n")

    # 弾コード取得
    print("弾コード取得中...")
    ver_codes = get_ver_codes()
    print(f"  {len(ver_codes)}弾\n")
    time.sleep(INTERVAL)

    db = init_db()
    total_cards = 0

    for i, ver in enumerate(ver_codes, 1):
        print(f"[{i}/{len(ver_codes)}] {ver}...", end=" ", flush=True)
        try:
            cards = scrape_ver_page(ver)
            if cards:
                db.executemany(
                    "INSERT OR REPLACE INTO card_urls VALUES (?, ?, ?, ?, ?, ?)",
                    cards
                )
                db.commit()
            total_cards += len(cards)
            print(f"{len(cards)}件")
        except Exception as e:
            print(f"ERROR: {e}")
        time.sleep(INTERVAL)

    print(f"\n完了: {total_cards}件を{DB_PATH}に格納")
    db.close()


if __name__ == "__main__":
    main()
