"""Nạp tự động (qua PYTHONPATH) vào mọi tiến trình Python của VI-Translate, kể cả tiến trình con điều khiển trình duyệt.

Không sửa mã của VI-Translate (clone riêng, gitignored); chỉ vá lúc chạy:
1. Ưu tiên trình duyệt trong PDF2LEARN_BROWSER (mặc định: chrome) thay vì trình duyệt mặc định của Windows (Edge).
2. Không đóng cửa sổ khi người dùng đang giải CAPTCHA: engine gốc chỉ chờ trình duyệt trả lời 3 giây
   (socket timeout) / 5 giây (mỗi lệnh). Khi trang CAPTCHA đang tải, chuyển hướng, hoặc người dùng đang thao tác,
   trình duyệt có thể trả lời chậm hơn → WebSocketTimeoutException không được bắt → engine báo lỗi và đóng cửa sổ.
   Ở đây: chờ tối đa 30 giây mỗi lệnh; lệnh đọc trang (Runtime.evaluate) quá hạn thì coi như "đang tải" và hỏi lại.
"""
import json
import os
import sys
import time

_root = os.environ.get("VI_TRANSLATE_ROOT")
_prefer = os.environ.get("PDF2LEARN_BROWSER", "chrome").strip().lower()
_COMMAND_TIMEOUT = 30.0

if _root:
    if _root not in sys.path:
        sys.path.append(_root)
    try:
        import websocket
        from pdf2zh import installed_browser as _ib

        # 1. Trình duyệt ưu tiên.
        if _prefer:
            _discover = _ib.discover_browsers

            def _preferred_first():
                return sorted(_discover(), key=lambda b: b.key != _prefer)

            _ib.discover_browsers = _preferred_first

        # 2. Chờ trình duyệt lâu hơn, không coi trả lời chậm là lỗi.
        def _call(self, method, params=None, **extra):
            self.sequence += 1
            request_id = self.sequence
            self.socket.send(json.dumps({"id": request_id, "method": method, "params": params or {}, **extra}))
            deadline = time.monotonic() + _COMMAND_TIMEOUT
            while time.monotonic() < deadline:
                try:
                    message = json.loads(self.socket.recv())
                except websocket.WebSocketTimeoutException:
                    continue  # chưa có trả lời trong 3 giây: chờ tiếp tới hạn chung
                if message.get("id") != request_id:
                    continue
                if "error" in message or message.get("type") == "error":
                    raise _ib.BrowserConnectionError("BrowserCommandFailed:" + method)
                return message.get("result", {})
            raise _ib.BrowserConnectionError("BrowserCommandTimeout:" + method)

        _ib.Protocol.call = _call

        _page_state = _ib.InstalledBrowserWindow.page_state

        def _page_state_tolerant(self, expression):
            try:
                return _page_state(self, expression)
            except _ib.BrowserConnectionError as error:
                # Trang đang chuyển hướng / bận (vd. người dùng đang giải CAPTCHA): coi như đang tải.
                if str(error).startswith("BrowserCommandTimeout:"):
                    return {}
                raise

        _ib.InstalledBrowserWindow.page_state = _page_state_tolerant
    except Exception:  # engine chưa cài / đổi cấu trúc: giữ nguyên hành vi gốc
        pass
