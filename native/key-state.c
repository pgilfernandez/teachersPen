/* Read only the configured shortcut while it is held. No event hook or key log. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#if defined(__APPLE__)
#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>
#include <unistd.h>
#elif defined(_WIN32)
#include <windows.h>
#else
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <unistd.h>
#endif

/* Prefix modifier names to avoid WinUser.h hotkey macro collisions. */
enum { TP_MOD_CTRL = 1, TP_MOD_SHIFT = 2, TP_MOD_ALT = 4, TP_MOD_META = 8 };
static unsigned int modifiers;
static int keycode = -1;
#if defined(__APPLE__)
static CGEventSourceStateID key_state_source = kCGEventSourceStateHIDSystemState;
#endif
#if !defined(__APPLE__) && !defined(_WIN32)
static Display *display;
#endif
static int equal(const char *a, const char *b) {
  while (*a && *b && tolower((unsigned char)*a) == tolower((unsigned char)*b)) { a++; b++; }
  return *a == *b;
}

static int resolve_key(const char *name) {
#if defined(__APPLE__)
  const struct { const char *name; int code; } special[] = {
    {"Space", kVK_Space}, {"Enter", kVK_Return}, {"Return", kVK_Return}, {"Tab", kVK_Tab},
    {"Escape", kVK_Escape}, {"Esc", kVK_Escape}, {"Backspace", kVK_Delete}, {"Delete", kVK_ForwardDelete},
    {"Home", kVK_Home}, {"End", kVK_End}, {"PageUp", kVK_PageUp}, {"PageDown", kVK_PageDown},
    {"Up", kVK_UpArrow}, {"Down", kVK_DownArrow}, {"Left", kVK_LeftArrow}, {"Right", kVK_RightArrow},
    {"F1", kVK_F1}, {"F2", kVK_F2}, {"F3", kVK_F3}, {"F4", kVK_F4}, {"F5", kVK_F5},
    {"F6", kVK_F6}, {"F7", kVK_F7}, {"F8", kVK_F8}, {"F9", kVK_F9}, {"F10", kVK_F10},
    {"F11", kVK_F11}, {"F12", kVK_F12}, {"F13", kVK_F13}, {"F14", kVK_F14}, {"F15", kVK_F15},
    {"F16", kVK_F16}, {"F17", kVK_F17}, {"F18", kVK_F18}, {"F19", kVK_F19}, {"F20", kVK_F20}
  };
  for (size_t i = 0; i < sizeof(special) / sizeof(special[0]); i++) if (equal(name, special[i].name)) return special[i].code;
  const char *character = equal(name, "Plus") ? "+" : name;
  if (strlen(character) != 1) return -1;
  /* Resolve logical letters against the current layout, rather than assuming US keys. */
  TISInputSourceRef source = TISCopyCurrentKeyboardLayoutInputSource();
  if (!source) return -1;
  CFDataRef data = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData);
  if (!data) { CFRelease(source); return -1; }
  const UCKeyboardLayout *layout = (const UCKeyboardLayout *)CFDataGetBytePtr(data);
  int found = -1;
  for (int key = 0; key < 128 && found < 0; key++) {
    for (int shifted = 0; shifted < 2; shifted++) {
      UInt32 dead = 0; UniChar chars[4]; UniCharCount count = 0;
      if (UCKeyTranslate(layout, key, kUCKeyActionDown, shifted ? (shiftKey >> 8) : 0,
          LMGetKbdType(), kUCKeyTranslateNoDeadKeysBit, &dead, 4, &count, chars) == noErr &&
          count == 1 && chars[0] < 128 && tolower(chars[0]) == tolower((unsigned char)character[0])) {
        found = key;
        break;
      }
    }
  }
  CFRelease(source);
  return found;
#elif defined(_WIN32)
  const struct { const char *name; int code; } special[] = {
    {"Space", VK_SPACE}, {"Enter", VK_RETURN}, {"Return", VK_RETURN}, {"Tab", VK_TAB},
    {"Escape", VK_ESCAPE}, {"Esc", VK_ESCAPE}, {"Backspace", VK_BACK}, {"Delete", VK_DELETE},
    {"Insert", VK_INSERT}, {"Home", VK_HOME}, {"End", VK_END}, {"PageUp", VK_PRIOR}, {"PageDown", VK_NEXT},
    {"Up", VK_UP}, {"Down", VK_DOWN}, {"Left", VK_LEFT}, {"Right", VK_RIGHT}
  };
  for (size_t i = 0; i < sizeof(special) / sizeof(special[0]); i++) if (equal(name, special[i].name)) return special[i].code;
  if (toupper(name[0]) == 'F' && isdigit((unsigned char)name[1])) {
    char *end; long number = strtol(name + 1, &end, 10);
    if (!*end && number >= 1 && number <= 24) return VK_F1 + (int)number - 1;
  }
  const char *character = equal(name, "Plus") ? "+" : name;
  if (strlen(character) != 1) return -1;
  HWND foreground = GetForegroundWindow();
  DWORD thread = foreground ? GetWindowThreadProcessId(foreground, NULL) : 0;
  SHORT result = VkKeyScanExA((char)tolower((unsigned char)*character), GetKeyboardLayout(thread));
  return result == -1 ? -1 : result & 0xff;
#else
  const struct { const char *name; KeySym sym; } special[] = {
    {"Space", XK_space}, {"Enter", XK_Return}, {"Return", XK_Return}, {"Tab", XK_Tab},
    {"Escape", XK_Escape}, {"Esc", XK_Escape}, {"Backspace", XK_BackSpace}, {"Delete", XK_Delete},
    {"Insert", XK_Insert}, {"Home", XK_Home}, {"End", XK_End}, {"PageUp", XK_Page_Up}, {"PageDown", XK_Page_Down},
    {"Up", XK_Up}, {"Down", XK_Down}, {"Left", XK_Left}, {"Right", XK_Right}, {"Plus", XK_plus}
  };
  KeySym symbol = NoSymbol;
  for (size_t i = 0; i < sizeof(special) / sizeof(special[0]); i++) if (equal(name, special[i].name)) symbol = special[i].sym;
  if (symbol == NoSymbol) {
    char normalized[64];
    snprintf(normalized, sizeof(normalized), "%s", name);
    if (strlen(normalized) == 1) normalized[0] = (char)tolower((unsigned char)normalized[0]);
    symbol = XStringToKeysym(normalized);
  }
  int code = symbol == NoSymbol ? 0 : XKeysymToKeycode(display, symbol);
  return code ? code : -1;
#endif
}

static int parse_shortcut(const char *shortcut) {
  char copy[128];
  if (strlen(shortcut) >= sizeof(copy)) return 0;
  strcpy(copy, shortcut);
  char *token = strtok(copy, "+");
  while (token) {
    if (equal(token, "Control") || equal(token, "Ctrl")) modifiers |= TP_MOD_CTRL;
    else if (equal(token, "Shift")) modifiers |= TP_MOD_SHIFT;
    else if (equal(token, "Alt") || equal(token, "Option")) modifiers |= TP_MOD_ALT;
    else if (equal(token, "Command") || equal(token, "Cmd") || equal(token, "Super") || equal(token, "Meta")) modifiers |= TP_MOD_META;
    else if (equal(token, "CommandOrControl") || equal(token, "CmdOrCtrl")) {
#if defined(__APPLE__)
      modifiers |= TP_MOD_META;
#else
      modifiers |= TP_MOD_CTRL;
#endif
    } else {
      if (keycode != -1 || (keycode = resolve_key(token)) < 0) return 0;
    }
    token = strtok(NULL, "+");
  }
  return keycode >= 0;
}

static int shortcut_down(void) {
#if defined(__APPLE__)
  /* Read keys and modifiers from the same state table. Prefer physical HID
     state so session events/auto-repeat cannot look like a physical release. */
  #define MAC_DOWN(code) CGEventSourceKeyState(key_state_source, (CGKeyCode)(code))
  if ((modifiers & TP_MOD_CTRL) && !(MAC_DOWN(kVK_Control) || MAC_DOWN(kVK_RightControl))) return 0;
  if ((modifiers & TP_MOD_SHIFT) && !(MAC_DOWN(kVK_Shift) || MAC_DOWN(kVK_RightShift))) return 0;
  if ((modifiers & TP_MOD_ALT) && !(MAC_DOWN(kVK_Option) || MAC_DOWN(kVK_RightOption))) return 0;
  if ((modifiers & TP_MOD_META) && !(MAC_DOWN(kVK_Command) || MAC_DOWN(kVK_RightCommand))) return 0;
  return MAC_DOWN(keycode);
#elif defined(_WIN32)
  if ((modifiers & TP_MOD_CTRL) && !(GetAsyncKeyState(VK_CONTROL) & 0x8000)) return 0;
  if ((modifiers & TP_MOD_SHIFT) && !(GetAsyncKeyState(VK_SHIFT) & 0x8000)) return 0;
  if ((modifiers & TP_MOD_ALT) && !(GetAsyncKeyState(VK_MENU) & 0x8000)) return 0;
  if ((modifiers & TP_MOD_META) && !((GetAsyncKeyState(VK_LWIN) | GetAsyncKeyState(VK_RWIN)) & 0x8000)) return 0;
  return (GetAsyncKeyState(keycode) & 0x8000) != 0;
#else
  char keys[32];
  if (!XQueryKeymap(display, keys)) return 0;
  #define DOWN(code) ((code) > 0 && (keys[(code) / 8] & (1 << ((code) % 8))))
  #define MOD_DOWN(left, right) (DOWN(XKeysymToKeycode(display, (left))) || DOWN(XKeysymToKeycode(display, (right))))
  if ((modifiers & TP_MOD_CTRL) && !MOD_DOWN(XK_Control_L, XK_Control_R)) return 0;
  if ((modifiers & TP_MOD_SHIFT) && !MOD_DOWN(XK_Shift_L, XK_Shift_R)) return 0;
  if ((modifiers & TP_MOD_ALT) && !MOD_DOWN(XK_Alt_L, XK_Alt_R)) return 0;
  if ((modifiers & TP_MOD_META) && !MOD_DOWN(XK_Super_L, XK_Super_R)) return 0;
  return DOWN(keycode) != 0;
#endif
}

int main(int argc, char **argv) {
  if (argc < 3 || (!equal(argv[1], "--validate") && !equal(argv[1], "--watch"))) return 2;
#if !defined(__APPLE__) && !defined(_WIN32)
  display = XOpenDisplay(NULL);
  if (!display) { fputs("No se puede conectar con X11.\n", stderr); return 3; }
#endif
  if (!parse_shortcut(argv[2])) { fputs("Tecla no compatible con mantener pulsado. Usa letras, números, espacio, flechas o teclas de función.\n", stderr); return 2; }
  if (equal(argv[1], "--validate")) { puts("valid"); return 0; }
#if defined(_WIN32)
  HANDLE parent = argc > 3 ? OpenProcess(SYNCHRONIZE, FALSE, (DWORD)strtoul(argv[3], NULL, 10)) : NULL;
#else
  pid_t parent = getppid();
#endif
#if defined(__APPLE__)
  /* Remote/session input may not be represented in the physical HID table.
     Select its table once, before activation; do not switch while held. */
  if (!shortcut_down()) key_state_source = kCGEventSourceStateCombinedSessionState;
#endif
  if (shortcut_down()) {
    puts("down"); fflush(stdout);
    unsigned int released_samples = 0;
    do {
#if defined(_WIN32)
      Sleep(8);
      if (parent && WaitForSingleObject(parent, 0) != WAIT_TIMEOUT) return 0;
#else
      usleep(8000);
      if (getppid() != parent) return 0;
#endif
      /* Require a stable release (four 8 ms samples), not a transient key-up
         during repeat or a focus transition. There is no maximum hold time. */
      released_samples = shortcut_down() ? 0 : released_samples + 1;
    } while (released_samples < 4);
  }
  puts("up"); fflush(stdout);
#if !defined(__APPLE__) && !defined(_WIN32)
  XCloseDisplay(display);
#endif
  return 0;
}
