# ดาวน์โหลด Rhubarb Lip Sync (MIT) จาก GitHub release ล่าสุด แล้ววางไว้ที่ tools/rhubarb/
# ไม่บังคับ: ถ้าไม่มี Rhubarb ระบบจะทำปากขยับตามความดังเสียงแทน
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$dest = Join-Path $root "tools\rhubarb"

$release = Invoke-RestMethod "https://api.github.com/repos/DanielSWolf/rhubarb-lip-sync/releases/latest"
$asset = $release.assets | Where-Object { $_.name -match "Windows.*\.zip$" } | Select-Object -First 1
if (-not $asset) { throw "ไม่พบไฟล์สำหรับ Windows ใน release $($release.tag_name)" }

$zip = Join-Path $env:TEMP $asset.name
Write-Host "ดาวน์โหลด $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB) ..."
Invoke-WebRequest $asset.browser_download_url -OutFile $zip

$tmp = Join-Path $env:TEMP "rhubarb-extract"
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
Expand-Archive $zip -DestinationPath $tmp
$inner = Get-ChildItem $tmp -Directory | Select-Object -First 1

New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $inner.FullName "*") $dest
Remove-Item -Recurse -Force $tmp, $zip

& (Join-Path $dest "rhubarb.exe") --version
Write-Host "ติดตั้งแล้วที่ $dest"
