param([ValidateSet('run','utility')][string]$Mode)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

# This process owns a Windows kill-on-close job. Its authority comes from its
# live OS parent, never a PID file or a caller-supplied process ID. Retained
# process handles and creation times prevent later PID reuse changing ownership.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
public static class GrokOwnedJob {
  [StructLayout(LayoutKind.Sequential)] private struct BasicInfo {
    public IntPtr Reserved1, Peb, Reserved2a, Reserved2b, Id, ParentId;
  }
  [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags;
    public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint Priority, Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] private struct IoCounters {
    public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes;
  }
  [StructLayout(LayoutKind.Sequential)] private struct Limits {
    public BasicLimits Basic; public IoCounters Io;
    public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("ntdll.dll")] private static extern int NtQueryInformationProcess(IntPtr process,int type,out BasicInfo info,int size,out int returned);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr OpenProcess(uint access,bool inherit,uint id);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern bool GetProcessTimes(IntPtr process,out long creation,out long exit,out long kernel,out long user);
  [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll",SetLastError=true)] private static extern IntPtr CreateJobObjectW(IntPtr security,string name);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern bool SetInformationJobObject(IntPtr job,int type,ref Limits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] private static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll")] private static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,bool all,uint timeout);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  private static IntPtr job;
  private static IntPtr[] owners;
  private static void Check(bool ok) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  private static long Created(IntPtr process) {
    long created,exit,kernel,user;Check(GetProcessTimes(process,out created,out exit,out kernel,out user));return created;
  }
  private static IntPtr ParentOf(IntPtr child,bool assign) {
    BasicInfo info;int returned;
    if(NtQueryInformationProcess(child,0,out info,Marshal.SizeOf(typeof(BasicInfo)),out returned)!=0) throw new InvalidOperationException("Cannot identify the process owner.");
    IntPtr parent=OpenProcess(0x100000|0x1000|(assign ? 0x101u : 0u),false,(uint)info.ParentId.ToInt64());
    if(parent==IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
    if(Created(parent)>Created(child)||WaitForSingleObject(parent,0)!=258) {
      CloseHandle(parent);throw new InvalidOperationException("The process owner has exited.");
    }
    return parent;
  }
  public static void Initialize(bool utility) {
    IntPtr current=GetCurrentProcess();
    IntPtr parent=ParentOf(current,utility);
    owners=utility ? new IntPtr[] {parent,ParentOf(parent,false)} : new IntPtr[] {parent};
    job=CreateJobObjectW(IntPtr.Zero,null);Check(job!=IntPtr.Zero);
    var limits=new Limits();limits.Basic.Flags=0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))));
    Check(AssignProcessToJobObject(job,utility ? parent : current));
  }
  public static void WaitForOwners() {
    WaitForMultipleObjects((uint)owners.Length,owners,false,0xffffffff);
    // Closing the only job handle also terminates all descendants still in the job.
    CloseHandle(job);job=IntPtr.Zero;
  }
  private static string Quote(string argument) {
    var result=new StringBuilder("\"");int backslashes=0;
    foreach(char value in argument) {
      if(value=='\\') {backslashes++;continue;}
      if(value=='"') {result.Append('\\',backslashes*2+1);result.Append(value);backslashes=0;continue;}
      result.Append('\\',backslashes);backslashes=0;result.Append(value);
    }
    result.Append('\\',backslashes*2);return result.Append('"').ToString();
  }
  public static int Run(string executable,string[] args,string cwd) {
    var watcher=new Thread(()=> { WaitForOwners();Environment.Exit(1); });watcher.IsBackground=true;watcher.Start();
    var arguments=new StringBuilder();
    foreach(string argument in args) { if(arguments.Length>0)arguments.Append(' ');arguments.Append(Quote(argument)); }
    var info=new ProcessStartInfo(executable,arguments.ToString()) {
      WorkingDirectory=cwd,UseShellExecute=false,CreateNoWindow=true,
      RedirectStandardOutput=true,RedirectStandardError=true,RedirectStandardInput=true
    };
    using(var child=Process.Start(info)) {
      child.StandardInput.Close();
      Task output=child.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
      Task error=child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
      child.WaitForExit();Task.WaitAll(output,error);return child.ExitCode;
    }
  }
}
'@
try {
  [GrokOwnedJob]::Initialize($Mode -eq 'utility')
  if ($Mode -eq 'utility') {
    [Console]::Out.WriteLine('OWNED_JOB_READY')
    [Console]::Out.Flush()
    [GrokOwnedJob]::WaitForOwners()
    exit 0
  }
  $request = [Console]::In.ReadLine() | ConvertFrom-Json
  $code = [GrokOwnedJob]::Run($request.executable, [string[]]$request.args, $request.cwd)
  exit $code
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
