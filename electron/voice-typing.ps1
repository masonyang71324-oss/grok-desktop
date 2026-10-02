$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class GrokVoiceTyping {
  [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
  public static void Open() {
    try {
      keybd_event(0x5B, 0, 0, UIntPtr.Zero);
      keybd_event(0x48, 0, 0, UIntPtr.Zero);
    } finally {
      keybd_event(0x48, 0, 2, UIntPtr.Zero);
      keybd_event(0x5B, 0, 2, UIntPtr.Zero);
    }
  }
}
'@
[GrokVoiceTyping]::Open()
