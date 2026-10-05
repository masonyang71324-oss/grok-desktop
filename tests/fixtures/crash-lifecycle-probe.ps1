param([string]$ElectronPath, [string]$FixturePath, [string]$DirectoryPath, [string]$RepoPath)
$ErrorActionPreference = 'Stop'
# A kernel snapshot is used only to acquire handles while the owned main is alive.
# Inspection and cleanup thereafter use those same handles, never a stale PID.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class CrashProbeProcesses {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  private struct Entry {
    public uint size, usage, id; public UIntPtr heap;
    public uint module, threads, parent; public int priority; public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string name;
  }
  public class OwnedProcess {
    public uint id, parent; public string name; public IntPtr handle;
    public bool Alive { get { return WaitForSingleObject(handle, 0) == 258; } }
    public void Kill() {
      if(!Alive)return;
      if(!TerminateProcess(handle,1)) {
        int error=Marshal.GetLastWin32Error();
        // Windows returns ACCESS_DENIED while a job is already terminating it.
        // Accept that race only after this same retained handle is signaled.
        if(WaitForSingleObject(handle,1000)!=0)throw new Win32Exception(error);
      }
      if(WaitForSingleObject(handle,5000)!=0)throw new InvalidOperationException("Owned process did not terminate.");
    }
    public void Close() { CloseHandle(handle); }
  }
  [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint id);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool Process32FirstW(IntPtr snapshot,ref Entry entry);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] private static extern bool Process32NextW(IntPtr snapshot,ref Entry entry);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetProcessTimes(IntPtr handle,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern bool TerminateProcess(IntPtr handle,uint code);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr value);
  public static OwnedProcess[] Capture(uint root, long rootTime) {
    IntPtr snapshot=CreateToolhelp32Snapshot(2,0);
    if(snapshot==new IntPtr(-1))throw new Win32Exception(Marshal.GetLastWin32Error());
    var entries=new Dictionary<uint,Entry>();
    try {
      var entry=new Entry();entry.size=(uint)Marshal.SizeOf(typeof(Entry));
      if(!Process32FirstW(snapshot,ref entry))throw new Win32Exception(Marshal.GetLastWin32Error());
      do {entries[entry.id]=entry;} while(Process32NextW(snapshot,ref entry));
    } finally {CloseHandle(snapshot);}
    var result=new List<OwnedProcess>();var owned=new HashSet<uint>();owned.Add(root);
    bool changed;
    do {
      changed=false;
      foreach(var entry in entries.Values) {
        if(owned.Contains(entry.id)||!owned.Contains(entry.parent))continue;
        IntPtr handle=OpenProcess(0x100001|0x1000,false,entry.id);
        if(handle==IntPtr.Zero)continue;
        long created,exit,kernel,user;
        if(!GetProcessTimes(handle,out created,out exit,out kernel,out user)||created<rootTime||WaitForSingleObject(handle,0)!=258) {CloseHandle(handle);continue;}
        result.Add(new OwnedProcess {id=entry.id,parent=entry.parent,name=entry.name,handle=handle});
        owned.Add(entry.id);changed=true;
      }
    } while(changed);
    return result.ToArray();
  }
}
'@
$main = $null
$owned = @()
try {
  $main = Start-Process -FilePath $ElectronPath -ArgumentList ('"' + $FixturePath + '"') -WorkingDirectory $RepoPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $DirectoryPath 'electron.stdout') -RedirectStandardError (Join-Path $DirectoryPath 'electron.stderr')
  $null = $main.Handle
  $rootTime = $main.StartTime.ToUniversalTime().ToFileTimeUtc()
  $readyPath = Join-Path $DirectoryPath 'ready.json'
  $deadline = [DateTime]::UtcNow.AddSeconds(40)
  while (!(Test-Path -LiteralPath $readyPath)) {
    if ($main.HasExited) { throw "Owned Electron exited before ready: $($main.ExitCode)" }
    if ([DateTime]::UtcNow -gt $deadline) { throw 'Owned fixture did not become ready' }
    Start-Sleep -Milliseconds 50
  }
  $ready = Get-Content -Raw -LiteralPath $readyPath | ConvertFrom-Json
  if ($ready.mainPid -ne $main.Id) { throw 'Unexpected main process identity' }
  $owned = @([CrashProbeProcesses]::Capture($main.Id, $rootTime))
  $expected = @($ready.utilityPid)
  if ($env:GROK_CRASH_PROBE_PHASE -ne 'startup') {
    $expected += $ready.externalPid
    foreach ($role in @('terminal','terminal-leaf','runner','runner-leaf')) {
      $record = Get-Content -Raw -LiteralPath (Join-Path $DirectoryPath "$role.json") | ConvertFrom-Json
      $expected += $record.pid
    }
  }
  foreach ($expectedId in $expected) {
    if (!($owned | Where-Object { $_.id -eq $expectedId -and $_.Alive })) { throw "Missing live owned fixture process $expectedId" }
  }
  # Kill MAIN ONLY. The descendants must be stopped by the application lifetime contract.
  $main.Kill()
  $null = $main.WaitForExit(5000)
  $externalIds = @($ready.externalPid)
  do {
    $previousCount = $externalIds.Count
    foreach ($entry in $owned) {
      if (($externalIds -contains $entry.parent) -and ($externalIds -notcontains $entry.id)) { $externalIds += $entry.id }
    }
  } while ($previousCount -ne $externalIds.Count)
  $deadline = [DateTime]::UtcNow.AddSeconds(7)
  do {
    $survivors = @($owned | Where-Object { $_.Alive -and ($externalIds -notcontains $_.id) })
    if (!$survivors.Count) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  $report = [ordered]@{
    mainPid = $main.Id
    utilityPid = $ready.utilityPid
    externalSurvived = [bool]($owned | Where-Object { $_.id -eq $ready.externalPid -and $_.Alive })
    owned = @($owned | ForEach-Object { @{ pid=$_.id; parentPid=$_.parent; name=$_.name; survived=$_.Alive } })
    survivors = @($survivors | ForEach-Object { $_.id })
  }
  ConvertTo-Json -InputObject $report -Compress -Depth 5
} finally {
  # Failure cleanup also captures only this still-live main's descendants.
  if ($main -and !$main.HasExited) {
    if (!$owned.Count) { $owned = @([CrashProbeProcesses]::Capture($main.Id, $rootTime)) }
    $main.Kill()
    $null = $main.WaitForExit(5000)
  }
  $cleanupErrors = @()
  foreach ($entry in $owned) {
    try { $entry.Kill() }
    catch { $cleanupErrors += "Owned handle $($entry.id): $($_.Exception.Message)" }
    finally { $entry.Close() }
  }
  if ($main) { $main.Dispose() }
  if ($cleanupErrors.Count) { throw ($cleanupErrors -join '; ') }
}
