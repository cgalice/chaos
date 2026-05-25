"""
iPhone Shortcuts用のGitHub raw URLリストを生成する。
shots/ocr_input/ の分割済み画像を使う。
"""

import os
from pathlib import Path

BASE_URL = "https://raw.githubusercontent.com/CGAlice/chaos/master/shots/ocr_input"
OCR_INPUT_DIR = Path("/home/kitajima/chaos/shots/ocr_input")
OUTPUT_PATH = Path("/home/kitajima/chaos/develop/doc/shortcut_urls.txt")

files = sorted(f for f in OCR_INPUT_DIR.iterdir() if f.suffix == ".png")
urls = [f"{BASE_URL}/{f.name}" for f in files]

OUTPUT_PATH.write_text("\n".join(urls) + "\n", encoding="utf-8")
print(f"{len(urls)}件 → {OUTPUT_PATH}")
