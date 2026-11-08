#requires -Version 5.1
<#
    MomoTalk QA harness runner (headless Chrome).

    Usage:
        pwsh -File .\_test\run.ps1                         # 运行全部场景
        pwsh -File .\_test\run.ps1 -Scenario render        # 单个场景
        pwsh -File .\_test\run.ps1 -Scenario render,more   # 多个场景
        pwsh -File .\_test\run.ps1 -Shot                   # 截图模式（保存到 _test\shots）

    Requires the local preview server on -BaseUrl (default http://127.0.0.1:8765).
    If nothing is listening, the script tries to start _test/serve.js with the
    Node runtime and stops it again when it is done.

    Chrome is started with Start-Process + RedirectStandardOutput/StandardError
    (headless mode still needs working stdio; named pipes are not used).
#>
[CmdletBinding()]
param(
    [string]$Scenario = 'all',
    [switch]$Shot,
    [string]$BaseUrl = 'http://127.0.0.1:8765',
    [string]$Chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe',
    [int]$VirtualTimeBudget = 20000,
    [int]$ChromeTimeoutSec = 150,
    [switch]$KeepTemp
)

$ErrorActionPreference = 'Stop'
$script:AnyFail = $false

$TestDir = $PSScriptRoot
$RootDir = Split-Path -Parent $TestDir
$AllScenarios = @('boot', 'render', 'send-append', 'box-edit', 'more', 'playback', 'screenshot', 'backup', 'details', 'migration', 'import-export')

if ($Scenario -eq 'all' -or [string]::IsNullOrWhiteSpace($Scenario)) {
    $Targets = $AllScenarios
} else {
    $Targets = $Scenario.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$uri = [Uri]$BaseUrl
$Port = if ($uri.Port -gt 0) { $uri.Port } else { 8765 }
$Base = $BaseUrl.TrimEnd('/')

# ---------------------------------------------------------------- temp / dirs
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('mm-harness-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
$LastRunDir = Join-Path $TestDir 'last-run'
New-Item -ItemType Directory -Force -Path $LastRunDir | Out-Null

# ---------------------------------------------------------------- server
function Test-HarnessServer {
    param([string]$Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

$ServerProc = $null
$ServerStartedByUs = $false
if (-not (Test-HarnessServer ($Base + '/test-harness.html'))) {
    Write-Host "[harness] $Base 不可访问，尝试用 node 启动 _test/serve.js …" -ForegroundColor Yellow
    $NodeCandidates = @(
        'C:\Users\Administrator\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe',
        (Get-Command node -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -ErrorAction SilentlyContinue)
    ) | Where-Object { $_ -and (Test-Path $_) }
    if ($NodeCandidates.Count -eq 0) {
        Write-Host '[harness] 未找到 node，无法自动启动静态服务器。请先运行：' -ForegroundColor Red
        Write-Host ("         node _test\serve.js `"{0}`" {1}" -f $RootDir, $Port) -ForegroundColor Red
        exit 2
    }
    $Node = $NodeCandidates[0]
    $srvOut = Join-Path $TempDir 'server.out.txt'
    $srvErr = Join-Path $TempDir 'server.err.txt'
    $ServerProc = Start-Process -FilePath $Node -ArgumentList @((Join-Path $TestDir 'serve.js'), $RootDir, $Port) `
        -RedirectStandardOutput $srvOut -RedirectStandardError $srvErr -PassThru
    $ServerStartedByUs = $true
    $up = $false
    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 300
        if (Test-HarnessServer ($Base + '/test-harness.html')) { $up = $true; break }
        if ($ServerProc.HasExited) { break }
    }
    if (-not $up) {
        Write-Host '[harness] 无法启动本地静态服务器。' -ForegroundColor Red
        if (Test-Path $srvErr) { Get-Content $srvErr | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray } }
        if ($ServerStartedByUs -and $ServerProc -and -not $ServerProc.HasExited) { $ServerProc.Kill() }
        exit 2
    }
    Write-Host "[harness] 已启动本地服务器 http://127.0.0.1:$Port/ (pid=$($ServerProc.Id))" -ForegroundColor Green
} else {
    Write-Host "[harness] 使用已运行的本地服务器 $Base" -ForegroundColor Green
}

if (-not (Test-Path $Chrome)) {
    Write-Host "[harness] 找不到 Chrome：$Chrome" -ForegroundColor Red
    if ($ServerStartedByUs -and $ServerProc -and -not $ServerProc.HasExited) { $ServerProc.Kill() }
    exit 2
}

# ---------------------------------------------------------------- chrome
function Invoke-Chrome {
    param(
        [string[]]$ChromeArgs,
        [string]$Tag
    )
    $profile = Join-Path $TempDir ('profile-' + ($Tag -replace '[^A-Za-z0-9_-]', '_'))
    New-Item -ItemType Directory -Force -Path $profile | Out-Null
    $outFile = Join-Path $TempDir ($Tag + '.stdout.txt')
    $errFile = Join-Path $TempDir ($Tag + '.stderr.txt')
    $baseArgs = @(
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--force-device-scale-factor=1',
        "--user-data-dir=$profile",
        "--virtual-time-budget=$VirtualTimeBudget"
    )
    $allArgs = $baseArgs + $ChromeArgs
    $p = Start-Process -FilePath $Chrome -ArgumentList $allArgs `
        -RedirectStandardOutput $outFile -RedirectStandardError $errFile -PassThru
    $finished = $p.WaitForExit($ChromeTimeoutSec * 1000)
    if (-not $finished) {
        try { $p.Kill() } catch { }
        throw "Chrome 超时（${ChromeTimeoutSec}s，$Tag）"
    }
    $stdout = if (Test-Path $outFile) { Get-Content $outFile -Raw -Encoding UTF8 } else { '' }
    $stderr = if (Test-Path $errFile) { Get-Content $errFile -Raw -Encoding UTF8 } else { '' }
    return [pscustomobject]@{
        ExitCode = $p.ExitCode
        Stdout   = $stdout
        Stderr   = $stderr
        OutFile  = $outFile
        ErrFile  = $errFile
    }
}

function Get-HarnessResult {
    param([string]$Html)
    if ([string]::IsNullOrEmpty($Html)) { return $null }
    $m = [regex]::Match($Html, '(?s)<pre id="result"[^>]*>(.*?)</pre>')
    if (-not $m.Success) { return $null }
    $json = [System.Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
    try {
        return ($json | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Show-HarnessResult {
    param($Result, [string]$Name)
    if ($null -eq $Result) {
        Write-Host ("[FAIL] {0}: 未解析到 <pre id=""result""> 的 JSON" -f $Name) -ForegroundColor Red
        return $false
    }
    $pass = [int]$Result.pass
    $fail = [int]$Result.fail
    $errors = @()
    if ($Result.errors) { $errors = @($Result.errors) }
    $failures = @()
    if ($Result.failures) { $failures = @($Result.failures) }

    $color = if ($fail -gt 0 -or $errors.Count -gt 0) { 'Red' } else { 'Green' }
    Write-Host ("[{0}] pass={1} fail={2}  (scenario={3}, ready={4})" -f $Name, $pass, $fail, $Result.scenario, $Result.ready) -ForegroundColor $color

    foreach ($e in $errors) {
        Write-Host ("  ERROR: " + $e) -ForegroundColor DarkYellow
    }
    foreach ($f in $failures) {
        $actual = [string]$f.actual
        $actual = $actual -replace "`r?`n", ' '
        if ($actual.Length -gt 320) { $actual = $actual.Substring(0, 320) + '…' }
        Write-Host ("  FAIL: " + $f.name) -ForegroundColor Red
        Write-Host ("        actual: " + $actual) -ForegroundColor DarkGray
    }
    if ($Result.notes) {
        $Result.notes | Select-Object -Last 4 | ForEach-Object { Write-Host ("  note: " + $_) -ForegroundColor DarkGray }
    }
    return ($fail -eq 0 -and $errors.Count -eq 0)
}

Write-Host ''
Write-Host ("=== MomoTalk QA harness | scenarios: {0} | base: {1} | shot: {2} ===" -f ($Targets -join ', '), $Base, [bool]$Shot) -ForegroundColor Cyan
Write-Host ''

$Summary = @()
foreach ($sc in $Targets) {
    if ($AllScenarios -notcontains $sc) {
        Write-Host ("[skip] 未知场景：{0}（可用：{1}）" -f $sc, ($AllScenarios -join ', ')) -ForegroundColor Yellow
        continue
    }
    $url = '{0}/test-harness.html?scenario={1}' -f $Base, $sc
    try {
        if ($Shot) {
            $shotDir = Join-Path $TestDir 'shots'
            New-Item -ItemType Directory -Force -Path $shotDir | Out-Null
            $png = Join-Path $shotDir ($sc + '.png')
            $res = Invoke-Chrome -Tag ("shot-" + $sc) -ChromeArgs @('--window-size=390,844', ("--screenshot=" + $png), ($url + '&shot=1'))
            if ((Test-Path $png) -and ((Get-Item $png).Length -gt 0)) {
                Write-Host ("[shot] {0} -> {1}" -f $sc, $png) -ForegroundColor Green
                $Summary += [pscustomobject]@{ Name = $sc; Ok = $true; Pass = 0; Fail = 0; Shot = $png }
            } else {
                Write-Host ("[shot] {0} 截图失败" -f $sc) -ForegroundColor Red
                if (Test-Path $res.ErrFile) { Get-Content $res.ErrFile | Select-Object -First 5 | ForEach-Object { Write-Host ("        " + $_) -ForegroundColor DarkGray } }
                $Summary += [pscustomobject]@{ Name = $sc; Ok = $false; Pass = 0; Fail = 0; Shot = $null }
                $script:AnyFail = $true
            }
            continue
        }

        $res = Invoke-Chrome -Tag $sc -ChromeArgs @('--dump-dom', $url)
        $result = Get-HarnessResult $res.Stdout

        # persist raw artifacts for debugging
        try {
            Set-Content -Path (Join-Path $LastRunDir ($sc + '.dom.html')) -Value $res.Stdout -Encoding UTF8
            if ($null -ne $result) {
                $result | ConvertTo-Json -Depth 12 | Set-Content -Path (Join-Path $LastRunDir ($sc + '.result.json')) -Encoding UTF8
            }
            if ($res.Stderr) { Set-Content -Path (Join-Path $LastRunDir ($sc + '.chrome.stderr.txt')) -Value $res.Stderr -Encoding UTF8 }
        } catch { }

        $ok = Show-HarnessResult -Result $result -Name $sc
        if (-not $ok) { $script:AnyFail = $true }
        $Summary += [pscustomobject]@{
            Name = $sc
            Ok   = $ok
            Pass = if ($result) { [int]$result.pass } else { 0 }
            Fail = if ($result) { [int]$result.fail } else { -1 }
            Shot = $null
        }

        if ($null -eq $result) {
            Write-Host '  --- Chrome stderr (first 12 lines) ---' -ForegroundColor DarkGray
            if (Test-Path $res.ErrFile) { Get-Content $res.ErrFile | Select-Object -First 12 | ForEach-Object { Write-Host ("  " + $_) -ForegroundColor DarkGray } }
            if ($res.Stdout) {
                $len = [Math]::Min(800, $res.Stdout.Length)
                Write-Host ('  --- dump-dom head ---') -ForegroundColor DarkGray
                Write-Host ($res.Stdout.Substring(0, $len)) -ForegroundColor DarkGray
            }
            if ($res.Stderr -match 'platform_channel|crashpad|Access is denied|拒绝访问|0x5') {
                Write-Host '  [!] Chrome 启动/沙箱失败（platform channel 被拒绝）。' -ForegroundColor Yellow
                Write-Host '      请在外层（非受限沙箱）执行本脚本，或让 Lead 运行 run.ps1。' -ForegroundColor Yellow
            }
        }
        Write-Host ''
    } catch {
        Write-Host ("[FAIL] {0}: {1}" -f $sc, $_) -ForegroundColor Red
        $script:AnyFail = $true
        $Summary += [pscustomobject]@{ Name = $sc; Ok = $false; Pass = 0; Fail = -1; Shot = $null }
        Write-Host ''
    }
}

# ---------------------------------------------------------------- summary
Write-Host '=== 汇总 ===' -ForegroundColor Cyan
foreach ($s in $Summary) {
    $color = if ($s.Ok) { 'Green' } else { 'Red' }
    $status = if ($s.Ok) { 'PASS' } else { 'FAIL' }
    Write-Host ("  {0,-12} {1}  pass={2} fail={3}" -f $s.Name, $status, $s.Pass, $s.Fail) -ForegroundColor $color
}
$totalPass = ($Summary | Measure-Object -Property Pass -Sum).Sum
$totalFail = ($Summary | Measure-Object -Property Fail -Sum).Sum
Write-Host ("  合计: pass={0} fail={1}  (产物: {2})" -f $totalPass, $totalFail, $LastRunDir) -ForegroundColor Cyan

# ---------------------------------------------------------------- cleanup
if ($ServerStartedByUs -and $ServerProc -and -not $ServerProc.HasExited) {
    try { $ServerProc.Kill() } catch { }
    Write-Host '[harness] 已停止临时静态服务器' -ForegroundColor DarkGray
}
if (-not $KeepTemp) {
    try { Remove-Item -Recurse -Force $TempDir -ErrorAction SilentlyContinue } catch { }
} else {
    Write-Host "[harness] 临时目录保留：$TempDir" -ForegroundColor DarkGray
}

if ($script:AnyFail) { exit 1 } else { exit 0 }
