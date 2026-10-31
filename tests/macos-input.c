/* Optional integration fixture: post only our temporary Ctrl+Shift+F19 test shortcut. */
#include <ApplicationServices/ApplicationServices.h>
#include <Carbon/Carbon.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static void post(CGKeyCode key, bool down, CGEventFlags flags) {
  CGEventRef event = CGEventCreateKeyboardEvent(NULL, key, down);
  CGEventSetFlags(event, flags);
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
}
int main(int argc, char **argv) {
  if (!CGPreflightPostEventAccess()) { fputs("Sin permiso previo para simular teclas; no se solicita automáticamente.\n", stderr); return 77; }
  if (argc > 1 && strcmp(argv[1], "--check") == 0) return 0;
  CGEventFlags both = kCGEventFlagMaskControl | kCGEventFlagMaskShift;
  post(kVK_Control, true, kCGEventFlagMaskControl);
  post(kVK_Shift, true, both);
  post(kVK_F19, true, both);
  puts("down"); fflush(stdout);
  usleep(1500000);
  if (argc > 1 && strcmp(argv[1], "--modifier-first") == 0) {
    post(kVK_Control, false, kCGEventFlagMaskShift);
    puts("modifier-up"); fflush(stdout);
    usleep(1500000);
  }
  post(kVK_F19, false, both);
  post(kVK_Shift, false, kCGEventFlagMaskControl);
  post(kVK_Control, false, 0);
  puts("up"); fflush(stdout);
  return 0;
}
