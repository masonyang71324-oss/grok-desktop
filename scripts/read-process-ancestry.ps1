param([Parameter(Mandatory=$true)][uint32]$ChildProcessId,[Parameter(Mandatory=$true)][uint32]$RootProcessId)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)
[Console]::Error.WriteLine('ANCESTRY_SCRIPT_STARTED')
# Read-only kernel snapshot; does not depend on the WMI service or its providers.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class GrokAuditProcessSnapshot {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct Entry {
    public uint size, usage, id;
    public UIntPtr heap;
    public uint module, threads, parent;
    public int priority;
    public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name;
  }
  public class ProcessRecord {
    public uint ProcessId;
    public uint ParentProcessId;
    public string Name;
  }
  [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint id);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool Process32FirstW(IntPtr snapshot,ref Entry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool Process32NextW(IntPtr snapshot,ref Entry entry);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr value);
  public static ProcessRecord[] Read(uint child,uint root) {
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
    if(snapshot==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
    var entries=new Dictionary<uint,ProcessRecord>();
    try {
      var entry=new Entry();entry.size=(uint)Marshal.SizeOf(typeof(Entry));
      if(!Process32FirstW(snapshot,ref entry))throw new Win32Exception(Marshal.GetLastWin32Error());
      do {entries[entry.id]=new ProcessRecord {ProcessId=entry.id,ParentProcessId=entry.parent,Name=entry.name};} while(Process32NextW(snapshot,ref entry));
    } finally {CloseHandle(snapshot);}
    var result=new List<ProcessRecord>();var visited=new HashSet<uint>();
    ProcessRecord found;
    while(child!=0 && visited.Add(child) && entries.TryGetValue(child,out found)) {
      result.Add(found);if(child==root)break;child=found.ParentProcessId;
    }
    return result.ToArray();
  }
}
'@
[Console]::Error.WriteLine('ANCESTRY_INTEROP_READY')
$chain=@([GrokAuditProcessSnapshot]::Read($ChildProcessId,$RootProcessId))
ConvertTo-Json -InputObject $chain -Compress
