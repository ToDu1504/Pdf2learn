; Bộ cài Pdf2Learn (NSIS, dùng qua electron-builder).
; - Mặc định cài vào D:\Programs\Pdf2Learn nếu máy có ổ D (ổ C thường chật); người dùng vẫn đổi được.
; - Gỡ cài / cập nhật KHÔNG xóa dữ liệu học: giữ thư mục "data" và file "data-location.txt" trong thư mục cài.

!macro preInit
  IfFileExists "D:\*.*" 0 +2
    StrCpy $INSTDIR "D:\Programs\Pdf2Learn"
!macroend

;; electron-builder luôn chép một bản bộ cài (~120MB) vào %LOCALAPPDATA%\<tên>-updater để tự cập nhật — app không dùng
;; tự cập nhật và ổ C thường chật → xóa ngay sau khi cài.
!macro customInstall
  !ifdef APP_INSTALLER_STORE_FILE
    Delete "$LOCALAPPDATA\${APP_INSTALLER_STORE_FILE}"
    RMDir "$LOCALAPPDATA\pdf2learn-desktop-updater"
  !endif
!macroend

!macro customRemoveFiles
  ; Xóa mọi thứ trong thư mục cài TRỪ dữ liệu người dùng.
  FindFirst $0 $1 "$INSTDIR\*.*"
  loop_pdf2learn:
    StrCmp $1 "" done_pdf2learn
    StrCmp $1 "." next_pdf2learn
    StrCmp $1 ".." next_pdf2learn
    StrCmp $1 "data" next_pdf2learn
    StrCmp $1 "data-location.txt" next_pdf2learn
    IfFileExists "$INSTDIR\$1\*.*" 0 +3
      RMDir /r "$INSTDIR\$1"
      Goto next_pdf2learn
    Delete "$INSTDIR\$1"
  next_pdf2learn:
    FindNext $0 $1
    Goto loop_pdf2learn
  done_pdf2learn:
  FindClose $0
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    IfFileExists "$INSTDIR\data\*.*" 0 +2
      MessageBox MB_OK|MB_ICONINFORMATION "Dữ liệu học của bạn vẫn được giữ tại:$\r$\n$INSTDIR\data$\r$\n$\r$\nXóa thư mục này nếu không cần nữa." /SD IDOK
  ${endIf}
!macroend
