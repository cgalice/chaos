"""
iOSのLive Text OCR用に画像を前処理する。

処理内容:
- 上部ナビゲーション(約500px)と下部フッターを除去
- iOS Live Textが安定して動く4000px以内に縦分割
- iCloud Drive同期フォルダへ書き出し
"""

import os
from pathlib import Path
from PIL import Image

RECIPE_DIR    = Path("/home/kitajima/chaos/shots/recipe")
OUTPUT_DIR    = Path("/home/kitajima/chaos/shots/ocr_input")  # iCloud Drive同期先に変更可
TRIM_TOP      = 500   # ナビゲーション除去(px)
TRIM_BOTTOM   = 200   # フッター除去(px)
MAX_SECTION_H = 3800  # iOSで安定するセクション高さ上限
OVERLAP       = 400   # セクション間オーバーラップ(デッキ境界のまたぎ防止)


def split_image(img: Image.Image, src_name: str) -> list[tuple[str, Image.Image]]:
    """
    画像を縦分割してセクションのリストを返す。
    [(ファイル名, 画像)] の形式。
    """
    w, h = img.size
    trimmed = img.crop((0, TRIM_TOP, w, max(h - TRIM_BOTTOM, TRIM_TOP + 1)))
    th = trimmed.height

    if th <= MAX_SECTION_H:
        return [(src_name, trimmed)]

    sections = []
    y = 0
    idx = 1
    while y < th:
        end = min(y + MAX_SECTION_H, th)
        section = trimmed.crop((0, y, w, end))
        stem = Path(src_name).stem
        new_name = f"{stem}_p{idx:02d}.png"
        sections.append((new_name, section))
        if end == th:
            break
        y += MAX_SECTION_H - OVERLAP
        idx += 1

    return sections


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    files = sorted(p for p in RECIPE_DIR.iterdir() if p.suffix == ".png")
    print(f"対象: {len(files)}枚")

    total_out = 0
    for src_path in files:
        img = Image.open(src_path).convert("RGB")
        sections = split_image(img, src_path.name)
        for out_name, section in sections:
            out_path = OUTPUT_DIR / out_name
            section.save(out_path, format="PNG", optimize=True)
            total_out += 1

    print(f"出力: {total_out}ファイル → {OUTPUT_DIR}")
    print()
    print("次のステップ:")
    print(f"  1. {OUTPUT_DIR} をiCloud Driveに同期")
    print("  2. iPhoneのShortcutsで 'RecipeOCR' を実行")
    print("  3. OCR結果テキストをiCloud Drive/Chaos/OCR_Output/ に保存")


if __name__ == "__main__":
    main()
