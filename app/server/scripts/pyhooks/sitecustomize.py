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

        # 3. Chạy ngầm thật sự: engine gốc chỉ thu nhỏ cửa sổ (vẫn hiện trên thanh tác vụ). Ở đây ẩn hẳn các cửa sổ
        #    của tiến trình trình duyệt (SW_HIDE); chỉ hiện lại khi engine gọi show() (Google đòi CAPTCHA).
        if sys.platform == "win32":
            import ctypes
            from ctypes import wintypes

            _user32 = ctypes.windll.user32
            _EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

            def _windows_of(pid, visible_only):
                found = []

                def _each(hwnd, _):
                    owner = wintypes.DWORD()
                    _user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
                    if owner.value == pid and (not visible_only or _user32.IsWindowVisible(hwnd)):
                        found.append(hwnd)
                    return True

                _user32.EnumWindows(_EnumProc(_each), 0)
                return found

            _hide, _show = _ib.InstalledBrowserWindow.hide, _ib.InstalledBrowserWindow.show

            def _hide_fully(self):
                _hide(self)
                pid = getattr(self.process, "pid", None)
                if not pid:
                    return
                hidden = _windows_of(pid, True)
                for hwnd in hidden:
                    _user32.ShowWindow(hwnd, 0)  # SW_HIDE
                self._pdf2learn_hidden = list(set(getattr(self, "_pdf2learn_hidden", []) + hidden))

            def _show_again(self):
                for hwnd in getattr(self, "_pdf2learn_hidden", []):
                    if _user32.IsWindow(hwnd):
                        _user32.ShowWindow(hwnd, 9)  # SW_RESTORE
                self._pdf2learn_hidden = []
                _show(self)

            _ib.InstalledBrowserWindow.hide = _hide_fully
            _ib.InstalledBrowserWindow.show = _show_again
    except Exception:  # engine chưa cài / đổi cấu trúc: giữ nguyên hành vi gốc
        pass

# 4. App desktop: không mở Chrome. Mỗi lượt dịch gửi tới server của app (PDF2LEARN_GT_URL); app tải Google Dịch trong
#    cửa sổ ẩn của chính nó, Google đòi CAPTCHA thì cửa sổ xác minh hiện lên trong app.
_gt_url = os.environ.get("PDF2LEARN_GT_URL")
if _root and _gt_url:
    try:
        import urllib.request
        from pdf2zh import google_browser as _gb

        _gt_token = os.environ.get("PDF2LEARN_GT_TOKEN", "")

        def _app_start(self):
            self.browser_name = "Pdf2Learn"

        def _app_fetch(self, params, on_verification, *, show_on_verification=True, on_verified=None):
            request = urllib.request.Request(
                _gt_url,
                data=json.dumps({"params": params}).encode("utf-8"),
                headers={"Content-Type": "application/json", "X-Pdf2learn-Token": _gt_token},
                method="POST",
            )
            try:
                with urllib.request.urlopen(request, timeout=_gb.HUMAN_VERIFICATION_TIMEOUT + 120) as response:
                    data = json.loads(response.read().decode("utf-8"))
            except Exception as error:
                raise self._unavailable("app: " + type(error).__name__) from None
            if isinstance(data.get("text"), str):
                return data["text"]
            raise self._unavailable("app: " + str(data.get("error", ""))[:200])

        def _app_close(self):
            pass

        _gb.BrowserBackend.start = _app_start
        _gb.BrowserBackend.fetch = _app_fetch
        _gb.BrowserBackend.close = _app_close
    except Exception:
        pass
