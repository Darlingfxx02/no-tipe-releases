// Copyright (c) 2026 Darlingfxx02.
// SPDX-License-Identifier: Apache-2.0
// Native styling for NSIS. Controls keep their keyboard and accessibility APIs.
#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <commctrl.h>
#include <uxtheme.h>
#include <dwmapi.h>
#include <stdlib.h>
#include <wchar.h>

typedef struct stack_t {
  struct stack_t *next;
  wchar_t text[1];
} stack_t;

static const COLORREF background = RGB(10, 10, 12);
static const COLORREF foreground = RGB(237, 237, 241);
static const COLORREF muted = RGB(146, 146, 150);
static const UINT_PTR subclassId = 0x4E545549;
static HBRUSH backgroundBrush;
static BOOL highContrast;

static HWND popWindow(stack_t **stack) {
  if (!stack || !*stack) return NULL;
  stack_t *entry = *stack;
  HWND window = (HWND)(UINT_PTR)wcstoul(entry->text, NULL, 0);
  *stack = entry->next;
  GlobalFree(entry);
  return IsWindow(window) ? window : NULL;
}

static int scaled(HWND window, int value) {
  return MulDiv(value, GetDpiForWindow(window), 96);
}

static void roundFill(HDC dc, RECT rect, COLORREF color, int radius) {
  HBRUSH brush = CreateSolidBrush(color);
  HGDIOBJ oldBrush = SelectObject(dc, brush);
  HGDIOBJ oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
  RoundRect(dc, rect.left, rect.top, rect.right, rect.bottom, radius, radius);
  SelectObject(dc, oldBrush);
  SelectObject(dc, oldPen);
  DeleteObject(brush);
}

static void drawButton(DRAWITEMSTRUCT *item) {
  HWND button = item->hwndItem;
  BOOL primary = GetDlgCtrlID(button) == IDOK;
  BOOL disabled = (item->itemState & ODS_DISABLED) != 0;
  BOOL pressed = (item->itemState & ODS_SELECTED) != 0;
  BOOL hover = GetPropW(button, L"NoTipeHover") != NULL;
  COLORREF fill = primary ? RGB(88, 100, 197) : RGB(27, 27, 30);
  if (pressed) fill = primary ? RGB(73, 84, 174) : RGB(37, 37, 41);
  else if (hover) fill = primary ? RGB(106, 118, 214) : RGB(40, 40, 44);
  if (disabled) fill = RGB(31, 31, 35);
  FillRect(item->hDC, &item->rcItem, backgroundBrush);
  roundFill(item->hDC, item->rcItem, fill, scaled(button, 16));
  wchar_t text[256];
  GetWindowTextW(button, text, 256);
  SetBkMode(item->hDC, TRANSPARENT);
  SetTextColor(item->hDC, disabled ? RGB(103, 103, 111) : foreground);
  HFONT font = (HFONT)SendMessageW(button, WM_GETFONT, 0, 0);
  HGDIOBJ oldFont = SelectObject(item->hDC, font);
  RECT textRect = item->rcItem;
  DrawTextW(item->hDC, text, -1, &textRect, DT_CENTER | DT_VCENTER | DT_SINGLELINE);
  SelectObject(item->hDC, oldFont);
  if ((item->itemState & ODS_FOCUS) && !(item->itemState & ODS_NOFOCUSRECT)) {
    RECT focusRect = item->rcItem;
    InflateRect(&focusRect, -scaled(button, 4), -scaled(button, 4));
    DrawFocusRect(item->hDC, &focusRect);
  }
}

static LRESULT CALLBACK controlProc(HWND window, UINT message, WPARAM wParam,
                                   LPARAM lParam, UINT_PTR id, DWORD_PTR data) {
  if (message == WM_MOUSEMOVE && data == 1 && !GetPropW(window, L"NoTipeHover")) {
    SetPropW(window, L"NoTipeHover", (HANDLE)1);
    TRACKMOUSEEVENT tracking = {sizeof(tracking), TME_LEAVE, window, 0};
    TrackMouseEvent(&tracking);
    InvalidateRect(window, NULL, FALSE);
  } else if (message == WM_MOUSELEAVE && data == 1) {
    RemovePropW(window, L"NoTipeHover");
    InvalidateRect(window, NULL, FALSE);
  } else if ((message == WM_PAINT || message == WM_PRINTCLIENT) && data == 2 && !highContrast) {
    // Read NSIS's actual progress. No timers or simulated percentages.
    PBRANGE range;
    SendMessageW(window, PBM_GETRANGE, FALSE, (LPARAM)&range);
    int position = (int)SendMessageW(window, PBM_GETPOS, 0, 0);
    PAINTSTRUCT paint;
    HDC dc = message == WM_PAINT ? BeginPaint(window, &paint) : (HDC)wParam;
    RECT rect;
    GetClientRect(window, &rect);
    FillRect(dc, &rect, backgroundBrush);
    roundFill(dc, rect, RGB(36, 36, 41), scaled(window, 8));
    if (range.iHigh > range.iLow && position > range.iLow) {
      RECT fill = rect;
      int value = min(position, range.iHigh) - range.iLow;
      fill.right = MulDiv(rect.right, value, range.iHigh - range.iLow);
      roundFill(dc, fill, RGB(106, 118, 214), scaled(window, 8));
    }
    if (message == WM_PAINT) EndPaint(window, &paint);
    return 0;
  } else if (message == WM_NCDESTROY) {
    RemovePropW(window, L"NoTipeHover");
    RemovePropW(window, L"NoTipeMuted");
    RemoveWindowSubclass(window, controlProc, id);
  }
  return DefSubclassProc(window, message, wParam, lParam);
}

static LRESULT CALLBACK dialogProc(HWND window, UINT message, WPARAM wParam,
                                  LPARAM lParam, UINT_PTR id, DWORD_PTR data) {
  if (!highContrast) {
    switch (message) {
      case WM_CTLCOLORDLG:
      case WM_CTLCOLORSTATIC:
      case WM_CTLCOLORBTN:
      case WM_CTLCOLOREDIT: {
        HDC dc = (HDC)wParam;
        SetBkColor(dc, background);
        SetTextColor(dc, GetPropW((HWND)lParam, L"NoTipeMuted") ? muted : foreground);
        return (LRESULT)backgroundBrush;
      }
      case WM_DRAWITEM: {
        DRAWITEMSTRUCT *item = (DRAWITEMSTRUCT *)lParam;
        if (item && item->CtlType == ODT_BUTTON) {
          drawButton(item);
          return TRUE;
        }
        break;
      }
    }
  }
  if (message == WM_NCDESTROY) RemoveWindowSubclass(window, dialogProc, id);
  return DefSubclassProc(window, message, wParam, lParam);
}

static BOOL CALLBACK themeChild(HWND window, LPARAM unused) {
  wchar_t className[64];
  GetClassNameW(window, className, 64);
  if (!wcscmp(className, L"#32770")) {
    SetWindowSubclass(window, dialogProc, subclassId, 0);
  } else if (!lstrcmpiW(className, L"Static")) {
    LONG_PTR type = GetWindowLongPtrW(window, GWL_STYLE) & SS_TYPEMASK;
    if (type == SS_ETCHEDHORZ || type == SS_ETCHEDVERT || type == SS_ETCHEDFRAME) {
      ShowWindow(window, SW_HIDE);
    }
  } else if (!wcscmp(className, L"Button") && !highContrast) {
    LONG_PTR style = GetWindowLongPtrW(window, GWL_STYLE);
    LONG_PTR type = style & BS_TYPEMASK;
    if (type == BS_PUSHBUTTON || type == BS_DEFPUSHBUTTON || type == BS_OWNERDRAW) {
      SetWindowTheme(window, L"", L"");
      SetWindowLongPtrW(window, GWL_STYLE, (style & ~BS_TYPEMASK) | BS_OWNERDRAW);
      SetWindowSubclass(window, controlProc, subclassId, 1);
    } else {
      // Classic checkbox rendering uses our parent's text/background colors.
      // Explorer's dark theme is not enabled for this NSIS process and may
      // otherwise draw a black caption on our dark background.
      SetWindowTheme(window, L"", L"");
    }
  } else if (!wcscmp(className, PROGRESS_CLASSW) && !highContrast) {
    SetWindowTheme(window, L"", L"");
    SetWindowLongPtrW(window, GWL_STYLE, GetWindowLongPtrW(window, GWL_STYLE) & ~WS_BORDER);
    SetWindowLongPtrW(window, GWL_EXSTYLE, GetWindowLongPtrW(window, GWL_EXSTYLE) & ~WS_EX_CLIENTEDGE);
    SetWindowPos(window, NULL, 0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    SetWindowSubclass(window, controlProc, subclassId, 2);
  } else if (!wcscmp(className, WC_LISTVIEWW) && !highContrast) {
    ListView_SetBkColor(window, background);
    ListView_SetTextBkColor(window, background);
    ListView_SetTextColor(window, muted);
    SetWindowTheme(window, L"DarkMode_Explorer", NULL);
  }
  InvalidateRect(window, NULL, TRUE);
  return TRUE;
}

// NSIS has an x86 Unicode host even when the application payload is x64.
__declspec(dllexport) void __cdecl Theme(HWND parent, int stringSize,
    wchar_t *variables, stack_t **stack, void *extra) {
  HWND page = popWindow(stack);
  if (!backgroundBrush) {
    HIGHCONTRASTW contrast = {sizeof(contrast), 0, NULL};
    SystemParametersInfoW(SPI_GETHIGHCONTRAST, sizeof(contrast), &contrast, 0);
    highContrast = (contrast.dwFlags & HCF_HIGHCONTRASTON) != 0;
    backgroundBrush = CreateSolidBrush(background);
    BOOL dark = !highContrast;
    DwmSetWindowAttribute(parent, 20, &dark, sizeof(dark));
    DWORD corners = 2;
    DwmSetWindowAttribute(parent, 33, &corners, sizeof(corners));
  }
  SetWindowSubclass(parent, dialogProc, subclassId, 0);
  EnumChildWindows(parent, themeChild, 0);
  if (page) SetWindowSubclass(page, dialogProc, subclassId, 0);
  InvalidateRect(parent, NULL, TRUE);
}

__declspec(dllexport) void __cdecl Muted(HWND parent, int stringSize,
    wchar_t *variables, stack_t **stack, void *extra) {
  HWND control = popWindow(stack);
  if (control) {
    SetPropW(control, L"NoTipeMuted", (HANDLE)1);
    InvalidateRect(control, NULL, TRUE);
  }
}
