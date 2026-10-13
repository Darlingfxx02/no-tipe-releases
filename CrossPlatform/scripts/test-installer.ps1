param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [ValidateSet("stable", "dev")][string]$Channel = "stable"
)
$ErrorActionPreference = 'Stop'
$appName = if ($Channel -eq 'dev') { 'No Type Dev' } else { 'No Type' }
$bundleId = if ($Channel -eq 'dev') { 'app.no-tipe.desktop.dev' } else { 'app.no-tipe.desktop' }
$binaryName = if ($Channel -eq 'dev') { 'no-type-dev.exe' } else { 'no-tipe-desktop.exe' }
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class InstallerWindow {
  public IntPtr Handle;
  public string Text;
  public bool Visible;
}
public static class InstallerUI {
  public delegate bool EnumProc(IntPtr window, IntPtr parameter);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr parameter);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr w, IntPtr l);
  public static InstallerWindow[] Children(IntPtr parent) {
    var children = new List<InstallerWindow>();
    EnumChildWindows(parent, (window, parameter) => {
      var text = new StringBuilder(2048);
      GetWindowText(window, text, text.Capacity);
      children.Add(new InstallerWindow { Handle=window, Text=text.ToString(), Visible=IsWindowVisible(window) });
      return true;
    }, IntPtr.Zero);
    return children.ToArray();
  }
}
'@

function Wait-WindowText($Process, [string[]]$Text, [int]$Timeout = 60) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Timeout)
  do {
    $Process.Refresh()
    if ($Process.HasExited) { throw "Installer exited before displaying $($Text -join ' / '), code $($Process.ExitCode)" }
    $window = $Process.MainWindowHandle
    if ($window -ne [IntPtr]::Zero) {
      $control = [InstallerUI]::Children($window) | Where-Object { $_.Visible -and $_.Text -in $Text } | Select-Object -First 1
      if ($control) { return $control }
    }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  $labels = [InstallerUI]::Children($Process.MainWindowHandle) | Where-Object Visible | ForEach-Object Text
  throw "Timed out waiting for $($Text -join ' / '). Visible controls: $($labels -join ', ')"
}

function Save-Window($Process, [string]$Name) {
  $rect = New-Object InstallerUI+Rect
  [void][InstallerUI]::GetWindowRect($Process.MainWindowHandle, [ref]$rect)
  $image = [Drawing.Bitmap]::new(($rect.Right - $rect.Left), ($rect.Bottom - $rect.Top))
  $graphics = [Drawing.Graphics]::FromImage($image)
  $dc = $graphics.GetHdc()
  try { [void][InstallerUI]::PrintWindow($Process.MainWindowHandle, $dc, 2) }
  finally { $graphics.ReleaseHdc($dc); $graphics.Dispose() }
  try { $image.Save((Join-Path $OutputDirectory $Name), [Drawing.Imaging.ImageFormat]::Png) }
  finally { $image.Dispose() }
}

function Assert-PrimaryButton($Process, $Control) {
  $window = New-Object InstallerUI+Rect
  $button = New-Object InstallerUI+Rect
  [void][InstallerUI]::GetWindowRect($Process.MainWindowHandle, [ref]$window)
  [void][InstallerUI]::GetWindowRect($Control.Handle, [ref]$button)
  if (-not [InstallerUI]::IsWindowEnabled($Control.Handle)) { throw 'The primary action is disabled' }
  if ($button.Top -lt ($window.Top + (($window.Bottom - $window.Top) * 0.75)) -or $button.Right -gt $window.Right -or $button.Bottom -gt $window.Bottom) {
    throw 'The primary action is outside the footer layout'
  }
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$installDirectory = Join-Path $env:RUNNER_TEMP 'No Type UI тест'
$dataDirectory = Join-Path $env:APPDATA $bundleId
New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
$marker = Join-Path $dataDirectory "installer-smoke-$([Guid]::NewGuid()).txt"
Set-Content -LiteralPath $marker -Value 'User data must survive installation and updates.' -Encoding utf8
$process = $null
try {
  $process = Start-Process -FilePath $Installer -ArgumentList "/NS /D=$installDirectory" -PassThru
  $install = Wait-WindowText $process @("Install $appName", "Установить $appName")
  Assert-PrimaryButton $process $install
  if (([InstallerUI]::GetWindowLong($install.Handle, -16) -band 15) -ne 11) { throw 'The native No Type button styling was not loaded' }
  [void](Wait-WindowText $process @('Your voice. Into words.', 'Голос становится текстом.'))
  [void](Wait-WindowText $process @('License and terms', 'Лицензия и условия'))
  Save-Window $process 'windows-installer-welcome.png'
  [void][InstallerUI]::PostMessage($install.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  [void](Wait-WindowText $process @('Getting things ready.', 'Готовим всё к работе.'))
  Save-Window $process 'windows-installer-progress.png'
  [void](Wait-WindowText $process @("You're all set.", 'Всё готово.') 180)
  Save-Window $process 'windows-installer-finish.png'
  if (-not (Test-Path -LiteralPath (Join-Path $installDirectory $binaryName))) { throw 'Application payload is missing' }
  if (-not (Test-Path -LiteralPath (Join-Path $installDirectory 'uninstall.exe'))) { throw 'Uninstaller is missing' }
  $close = Wait-WindowText $process @('Close', 'Закрыть')
  if (-not [InstallerUI]::IsWindowEnabled($close.Handle)) { throw 'The completion Close action is disabled' }
  [void][InstallerUI]::PostMessage($close.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  if (-not $process.WaitForExit(15000)) { throw 'The finish page did not close' }
  if ($process.ExitCode -ne 0) { throw "GUI installation failed: $($process.ExitCode)" }
  foreach ($resource in @('vulkan-1.dll', 'Vulkan-NOTICES.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $installDirectory $resource))) { throw "Windows Whisper resource is missing: $resource" }
  }
  # Windows resolves native DLL imports before main(). This check uses the
  # actual installed payload and catches a missing loader on GPU-less runners.
  $benchmarkError = Join-Path $env:RUNNER_TEMP 'no-type-whisper-startup.txt'
  $benchmark = Start-Process -FilePath (Join-Path $installDirectory $binaryName) -ArgumentList '--whisper-benchmark' -RedirectStandardError $benchmarkError -PassThru
  if (-not $benchmark.WaitForExit(15000)) { $benchmark.Kill(); throw 'Packaged Whisper startup timed out' }
  if ($benchmark.ExitCode -ne 1 -or (Get-Content -LiteralPath $benchmarkError -Raw) -notmatch 'Usage: --whisper-benchmark') {
    throw "Packaged Windows Whisper could not start: $($benchmark.ExitCode)"
  }
  Remove-Item -LiteralPath $benchmarkError -Force
  $process = Start-Process -FilePath $Installer -ArgumentList "/NS /D=$installDirectory" -PassThru
  $repair = Wait-WindowText $process @("Update $appName", "Обновить $appName")
  [void][InstallerUI]::PostMessage($repair.Handle, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero)
  [void](Wait-WindowText $process @("You're all set.", 'Всё готово.') 180)
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Updating through the GUI removed user data' }
  $close = Wait-WindowText $process @('Close', 'Закрыть')
  [void][InstallerUI]::PostMessage($process.MainWindowHandle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  if (-not $process.WaitForExit(15000)) { throw 'The update finish page did not close' }
  if ($process.ExitCode -ne 0) { throw "GUI update failed: $($process.ExitCode)" }
  $update = Start-Process -FilePath $Installer -ArgumentList "/P /UPDATE /NS /D=$installDirectory" -PassThru
  if (-not $update.WaitForExit(180000)) { $update.Kill(); throw 'Passive update timed out' }
  if ($update.ExitCode -ne 0) { throw "Passive update failed: $($update.ExitCode)" }
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Updating removed user data' }
  $uninstall = Start-Process -FilePath (Join-Path $installDirectory 'uninstall.exe') -ArgumentList '/S /UPDATE' -PassThru
  if (-not $uninstall.WaitForExit(60000)) { $uninstall.Kill(); throw 'Uninstall timed out' }
  if ($uninstall.ExitCode -ne 0) { throw "Uninstall failed: $($uninstall.ExitCode)" }
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Uninstalling for an update removed user data' }
  'Native installer GUI, Unicode install path, passive update and user-data preservation passed.'
} finally {
  if ($process -and -not $process.HasExited) { $process.Kill() }
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
}
