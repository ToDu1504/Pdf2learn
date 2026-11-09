"""Nạp tự động (qua PYTHONPATH) vào mọi tiến trình Python của VI-Translate, kể cả tiến trình con điều khiển trình duyệt.

Engine mặc định mở trình duyệt mặc định của Windows (thường là Edge). Ở đây ưu tiên trình duyệt
trong PDF2LEARN_BROWSER (mặc định: chrome); không có thì dùng thứ tự gốc của engine.
"""
import os
import sys

_root = os.environ.get("VI_TRANSLATE_ROOT")
_prefer = os.environ.get("PDF2LEARN_BROWSER", "chrome").strip().lower()
if _root and _prefer:
    if _root not in sys.path:
        sys.path.append(_root)
    try:
        from pdf2zh import installed_browser as _ib

        _discover = _ib.discover_browsers

        def _preferred_first():
            return sorted(_discover(), key=lambda b: b.key != _prefer)

        _ib.discover_browsers = _preferred_first
    except Exception:  # engine chưa cài / đổi cấu trúc: giữ nguyên hành vi gốc
        pass
