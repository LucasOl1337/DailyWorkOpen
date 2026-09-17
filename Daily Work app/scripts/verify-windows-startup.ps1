param(
  [switch]$Exercise
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$taskName = 'DailyWork'
$task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
$action = @($task.Actions)[0]
$logonTrigger = @($task.Triggers | Where-Object {
  $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger'
})[0]

if (-not $task.Settings.Enabled) {
  throw 'A tarefa DailyWork está desativada.'
}
if (-not $logonTrigger) {
  throw 'A tarefa DailyWork não possui gatilho de logon.'
}
if ($logonTrigger.Delay -and $logonTrigger.Delay -ne 'PT0S') {
  throw "A tarefa DailyWork ainda atrasa o início após o logon: $($logonTrigger.Delay)"
}
if ([IO.Path]::GetFullPath($action.Execute.Trim('"')) -ne [IO.Path]::GetFullPath($electronPath)) {
  throw "A tarefa DailyWork aponta para outro executável: $($action.Execute)"
}
if ($action.Arguments -notlike "*$projectRoot*" -or $action.Arguments -notlike '*--background*') {
  throw "Os argumentos da tarefa DailyWork estão incorretos: $($action.Arguments)"
}

if (-not $Exercise) {
  Write-Output 'PASS: tarefa de logon do DailyWork configurada.'
  return
}

Stop-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
$processos = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object {
  $_.CommandLine -like "*$projectRoot*" -and $_.CommandLine -notlike '*--type=*'
}
foreach ($processo in $processos) {
  Stop-Process -Id $processo.ProcessId -Force -ErrorAction Stop
}

$limite = (Get-Date).AddSeconds(10)
do {
  Start-Sleep -Milliseconds 250
  $estado = (Get-ScheduledTask -TaskName $taskName -TaskPath '\').State
} while ($estado -eq 'Running' -and (Get-Date) -lt $limite)

Start-ScheduledTask -TaskName $taskName -TaskPath '\'
$limite = (Get-Date).AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $processos = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object {
    $_.CommandLine -like "*$projectRoot*" -and $_.CommandLine -notlike '*--type=*'
  })
} while ($processos.Count -ne 1 -and (Get-Date) -lt $limite)

if ($processos.Count -ne 1) {
  $info = Get-ScheduledTaskInfo -TaskName $taskName -TaskPath '\'
  throw "A tarefa não manteve uma instância do DailyWork. LastTaskResult=$($info.LastTaskResult)"
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DailyWorkStartupWindow {
  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);
}
'@

$processoDailyWork = Get-Process -Id $processos[0].ProcessId -ErrorAction Stop
$shell = New-Object -ComObject WScript.Shell
$limite = (Get-Date).AddSeconds(8)
do {
  $shell.SendKeys('{HOME}')
  Start-Sleep -Milliseconds 250
  $processoDailyWork.Refresh()
  $visivel = $processoDailyWork.MainWindowHandle -ne 0 -and
    [DailyWorkStartupWindow]::IsWindowVisible($processoDailyWork.MainWindowHandle)
} while (-not $visivel -and (Get-Date) -lt $limite)

if (-not $visivel) {
  throw 'A tarefa iniciou o DailyWork, mas Home não abriu a janela.'
}

$null = $processoDailyWork.CloseMainWindow()
Start-Sleep -Seconds 2
if (-not (Get-Process -Id $processoDailyWork.Id -ErrorAction SilentlyContinue)) {
  throw 'Fechar a janela encerrou o processo em segundo plano.'
}

Write-Output "PASS: tarefa iniciou o DailyWork e Home abriu a janela. PID=$($processoDailyWork.Id)"
