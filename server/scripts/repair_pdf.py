"""Sửa PDF hỏng cấu trúc (xref/object stream) bằng qpdf qua pikepdf.

Chạy: uv run --quiet --with pikepdf python scripts/repair_pdf.py <vào.pdf> <ra.pdf>
"""
import sys

import pikepdf

with pikepdf.open(sys.argv[1]) as pdf:
    pdf.save(sys.argv[2])
    print(len(pdf.pages))
