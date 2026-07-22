param(
  [Parameter(Position = 0)]
  [ValidateSet("start", "stop", "restart", "status", "logs")]
  [string]$Command = "status",

  [int]$ServerPort = 3002,
  [int]$ClientPort = 5173
)

$ErrorActionPreference = "Stop"

$ProjectRoot = $PSScriptRoot
$RuntimeDir = Join-Path $ProjectRoot ".runtime"
$LogDir = Join-Path $RuntimeDir "logs"
$StateFile = Join-Path $RuntimeDir "orchestrator-state.json"

function Quote-PowerShellLiteral {
  param([Parameter(Mandatory = $true)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Ensure-RuntimeDir {
  New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
}

function Ensure-WorkspaceDependencies {
  $sharedPackage = Join-Path $ProjectRoot "node_modules\@twinops\shared\package.json"
  if (Test-Path -LiteralPath $sharedPackage) {
    return
  }

  Write-Host "Workspace dependencies are incomplete. Running npm install..."
  & npm install --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed with exit code $LASTEXITCODE."
  }

  if (-not (Test-Path -LiteralPath $sharedPackage)) {
    throw "npm install completed, but the @twinops/shared workspace link is still missing."
  }
}

function Read-State {
  if (-not (Test-Path -LiteralPath $StateFile)) {
    return [pscustomobject]@{}
  }
  try {
    return Get-Content -Raw -LiteralPath $StateFile | ConvertFrom-Json
  } catch {
    Write-Warning "Could not read orchestrator state. A new state file will be written on next start."
    return [pscustomobject]@{}
  }
}

function Write-State {
  param([Parameter(Mandatory = $true)]$State)
  Ensure-RuntimeDir
  $State | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

function Test-PidAlive {
  param([int]$ProcessId)
  if ($ProcessId -le 0) {
    return $false
  }
  return $null -ne (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
}

function Test-ManagedRootProcess {
  param([int]$ProcessId)
  if (-not (Test-PidAlive -ProcessId $ProcessId)) {
    return $false
  }

  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if (-not $process) {
    return $false
  }

  $rootPath = [System.IO.Path]::GetFullPath($ProjectRoot)
  $commandLine = [string]$process.CommandLine
  return (
    $commandLine.IndexOf($rootPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 -and
    $commandLine.IndexOf(".runtime\logs", [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  )
}

function Get-ChildProcessIds {
  param([int]$ParentId)
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ParentId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Get-ChildProcessIds -ParentId ([int]$child.ProcessId)
    [int]$child.ProcessId
  }
}

function Stop-ProcessTree {
  param(
    [int]$ProcessId,
    [string]$Name
  )

  if (-not (Test-PidAlive -ProcessId $ProcessId)) {
    Write-Host "$Name is not running."
    return
  }

  if (-not (Test-ManagedRootProcess -ProcessId $ProcessId)) {
    Write-Warning "Refusing to stop process $ProcessId because it is not a verified TwinOps orchestrator process."
    return
  }

  $ids = @(Get-ChildProcessIds -ParentId $ProcessId) + $ProcessId
  foreach ($id in ($ids | Select-Object -Unique)) {
    $process = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($process) {
      Write-Host "Stopping $Name process $id ($($process.ProcessName))"
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
  }
}

function Test-HttpReady {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Wait-ForUrl {
  param(
    [string]$Name,
    [string]$Url,
    [int]$Attempts = 45
  )

  for ($index = 1; $index -le $Attempts; $index += 1) {
    if (Test-HttpReady -Url $Url) {
      Write-Host "$Name is ready at $Url"
      return $true
    }
    Start-Sleep -Milliseconds 700
  }

  Write-Warning "$Name did not respond at $Url. Check logs in $LogDir."
  return $false
}

function Start-ManagedProcess {
  param(
    [string]$Name,
    [string]$CommandLine,
    [string]$LogFile
  )

  Ensure-RuntimeDir
  if (Test-Path -LiteralPath $LogFile) {
    Clear-Content -LiteralPath $LogFile
  } else {
    New-Item -ItemType File -Force -Path $LogFile | Out-Null
  }

  $process = Start-Process `
    -FilePath "powershell" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $CommandLine) `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -PassThru

  Write-Host "Started $Name process $($process.Id). Log: $LogFile"
  return [pscustomobject]@{
    pid = $process.Id
    log = $LogFile
    startedAt = (Get-Date).ToString("o")
  }
}

function Start-System {
  Ensure-RuntimeDir
  Ensure-WorkspaceDependencies
  $state = Read-State

  $serverPid = 0
  if ($state.server -and $state.server.pid) {
    $serverPid = [int]$state.server.pid
  }
  $clientPid = 0
  if ($state.client -and $state.client.pid) {
    $clientPid = [int]$state.client.pid
  }

  $nextState = [pscustomobject]@{
    projectRoot = $ProjectRoot
    serverPort = $ServerPort
    clientPort = $ClientPort
    server = $state.server
    client = $state.client
  }

  $serverReady = Test-HttpReady -Url "http://127.0.0.1:$ServerPort/api/health"
  if ((Test-ManagedRootProcess -ProcessId $serverPid) -and $serverReady) {
    Write-Host "Server already running as process $serverPid."
  } else {
    if (Test-ManagedRootProcess -ProcessId $serverPid) {
      Write-Warning "Server process $serverPid is alive but unhealthy. Restarting it."
      Stop-ProcessTree -ProcessId $serverPid -Name "server"
    } elseif ($serverReady) {
      throw "Port $ServerPort is already serving an unmanaged HTTP process. Stop it or choose another server port."
    }
    $serverLog = Join-Path $LogDir "server.log"
    $rootLiteral = Quote-PowerShellLiteral -Value $ProjectRoot
    $logLiteral = Quote-PowerShellLiteral -Value $serverLog
    $serverCommand = "Set-Location -LiteralPath $rootLiteral; `$env:PORT = '$ServerPort'; npm run dev -w server *> $logLiteral"
    $nextState.server = Start-ManagedProcess -Name "server" -CommandLine $serverCommand -LogFile $serverLog
  }

  $clientReady = Test-HttpReady -Url "http://127.0.0.1:$ClientPort"
  if ((Test-ManagedRootProcess -ProcessId $clientPid) -and $clientReady) {
    Write-Host "Client already running as process $clientPid."
  } else {
    if (Test-ManagedRootProcess -ProcessId $clientPid) {
      Write-Warning "Client process $clientPid is alive but unhealthy. Restarting it."
      Stop-ProcessTree -ProcessId $clientPid -Name "client"
    } elseif ($clientReady) {
      throw "Port $ClientPort is already serving an unmanaged HTTP process. Stop it or choose another client port."
    }
    $clientLog = Join-Path $LogDir "client.log"
    $rootLiteral = Quote-PowerShellLiteral -Value $ProjectRoot
    $logLiteral = Quote-PowerShellLiteral -Value $clientLog
    $clientCommand = "Set-Location -LiteralPath $rootLiteral; `$env:SERVER_PORT = '$ServerPort'; npm run dev -w client -- --port $ClientPort *> $logLiteral"
    $nextState.client = Start-ManagedProcess -Name "client" -CommandLine $clientCommand -LogFile $clientLog
  }

  Write-State -State $nextState

  $serverStarted = Wait-ForUrl -Name "Server" -Url "http://127.0.0.1:$ServerPort/api/health"
  $clientStarted = Wait-ForUrl -Name "Client" -Url "http://127.0.0.1:$ClientPort"
  if (-not $serverStarted -or -not $clientStarted) {
    throw "TwinOps startup failed. Run '.\orchestrator.cmd logs' for details."
  }
  Write-Host ""
  Write-Host "TwinOps is available at http://localhost:$ClientPort"
}

function Stop-System {
  $state = Read-State
  if ($state.client -and $state.client.pid) {
    Stop-ProcessTree -ProcessId ([int]$state.client.pid) -Name "client"
  } else {
    Write-Host "No managed client process recorded."
  }

  if ($state.server -and $state.server.pid) {
    Stop-ProcessTree -ProcessId ([int]$state.server.pid) -Name "server"
  } else {
    Write-Host "No managed server process recorded."
  }

  if (Test-Path -LiteralPath $StateFile) {
    Remove-Item -LiteralPath $StateFile -Force
  }
}

function Show-Status {
  $state = Read-State
  $serverPid = if ($state.server -and $state.server.pid) { [int]$state.server.pid } else { 0 }
  $clientPid = if ($state.client -and $state.client.pid) { [int]$state.client.pid } else { 0 }

  $rows = @(
    [pscustomobject]@{
      Service = "server"
      Port = $ServerPort
      Pid = if ($serverPid) { $serverPid } else { "" }
      Process = if (Test-ManagedRootProcess -ProcessId $serverPid) { "running" } else { "stopped" }
      Health = if (Test-HttpReady -Url "http://127.0.0.1:$ServerPort/api/health") { "ready" } else { "not responding" }
      Log = if ($state.server -and $state.server.log) { $state.server.log } else { Join-Path $LogDir "server.log" }
    },
    [pscustomobject]@{
      Service = "client"
      Port = $ClientPort
      Pid = if ($clientPid) { $clientPid } else { "" }
      Process = if (Test-ManagedRootProcess -ProcessId $clientPid) { "running" } else { "stopped" }
      Health = if (Test-HttpReady -Url "http://127.0.0.1:$ClientPort") { "ready" } else { "not responding" }
      Log = if ($state.client -and $state.client.log) { $state.client.log } else { Join-Path $LogDir "client.log" }
    }
  )

  $rows | Format-Table -AutoSize
}

function Show-Logs {
  Ensure-RuntimeDir
  $serverLog = Join-Path $LogDir "server.log"
  $clientLog = Join-Path $LogDir "client.log"

  Write-Host "== Server log =="
  if (Test-Path -LiteralPath $serverLog) {
    Get-Content -LiteralPath $serverLog -Tail 40
  } else {
    Write-Host "No server log yet."
  }

  Write-Host ""
  Write-Host "== Client log =="
  if (Test-Path -LiteralPath $clientLog) {
    Get-Content -LiteralPath $clientLog -Tail 40
  } else {
    Write-Host "No client log yet."
  }
}

switch ($Command) {
  "start" { Start-System }
  "stop" { Stop-System }
  "restart" {
    Stop-System
    Start-System
  }
  "status" { Show-Status }
  "logs" { Show-Logs }
}
