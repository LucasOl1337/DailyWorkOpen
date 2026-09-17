param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$electronPath = Join-Path $projectRoot 'node_modules\electron\dist\electron.exe'
$distEntry = Join-Path $projectRoot 'dist\index.html'

if (-not $SkipBuild) {
  Push-Location $projectRoot
  try {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) {
      throw "A build do DailyWork falhou com codigo $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $electronPath)) {
  throw "Electron nao encontrado em $electronPath. Execute npm install primeiro."
}

if (-not (Test-Path -LiteralPath $distEntry)) {
  throw "Build nao encontrada em $distEntry. Execute npm run build primeiro."
}

$programsDir = Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'
$shortcutPath = Join-Path $programsDir 'DailyWork.lnk'
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'DailyWork.lnk'
$taskName = 'DailyWork'

New-Item -ItemType Directory -Path $programsDir -Force | Out-Null

$shell = New-Object -ComObject WScript.Shell
$atalhos = @(
  @{ Path = $shortcutPath; Arguments = '"' + $projectRoot + '"' },
  @{ Path = $desktopShortcutPath; Arguments = '"' + $projectRoot + '"' }
)

foreach ($atalho in $atalhos) {
  $shortcut = $shell.CreateShortcut($atalho.Path)
  $shortcut.TargetPath = $electronPath
  $shortcut.Arguments = $atalho.Arguments
  $shortcut.WorkingDirectory = $projectRoot
  $shortcut.Description = 'Abrir o DailyWork'
  $shortcut.IconLocation = "$electronPath,0"
  $shortcut.Save()
}

foreach ($atalho in $atalhos) {
  if (-not (Test-Path -LiteralPath $atalho.Path)) {
    throw "O atalho nao foi criado em $($atalho.Path)."
  }
}

$taskUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$taskAction = New-ScheduledTaskAction `
  -Execute $electronPath `
  -Argument ('"' + $projectRoot + '" --background') `
  -WorkingDirectory $projectRoot
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $taskUser
$taskSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$taskPrincipal = New-ScheduledTaskPrincipal `
  -UserId $taskUser `
  -LogonType Interactive `
  -RunLevel Limited
$task = New-ScheduledTask `
  -Action $taskAction `
  -Trigger $taskTrigger `
  -Settings $taskSettings `
  -Principal $taskPrincipal `
  -Description 'Mantém o DailyWork ativo em segundo plano após o login.'
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null

& (Join-Path $PSScriptRoot 'verify-windows-startup.ps1') -Exercise

Write-Output "DailyWork registrado no menu Iniciar: $shortcutPath"
Write-Output "DailyWork registrado na Area de Trabalho: $desktopShortcutPath"
Write-Output "DailyWork registrado para iniciar com o Windows: tarefa agendada $taskName"
