param(
  [Parameter(Mandatory = $true)]
  [string]$AppPath
)

$ErrorActionPreference = 'Stop'
foreach ($folder in @('ApplicationData', 'LocalApplicationData')) {
  $dataDirectory = Join-Path ([Environment]::GetFolderPath($folder)) 'cash.sdd.helios.desktop'
  if (Test-Path -LiteralPath $dataDirectory) {
    throw 'Use a disposable Windows user profile: this profile already contains HeliosGen data.'
  }
}
$appFile = (Resolve-Path -LiteralPath $AppPath).Path
$appDirectory = Split-Path -Parent $appFile
$appProcess = $null
$serverProcess = $null
$serverPort = $null

# Hidden windows have no Process.MainWindowHandle. Send the usual close message
# to the HeliosGen window owned by this test's app process instead.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class HeliosSmokeWindow {
  private delegate bool EnumWindowsCallback(IntPtr window, IntPtr state);
  [DllImport("user32.dll")]
  private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr state);
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern int GetWindowTextW(IntPtr window, StringBuilder title, int count);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

  public static bool Close(uint processId) {
    bool sent = false;
    EnumWindows((window, state) => {
      uint owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner != processId) return true;
      var title = new StringBuilder(256);
      GetWindowTextW(window, title, title.Capacity);
      if (title.ToString() != "HeliosGen") return true;
      sent = PostMessageW(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
      return !sent;
    }, IntPtr.Zero);
    return sent;
  }
}
'@

try {
  $appProcess = Start-Process -FilePath $appFile -WorkingDirectory $appDirectory -WindowStyle Hidden -PassThru
  $deadline = (Get-Date).AddSeconds(90)
  $ready = $false
  while ((Get-Date) -lt $deadline) {
    $appProcess.Refresh()
    if (-not $serverProcess) {
      $serverInfo = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($appProcess.Id) AND Name='helios-node.exe'" |
        Where-Object { $_.ExecutablePath -eq (Join-Path $appDirectory 'helios-node.exe') } |
        Select-Object -First 1
      if ($serverInfo) { $serverProcess = Get-Process -Id $serverInfo.ProcessId -ErrorAction SilentlyContinue }
    }
    if ($appProcess.HasExited) { throw 'The app exited before its server became ready.' }

    if ($serverProcess) {
      $serverProcess.Refresh()
      if ($serverProcess.HasExited) { throw 'The sidecar exited before serving HTTP.' }
      $listener = Get-NetTCPConnection -State Listen -OwningProcess $serverProcess.Id -ErrorAction SilentlyContinue |
        Where-Object LocalAddress -EQ '127.0.0.1' |
        Select-Object -First 1
      if ($listener) {
        $serverPort = $listener.LocalPort
        try {
          $response = Invoke-WebRequest -Uri "http://127.0.0.1:$serverPort/api/workflows" -TimeoutSec 5
          $ready = $response.StatusCode -eq 200
        } catch { }
        if ($ready) { break }
      }
    }
    Start-Sleep -Milliseconds 250
  }

  if (-not $ready) { throw 'The installed app did not serve HTTP within 90 seconds.' }
  $deadline = (Get-Date).AddSeconds(15)
  $closeSent = $false
  do {
    $closeSent = [HeliosSmokeWindow]::Close($appProcess.Id)
    if ($closeSent) { break }
    Start-Sleep -Milliseconds 250
  } while ((Get-Date) -lt $deadline)

  if (-not $closeSent) { throw 'Could not close the app window normally.' }
  if (-not $appProcess.WaitForExit(15000)) { throw 'The app did not exit after its window closed.' }
  if (-not $serverProcess.WaitForExit(10000)) { throw 'The sidecar survived normal app closure.' }
  $remainingListener = Get-NetTCPConnection -State Listen -LocalPort $serverPort -ErrorAction SilentlyContinue |
    Where-Object OwningProcess -EQ $serverProcess.Id
  if ($remainingListener) { throw 'The sidecar left its port listening after shutdown.' }
  Write-Output 'PASS: installed app served HTTP, closed normally, and stopped its sidecar.'
} finally {
  # Clean up only the processes this smoke test started, including failed runs.
  if ($appProcess -and -not $serverProcess) {
    $serverInfo = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($appProcess.Id) AND Name='helios-node.exe'" |
      Where-Object { $_.ExecutablePath -eq (Join-Path $appDirectory 'helios-node.exe') } |
      Select-Object -First 1
    if ($serverInfo) { $serverProcess = Get-Process -Id $serverInfo.ProcessId -ErrorAction SilentlyContinue }
  }
  if ($appProcess) {
    $appProcess.Refresh()
    if (-not $appProcess.HasExited) { $appProcess.Kill(); $null = $appProcess.WaitForExit(5000) }
  }
  if ($serverProcess) {
    $serverProcess.Refresh()
    if (-not $serverProcess.HasExited) { $serverProcess.Kill(); $null = $serverProcess.WaitForExit(5000) }
  }
}
