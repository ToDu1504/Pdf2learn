"""Cắt trang [from, to] (đánh số từ 1) của PDF ra file riêng để dịch (đọc được cả PDF hỏng xref).

Chạy bằng Python trong vi-translate/.venv (có sẵn PyMuPDF):
    python pdf_chunk.py <vào.pdf> <from> <to> <ra.pdf>
"""
import sys

import fitz

src, start, end, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
with fitz.open(src) as doc:
    end = min(end, doc.page_count)
    part = fitz.open()
    part.insert_pdf(doc, from_page=start - 1, to_page=end - 1)
    part.save(out, garbage=3, deflate=True)
    print(part.page_count)
