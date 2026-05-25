"""
iOSのLive TextがOCRしたテキストファイル群をパースしてrecipes.jsonを生成する。

入力: OCR_OUTPUT_DIR/*.txt  (ファイル名が元画像と対応)
出力: chaos-sim/recipes.json
"""

import os
import re
import json
from pathlib import Path
from rapidfuzz import process, fuzz

OCR_OUTPUT_DIR = Path("/home/kitajima/chaos/shots/ocr_output")
CARD_MAP_PATH  = Path("/home/kitajima/chaos/chaos-sim/card_map.json")
OUTPUT_PATH    = Path("/home/kitajima/chaos/chaos-sim/recipes.json")
FUZZY_CUTOFF   = 88

with open(CARD_MAP_PATH, encoding="utf-8") as f:
    CARD_MAP = json.load(f)
VALID_CARDS     = list(CARD_MAP.keys())
VALID_CARDS_SET = set(VALID_CARDS)

# ---------------------------------------------------------------------------
# カード番号正規化 (vision_recipes.py と共通ロジック)
# ---------------------------------------------------------------------------

_DIGIT_FIXES = str.maketrans("OIlSZB", "011528")


def _apply_digit_fixes(s: str) -> str:
    m = re.match(r"^([A-Z]{1,6})(-?)([A-Z]*?)([0-9OIlSZB]{1,4}[A-Za-z]?)$", s)
    if m:
        pre, hyp, suf, num = m.groups()
        return f"{pre}-{suf}{num.translate(_DIGIT_FIXES)}"
    return s


def normalize_card_number(raw: str) -> tuple[str, bool]:
    upper = raw.upper().strip()
    if upper in VALID_CARDS_SET:
        return upper, True
    fixed = _apply_digit_fixes(upper)
    if fixed in VALID_CARDS_SET:
        return fixed, True
    if "-" not in upper:
        m = re.match(r"^([A-Z]{1,6})([A-Z]*)(\d+[A-Z]?)$", upper)
        if m:
            g1, g2, g3 = m.groups()
            nm = re.match(r"^(\d+)([A-Z]?)$", g3)
            g3p = (nm.group(1).zfill(3) + nm.group(2)) if nm else g3
            for trial in [f"{g1}-{g2}{g3}", f"{g1}{g2}-{g3}", f"{g1}-{g3}",
                          f"{g1}-{g2}{g3p}", f"{g1}-{g3p}"]:
                t = _apply_digit_fixes(trial)
                if t in VALID_CARDS_SET:
                    return t, True
    dedup = re.sub(r"^([A-Z])\1+", r"\1", upper)
    if dedup != upper:
        t = _apply_digit_fixes(dedup)
        if t in VALID_CARDS_SET:
            return t, True
    if upper.endswith("P") and upper[-2].isdigit():
        t = _apply_digit_fixes(upper[:-1])
        if t in VALID_CARDS_SET:
            return t, True
    # 6) S/F シリーズの誤認修正 (S/T-, C/F-, S-, ST-, F- など → S/F-)
    # card_map に F-NNN は存在しないため F-NNN は常に S/F-NNN に変換して安全
    sf_trial = None
    if re.match(r'^[A-Z]/[A-Z]-', upper):
        sf_trial = re.sub(r'^[A-Z]/[A-Z]-', 'S/F-', upper)
    elif re.match(r'^F-\d', upper):
        sf_trial = 'S/F-' + upper[2:]
    elif re.match(r'^S-\d', upper):
        sf_trial = 'S/F-' + upper[2:]
    elif re.match(r'^ST-\d', upper):
        sf_trial = 'S/F-' + upper[3:]
    if sf_trial and sf_trial != upper and sf_trial in VALID_CARDS_SET:
        return sf_trial, True

    # 7) PREFIX-PRO## → PREFIX-PR0## (PRのOが数字0に誤認: AU-PRO25 → AU-PR025)
    if '-PRO' in upper:
        trial = re.sub(r'-PRO(\d)', r'-PR0\1', upper)
        if trial != upper and trial in VALID_CARDS_SET:
            return trial, True

    # 8) ハイフン付きカードのゼロパディング (AU-30 → AU-030)
    if '-' in upper:
        parts = upper.rsplit('-', 1)
        if len(parts) == 2:
            prefix_part, num_part = parts
            nm = re.match(r'^(\d+)([A-Z]?)$', num_part)
            if nm and len(nm.group(1)) < 3:
                padded = f"{prefix_part}-{nm.group(1).zfill(3)}{nm.group(2)}"
                if padded in VALID_CARDS_SET:
                    return padded, True

    # 9) FM シリーズの誤認修正 (FF-, HV- → FM-: card_map に FF-/HV- は存在しない)
    if re.match(r'^(?:FF|HV)-\d', upper):
        trial = 'FM-' + upper[3:]
        if trial in VALID_CARDS_SET:
            return trial, True

    if len(upper) >= 5:
        result = process.extractOne(upper, VALID_CARDS, scorer=fuzz.WRatio,
                                    score_cutoff=FUZZY_CUTOFF)
        if result:
            return result[0], False
    return raw, False


# ---------------------------------------------------------------------------
# OCRテキストのパース
# ---------------------------------------------------------------------------

# カード番号パターン: 2-6文字アルファベット + ハイフン(任意) + 数字3桁前後
# S/F-NNN 形式 (S/F シリーズ) および PREFIX-PRO### (PR+0が誤認) にも対応
CARD_NUM_RE = re.compile(
    r"\b([A-Z]{1,6}(?:/[A-Z])?-?(?:BPR|PRO|PR|T|SP|SD|UD)?[0-9]{1,4}[A-Z]?)\b",
    re.IGNORECASE,
)

# 枚数パターン: 行末か行中の単独1-4の数字
COUNT_RE = re.compile(r"(?:^|\s)([1-4])(?:\s|$)")


def parse_line(line: str) -> tuple[str, int] | None:
    """
    1行からカード番号と枚数を抽出する。
    失敗したらNoneを返す。
    """
    line = line.strip()
    if not line:
        return None

    # カード番号を探す
    card_match = CARD_NUM_RE.search(line)
    if not card_match:
        return None

    card_raw = card_match.group(1).upper()

    # 枚数: カード番号の後ろにある1-4の数字を優先
    after_card = line[card_match.end():]
    count_match = re.search(r"\b([1-4])\b", after_card)
    if not count_match:
        # 行全体から探す
        count_match = COUNT_RE.search(line)
    count = int(count_match.group(1)) if count_match else 1

    return card_raw, count


# デッキ区切り行のパターン (▶デッキレシピTOPに戻る の OCR揺れ含む)
_DECK_SEP_RE = re.compile(r"TOP|デッキレシピ|deck.*recipe", re.IGNORECASE)


def parse_text_to_decks(text: str) -> list[list[dict]]:
    """
    OCRテキストを複数デッキのリストに変換する。
    ▶デッキレシピTOPに戻る または連続空行2行以上でデッキを分割する。
    """
    lines = text.split("\n")
    decks: list[list[dict]] = []
    current: list[dict] = []

    def _flush():
        if current:
            decks.append(current[:])
            current.clear()

    for line in lines:
        stripped = line.strip()

        if not stripped:
            continue

        # デッキ区切りマーカー検出 (▶デッキレシピTOPに戻る 等)
        if _DECK_SEP_RE.search(stripped) and not CARD_NUM_RE.search(stripped):
            _flush()
            continue

        result = parse_line(stripped)
        if result:
            card_raw, count = result
            num, _ = normalize_card_number(card_raw)
            current.append({"number": num, "count": count})

    if current:
        _flush()

    # デッキ内の重複カードを除去（セクションオーバーラップによる二重登録防止）
    # 同一カード番号の連続出現をまとめ、全体で最大4枚に制限
    def _dedup(deck: list[dict]) -> list[dict]:
        seen: dict[str, int] = {}
        result = []
        for card in deck:
            n = card["number"]
            cnt = seen.get(n, 0) + card["count"]
            if seen.get(n, 0) < 4:
                add = min(card["count"], 4 - seen.get(n, 0))
                result.append({"number": n, "count": add})
                seen[n] = cnt
        return result

    decks = [_dedup(d) for d in decks]

    # 枚数合計が3未満のデッキは前のデッキと結合（区切り誤判定の修正）
    merged: list[list[dict]] = []
    for deck in decks:
        total = sum(c["count"] for c in deck)
        if merged and total < 3:
            merged[-1].extend(deck)
        else:
            merged.append(deck)

    # 累積50枚超でデッキを自動分割 (TOPマーカー未検出時のフォールバック)
    result_decks: list[list[dict]] = []
    for deck in merged:
        sub: list[dict] = []
        sub_total = 0
        for card in deck:
            if sub_total >= 50 and sub:
                result_decks.append(sub)
                sub = []
                sub_total = 0
            sub.append(card)
            sub_total += card["count"]
        if sub:
            result_decks.append(sub)

    return result_decks


# ---------------------------------------------------------------------------
# ファイル名からメタデータ
# ---------------------------------------------------------------------------

def parse_stem(stem: str) -> dict:
    """
    OCR出力ファイル名(stem)から元画像のstemを復元してメタデータを返す。
    例: "-recipe-2018_akita_p01" → 元は "-recipe-2018_akita.png"
    """
    # _p01 などのセクションサフィックスを除去
    original_stem = re.sub(r"_p\d+$", "", stem)
    fname = original_stem + ".png"

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

    return {
        "year": year,
        "event_type": event_type,
        "location": location,
        "source_file": fname,
        "original_stem": original_stem,
    }


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------

def main():
    # Shortcuts が "-recipe-xxx.png.txt" と付ける場合もあるので両方拾う
    txt_files = sorted({
        *OCR_OUTPUT_DIR.glob("*.txt"),
        *OCR_OUTPUT_DIR.glob("*.png.txt"),
    }, key=lambda p: p.name)
    print(f"OCRテキストファイル: {len(txt_files)}件")

    if not txt_files:
        print(f"エラー: {OCR_OUTPUT_DIR} にテキストファイルが見つかりません")
        return

    # 同じ元画像のセクションを結合するためにグループ化
    # キー: original_stem, 値: [(section_idx, text)]
    groups: dict[str, list[tuple[int, str]]] = {}
    for txt_path in txt_files:
        # .png.txt → stem は .png までの部分を取る
        stem = txt_path.name.removesuffix(".txt").removesuffix(".png")
        # セクション番号を取得 (_p01 → 1, なければ 0)
        sec_match = re.search(r"_p(\d+)$", stem)
        sec_idx = int(sec_match.group(1)) if sec_match else 0
        original_stem = re.sub(r"_p\d+$", "", stem)
        groups.setdefault(original_stem, []).append(
            (sec_idx, txt_path.read_text(encoding="utf-8"))
        )

    print(f"元画像グループ: {len(groups)}件")

    all_recipes: list[dict] = []

    for original_stem, sections in sorted(groups.items()):
        # セクション順にソートして結合
        sections.sort(key=lambda x: x[0])
        combined_text = "\n\n".join(text for _, text in sections)

        meta = parse_stem(original_stem)
        decks = parse_text_to_decks(combined_text)

        # 全デッキのカード数チェック
        total_cards = sum(len(d) for d in decks)
        unknown = sum(
            1 for d in decks for c in d if c["number"] not in VALID_CARDS_SET
        )

        for rank, cards in enumerate(decks, 1):
            partner = cards[0]["number"] if cards else ""
            recipe_id = f"{original_stem.lstrip('-').replace('-recipe-', '')}_{rank}"
            all_recipes.append({
                "id": recipe_id,
                "source_file": meta["source_file"],
                "year": meta["year"],
                "event_type": meta["event_type"],
                "location": meta["location"],
                "rank": rank,
                "partner": partner,
                "cards": cards,
                "total": sum(c["count"] for c in cards),
            })

        rate = f"{unknown}/{total_cards}" if total_cards else "-"
        print(f"  {original_stem}: {len(decks)}デッキ, 未知={rate}")

    all_recipes.sort(key=lambda r: (r["source_file"], r["rank"]))

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(all_recipes, f, ensure_ascii=False, indent=2)

    total_unknown = sum(
        1 for r in all_recipes for c in r["cards"] if c["number"] not in VALID_CARDS_SET
    )
    total_cards = sum(len(r["cards"]) for r in all_recipes)
    print(f"\n完了: {len(all_recipes)}レシピ, "
          f"未知カード={total_unknown}/{total_cards} "
          f"({total_unknown/total_cards*100:.1f}%)")
    print(f"出力: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
