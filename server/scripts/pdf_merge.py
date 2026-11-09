"""Ghép các cụm PDF đã dịch thành 1 file (theo thứ tự tham số).

Chạy bằng Python trong vi-translate/.venv (có sẵn PyMuPDF):
    python pdf_merge.py <ra.pdf> <cụm1.pdf> <cụm2.pdf> ...
"""
import sys

import fitz

out, parts = sys.argv[1], sys.argv[2:]
merged = fitz.open()
for p in parts:
    with fitz.open(p) as part:
        merged.insert_pdf(part)
merged.save(out, garbage=3, deflate=True)
print(merged.page_count)
