# Daily local crawl for sources that GitHub's US runners cannot reach
# (culture.seoul.go.kr, www.ui4u.go.kr). Registered in Windows Task Scheduler
# as "EventNow Seoul Crawl". Log: %LOCALAPPDATA%\EventNow\crawl.log

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $env:LOCALAPPDATA "EventNow"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "crawl.log"
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

function Log($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg" | Out-File -Append -Encoding utf8 $log }

# Keep the log small (last ~2000 lines)
if ((Test-Path $log) -and (Get-Item $log).Length -gt 1MB) {
    Get-Content $log -Tail 2000 | Set-Content -Encoding utf8 $log
}

Set-Location $repo
Log "=== start ($repo)"

$python = Join-Path $repo "python\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) { Log "python venv not found: $python"; exit 1 }

# Run a native command, appending its stdout+stderr to the log as UTF-8
function Run { $exe = $args[0]; $rest = @($args | Select-Object -Skip 1); & $exe @rest 2>&1 | ForEach-Object { "$_" } | Out-File -Append -Encoding utf8 $log }

Run git pull --rebase --autostash
if ($LASTEXITCODE -ne 0) { Log "git pull failed"; exit 1 }

Push-Location (Join-Path $repo "python")
Run $python run.py --store json --parser rules --sources "seoulportal,city,local"
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Log "crawler failed (exit $code)"; exit $code }

$data = @(
    "src/data/events.json", "src/data/events-meta.json",
    "python/data/seoul_detail_cache.json", "python/data/local_detail_cache.json", "python/data/osm_geocode_cache.json",
    "python/data/osm_reverse_cache.json"
) | Where-Object { Test-Path $_ }

if (-not (git status --porcelain -- $data)) { Log "no data changes"; exit 0 }

Run git add -- @data
Run git commit -m "data: local crawl $(Get-Date -Format 'yyyy-MM-dd HH:mm') (seoulportal,city,local)"
Run git pull --rebase --autostash
Run git push
if ($LASTEXITCODE -ne 0) { Log "git push failed"; exit 1 }
Log "=== pushed"
