"""デッキレシピスクリーンショットからカード番号+枚数をOCR抽出する。"""

import os
import re
import json
from PIL import Image, ImageEnhance
import pytesseract

RECIPE_DIR = "/home/alice26/chaos/shots/recipe"
OUTPUT_PATH = "/home/alice26/chaos/chaos-sim/recipes.json"


def parse_filename(fname):
    """ファイル名から大会情報を推定"""
    name = fname.replace("-recipe-", "").replace(".png", "")
    
    # 年を抽出
    year_match = re.search(r'(\d{4})', name)
    year = int(year_match.group(1)) if year_match else None
    
    # 大会種別
    event_type = ""
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
    elif re.match(r'^\d{4}_', name):
        event_type = "日本選手権"
    else:
        event_type = "その他"
    
    # 地域
    location = ""
    loc_map = {
        "akita": "秋田", "tokyo": "東京", "osaka": "大阪", "nagoya": "名古屋",
        "kyoto": "京都", "hamamatsu": "浜松", "kagoshima": "鹿児島",
        "hakata": "博多", "sapporo": "札幌", "sendai": "仙台",
        "okayama": "岡山", "kanazawa": "金沢", "yamagata": "山形",
        "makuhari": "幕張", "takamatsu": "高松",
    }
    for key, val in loc_map.items():
        if key in name:
            location = val
            break
    
    return {"year": year, "event_type": event_type, "location": location, "source_file": fname}


def ocr_recipe_image(filepath):
    """1枚のレシピ画像からデッキリストを抽出"""
    img = Image.open(filepath)
    w, h = img.size
    
    # 番号列（左側）
    num_col = img.crop((270, 780, 440, h - 50))
    num_col = ImageEnhance.Contrast(num_col).enhance(1.5)
    num_text = pytesseract.image_to_string(num_col, lang='eng', config='--psm 6')
    
    # 枚数列（右側）
    count_col = img.crop((890, 780, 950, h - 50))
    count_col = ImageEnhance.Contrast(count_col).enhance(1.5)
    count_text = pytesseract.image_to_string(count_col, lang='eng', config='--psm 6 -c tessedit_char_whitelist=0123456789')
    
    # パース
    num_lines = num_text.strip().split('\n')
    count_lines = count_text.strip().split('\n')
    
    # カード番号の正規表現
    card_pattern = re.compile(r'^([A-Z]{1,5}-?(?:BPR|PR|T|SP)?\d{1,4}(?:\s*EX)?)', re.IGNORECASE)
    partner_pattern = re.compile(r'パ[ー一]トナ[ー一]|Partner', re.IGNORECASE)
    
    decks = []
    current_deck = []
    count_idx = 0
    
    for line in num_lines:
        line = line.strip()
        if not line:
            continue
        
        # パートナー行で新デッキ開始を検出
        m = card_pattern.match(line)
        if m:
            card_num = m.group(1).upper().replace(' ', '')
            # "（パートナー）" が含まれるか、最初のカードか
            is_partner = 'パ' in line or '(' in line or '(/' in line or count_idx == 0
            
            # 枚数取得
            count = 0
            if count_idx < len(count_lines):
                c = count_lines[count_idx].strip()
                if c.isdigit():
                    count = int(c)
                count_idx += 1
            
            # パートナー行（新デッキの先頭）を検出
            if is_partner and current_deck:
                decks.append(current_deck)
                current_deck = []
            
            current_deck.append({"number": card_num, "count": count or 1, "is_partner": is_partner and not current_deck})
    
    if current_deck:
        decks.append(current_deck)
    
    return decks


def ocr_recipe_simple(filepath):
    """列別OCR + 累積50枚区切り。"""
    img = Image.open(filepath)
    w, h = img.size
    
    # 番号列OCR（eng、高精度）
    num_col = img.crop((270, 780, 440, h - 50))
    num_col = ImageEnhance.Contrast(num_col).enhance(1.5)
    num_text = pytesseract.image_to_string(num_col, lang='eng', config='--psm 6')
    
    card_pattern = re.compile(r'([A-Z]{1,5}[-/]?(?:BPR|PR|T|SP|SD)?\d{1,4}(?:EX)?)', re.IGNORECASE)
    entries = []
    for line in num_text.split('\n'):
        m = card_pattern.search(line.strip())
        if m:
            entries.append(m.group(1).upper().replace('/', '-'))
    
    # 枚数列OCR
    count_col = img.crop((890, 780, 950, h - 50))
    count_col = ImageEnhance.Contrast(count_col).enhance(1.5)
    count_text = pytesseract.image_to_string(count_col, lang='eng', config='--psm 6 -c tessedit_char_whitelist=0123456789')
    counts = [int(c) for c in re.findall(r'\d+', count_text)]
    
    # カード+枚数組み立て
    all_cards = []
    for i, card_num in enumerate(entries):
        count = counts[i] if i < len(counts) else 1
        if count > 10:
            count = 4
        all_cards.append({"number": card_num, "count": count})
    
    # 1デッキ分（65枚以下）ならそのまま返す
    total_all = sum(c['count'] for c in all_cards)
    if total_all <= 65:
        return [all_cards] if all_cards else []
    
    # 累積50枚で区切り（次カード3枚以上=パートナー候補で分割）
    decks = []
    current = []
    total = 0
    for card in all_cards:
        if total >= 48 and card['count'] >= 3 and current:
            decks.append(current)
            current = []
            total = 0
        current.append(card)
        total += card['count']
    if current:
        decks.append(current)
    
    return decks


def main():
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    
    files = sorted(f for f in os.listdir(RECIPE_DIR) if f.endswith('.png'))
    print(f"レシピ画像: {len(files)}枚")
    
    all_recipes = []
    errors = []
    
    for i, fname in enumerate(files, 1):
        filepath = os.path.join(RECIPE_DIR, fname)
        meta = parse_filename(fname)
        
        print(f"[{i}/{len(files)}] {fname}...", end=" ", flush=True)
        try:
            decks = ocr_recipe_simple(filepath)
            for rank, deck in enumerate(decks, 1):
                partner_card = next((c for c in deck if c.get("is_partner")), None)
                recipe = {
                    "id": f"{fname.replace('.png','').replace('-recipe-','')}_{rank}",
                    "source_file": fname,
                    "year": meta["year"],
                    "event_type": meta["event_type"],
                    "location": meta["location"],
                    "rank": rank,
                    "partner": partner_card["number"] if partner_card else "",
                    "cards": [{"number": c["number"], "count": c["count"]} for c in deck],
                    "total": sum(c["count"] for c in deck),
                }
                all_recipes.append(recipe)
            print(f"{len(decks)}デッキ")
        except Exception as e:
            print(f"ERROR: {e}")
            errors.append(fname)
    
    # JSON出力
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(all_recipes, f, ensure_ascii=False, indent=2)
    
    print(f"\n完了: {len(all_recipes)}レシピ → {OUTPUT_PATH}")
    if errors:
        print(f"エラー: {len(errors)}件 → {errors[:5]}")


if __name__ == "__main__":
    main()
