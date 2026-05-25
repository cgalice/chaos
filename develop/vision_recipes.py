"""Claude Vision APIでデッキレシピ画像からカード番号+枚数を抽出する。

Tesseractの代替。1/2/3/4の混同やカード番号の誤認を大幅改善。
card_map.jsonでのファジーマッチ正規化も行う。
"""

import os
import re
import json
import base64
import time
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor, as_completed

import anthropic
from PIL import Image
from rapidfuzz import process, fuzz

RECIPE_DIR = "/home/kitajima/chaos/shots/recipe"
OUTPUT_PATH = "/home/kitajima/chaos/chaos-sim/recipes.json"
CARD_MAP_PATH = "/home/kitajima/chaos/chaos-sim/card_map.json"
MAX_WORKERS = 4       # 並列数（レートリミット対策）
MAX_HEIGHT = 3072     # 縦長画像のリサイズ上限（px）
FUZZY_CUTOFF = 88     # ファジーマッチのスコア閾値（0-100）

with open(CARD_MAP_PATH, encoding="utf-8") as f:
    CARD_MAP = json.load(f)
VALID_CARDS = list(CARD_MAP.keys())
VALID_CARDS_SET = set(VALID_CARDS)

client = anthropic.Anthropic()

# ---------------------------------------------------------------------------
# カード番号正規化
# ---------------------------------------------------------------------------

# OCR共通誤認マップ（数字部分に現れるアルファベット）
_DIGIT_FIXES = str.maketrans("OIlSZB", "011528")


def _apply_digit_fixes(s: str) -> str:
    """数字列とみなせる部分の文字を修正する"""
    # PREFIX-[SUFFIX][NUMBER] 形式で NUMBER 部分のみ変換
    m = re.match(r"^([A-Z]{1,6})(-?)([A-Z]*?)([0-9OIlSZB]{1,4}[A-Za-z]?)$", s)
    if m:
        pre, hyp, suf, num = m.groups()
        num_fixed = num.translate(_DIGIT_FIXES)
        return f"{pre}-{suf}{num_fixed}"
    return s


def normalize_card_number(raw: str) -> tuple[str, bool]:
    """
    OCR誤認を修正してcard_mapと照合。
    Returns (normalized, is_exact_match).
    """
    upper = raw.upper().strip()

    # 1) そのままマッチ
    if upper in VALID_CARDS_SET:
        return upper, True

    # 2) 数字誤認修正
    fixed = _apply_digit_fixes(upper)
    if fixed in VALID_CARDS_SET:
        return fixed, True

    # 3) ハイフン欠落補完 + ゼロパディング
    if "-" not in upper:
        m = re.match(r"^([A-Z]{1,6})([A-Z]*)(\d+[A-Z]?)$", upper)
        if m:
            g1, g2, g3 = m.groups()
            # 数字部分のゼロパディング（1→001, 12→012 など）
            num_match = re.match(r"^(\d+)([A-Z]?)$", g3)
            g3_padded = (num_match.group(1).zfill(3) + num_match.group(2)) if num_match else g3
            for trial in [
                f"{g1}-{g2}{g3}", f"{g1}{g2}-{g3}", f"{g1}-{g3}",
                f"{g1}-{g2}{g3_padded}", f"{g1}-{g3_padded}",
            ]:
                t = _apply_digit_fixes(trial)
                if t in VALID_CARDS_SET:
                    return t, True

    # 4) プレフィックス二重文字除去 (SFF-217 → SF-217 など)
    dedup = re.sub(r"^([A-Z])\1+", r"\1", upper)  # 先頭連続文字を1つに
    if dedup != upper:
        t = _apply_digit_fixes(dedup)
        if t in VALID_CARDS_SET:
            return t, True
        # ハイフン補完も試す
        m2 = re.match(r"^([A-Z]{1,6})([A-Z]*)(\d+[A-Z]?)$", dedup)
        if m2:
            g1, g2, g3 = m2.groups()
            for trial in [f"{g1}-{g2}{g3}", f"{g1}{g2}-{g3}"]:
                t2 = _apply_digit_fixes(trial)
                if t2 in VALID_CARDS_SET:
                    return t2, True

    # 5) 末尾Pサフィックス（パラレル版）の除去 (NP-T06P → NP-T06)
    if upper.endswith("P") and upper[-2].isdigit():
        stripped = upper[:-1]
        t = _apply_digit_fixes(stripped)
        if t in VALID_CARDS_SET:
            return t, True

    # 6) ファジーマッチ（短すぎるノイズは除外）
    if len(upper) >= 5:
        result = process.extractOne(
            upper, VALID_CARDS, scorer=fuzz.WRatio, score_cutoff=FUZZY_CUTOFF
        )
        if result:
            return result[0], False

    return raw, False


# ---------------------------------------------------------------------------
# 画像前処理
# ---------------------------------------------------------------------------

def prepare_image(filepath: str) -> str:
    """
    PIL で画像を読み込み、縦長すぎる場合はリサイズ。
    JPEG base64 文字列を返す。
    """
    img = Image.open(filepath).convert("RGB")
    w, h = img.size

    if h > MAX_HEIGHT:
        scale = MAX_HEIGHT / h
        img = img.resize((int(w * scale), MAX_HEIGHT), Image.LANCZOS)

    buf = BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return base64.standard_b64encode(buf.getvalue()).decode()


def prepare_image_sections(filepath: str) -> list[str]:
    """
    非常に長い画像は上下に分割してセクションリストを返す。
    MAX_HEIGHT 以内ならそのまま1要素リスト。
    """
    img = Image.open(filepath).convert("RGB")
    w, h = img.size
    section_h = MAX_HEIGHT
    overlap = 300  # セクション間のオーバーラップ（行境界でのデッキ分断防止）

    if h <= section_h:
        buf = BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return [base64.standard_b64encode(buf.getvalue()).decode()]

    sections = []
    y = 0
    while y < h:
        crop = img.crop((0, y, w, min(y + section_h, h)))
        buf = BytesIO()
        crop.save(buf, format="JPEG", quality=88)
        sections.append(base64.standard_b64encode(buf.getvalue()).decode())
        y += section_h - overlap

    return sections


# ---------------------------------------------------------------------------
# Claude Vision 呼び出し
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """You are a card game data extractor for Chaos TCG (カオス TCG).
Extract deck lists from screenshots of result pages.
Always return valid JSON only — no prose, no markdown code blocks."""

USER_PROMPT = """Extract ALL card entries from ALL deck lists visible in this image.

Card number format: [PREFIX]-[SUFFIX][NUMBER]
Examples: YZ-401, NP-T11, YZ-BPR006, SW-PR001, SKE-040
- PREFIX: 2-6 uppercase letters (e.g. YZ, NP, SW, SKE, MJSP)
- SUFFIX (optional): PR, BPR, T, SP, SD (uppercase)
- NUMBER: 3-digit zero-padded integer (e.g. 001, 040, 471)

Count rules:
- Always an integer: 1, 2, 3, or 4
- NEVER 0 or 5+
- Be especially careful distinguishing: 1 vs l/I, 2 vs Z, 3 vs 8, 4 vs A

Multiple decks appear in one page (separated by rank headers like 優勝/1位/2位 or player names).

Return ONLY this JSON structure:
{
  "decks": [
    {
      "cards": [
        {"number": "YZ-401", "count": 2},
        {"number": "YZ-408", "count": 3}
      ]
    }
  ]
}"""


def _call_vision(img_b64: str, retry: int = 3) -> dict:
    """Claude Vision API を呼び出してJSONを返す。リトライあり。"""
    for attempt in range(retry):
        try:
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg",
                                    "data": img_b64,
                                },
                            },
                            {"type": "text", "text": USER_PROMPT},
                        ],
                    }
                ],
            )
            text = msg.content[0].text.strip()
            # ```json ... ``` ブロックがあれば中身を取り出す
            code_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
            json_text = code_match.group(1) if code_match else text
            return json.loads(json_text)
        except json.JSONDecodeError:
            # JSONが不完全な場合は一部だけでも抽出を試みる
            try:
                m = re.search(r'\{.*"decks".*\}', text, re.DOTALL)
                if m:
                    return json.loads(m.group())
            except Exception:
                pass
            if attempt < retry - 1:
                time.sleep(2 ** attempt)
        except anthropic.RateLimitError:
            wait = 10 * (attempt + 1)
            print(f"  RateLimit, wait {wait}s...")
            time.sleep(wait)
        except Exception as e:
            if attempt < retry - 1:
                time.sleep(2)
            else:
                raise e
    return {"decks": []}


def extract_decks_from_image(filepath: str) -> list[list[dict]]:
    """1枚の画像から全デッキを抽出して正規化して返す。"""
    sections = prepare_image_sections(filepath)

    raw_decks: list[list[dict]] = []
    for img_b64 in sections:
        data = _call_vision(img_b64)
        for deck in data.get("decks", []):
            cards = deck.get("cards", [])
            if cards:
                raw_decks.append(cards)

    # セクション分割によるデッキ重複を除去（最初の出現を採用）
    seen_first_cards: set[str] = set()
    merged_decks: list[list[dict]] = []
    for deck in raw_decks:
        key = deck[0]["number"] if deck else ""
        if key not in seen_first_cards:
            seen_first_cards.add(key)
            merged_decks.append(deck)

    # 各カードを正規化
    result = []
    for deck in merged_decks:
        normalized = []
        for card in deck:
            raw_num = str(card.get("number", "")).strip()
            raw_count = card.get("count", 1)
            num, _ = normalize_card_number(raw_num)
            count = max(1, min(4, int(raw_count) if str(raw_count).isdigit() else 1))
            normalized.append({"number": num, "count": count})
        if normalized:
            result.append(normalized)

    return result


# ---------------------------------------------------------------------------
# メタデータ
# ---------------------------------------------------------------------------

def parse_filename(fname: str) -> dict:
    name = fname.replace("-recipe-", "").replace(".png", "")

    year_match = re.search(r"(\d{4})", name)
    year = int(year_match.group(1)) if year_match else None

    if "wgp" in name or "wpg" in name:
        event_type = "WGP"
    elif "bcf" in name:
        event_type = "BCF"
    elif "chaosfes" in name:
        event_type = "ChaosFes"
    elif "shirokurofes" in name or "shirokuro" in name:
        event_type = "白黒フェス"
    elif "murap" in name:
        event_type = "むらやまP杯"
    elif "oreyome" in name:
        event_type = "俺嫁"
    elif "chara" in name or "character" in name:
        event_type = "キャラ1"
    elif "nico" in name:
        event_type = "ニコ生"
    elif "column" in name:
        event_type = "コラム"
    elif re.match(r"^\d{4}_", name):
        event_type = "日本選手権"
    else:
        event_type = "その他"

    loc_map = {
        "akita": "秋田", "tokyo": "東京", "osaka": "大阪", "nagoya": "名古屋",
        "kyoto": "京都", "hamamatsu": "浜松", "kagoshima": "鹿児島",
        "hakata": "博多", "sapporo": "札幌", "sendai": "仙台",
        "okayama": "岡山", "kanazawa": "金沢", "yamagata": "山形",
        "makuhari": "幕張", "takamatsu": "高松", "chiba": "千葉",
        "fukuoka": "福岡", "hiroshima": "広島", "kobe": "神戸",
        "yokohama": "横浜", "niigata": "新潟",
    }
    location = next((v for k, v in loc_map.items() if k in name), "")

    return {"year": year, "event_type": event_type, "location": location, "source_file": fname}


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def process_file(fname: str) -> tuple[str, list[dict]]:
    """1ファイルを処理してレシピリストを返す。"""
    filepath = os.path.join(RECIPE_DIR, fname)
    meta = parse_filename(fname)

    decks = extract_decks_from_image(filepath)

    recipes = []
    for rank, cards in enumerate(decks, 1):
        partner = cards[0]["number"] if cards else ""
        total = sum(c["count"] for c in cards)
        recipe_id = f"{fname.replace('.png','').replace('-recipe-','').lstrip('-')}_{rank}"
        recipes.append({
            "id": recipe_id,
            "source_file": fname,
            "year": meta["year"],
            "event_type": meta["event_type"],
            "location": meta["location"],
            "rank": rank,
            "partner": partner,
            "cards": cards,
            "total": total,
        })

    return fname, recipes


def main():
    files = sorted(f for f in os.listdir(RECIPE_DIR) if f.endswith(".png"))
    print(f"レシピ画像: {len(files)}枚")

    all_recipes: list[dict] = []
    errors: list[str] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {executor.submit(process_file, f): f for f in files}
        done = 0
        for future in as_completed(futures):
            fname = futures[future]
            done += 1
            try:
                _, recipes = future.result()
                all_recipes.extend(recipes)
                deck_count = len(recipes)
                # 正規化率を簡易チェック
                total_c = sum(len(r["cards"]) for r in recipes)
                unknown_c = sum(
                    1 for r in recipes for c in r["cards"]
                    if c["number"] not in VALID_CARDS_SET
                )
                rate = f"{unknown_c}/{total_c}" if total_c else "0/0"
                print(f"[{done}/{len(files)}] {fname}: {deck_count}デッキ, 未知カード={rate}")
            except Exception as e:
                print(f"[{done}/{len(files)}] {fname}: ERROR {e}")
                errors.append(fname)

    # ファイル名順にソート
    all_recipes.sort(key=lambda r: (r["source_file"], r["rank"]))

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_recipes, f, ensure_ascii=False, indent=2)

    print(f"\n完了: {len(all_recipes)}レシピ → {OUTPUT_PATH}")
    if errors:
        print(f"エラー: {errors}")


if __name__ == "__main__":
    main()
