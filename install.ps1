# ติดตั้ง Katun Studio บน Windows
#   ดับเบิลคลิก install.cmd หรือรัน: powershell -ExecutionPolicy Bypass -File install.ps1
#   -Unattended     ไม่ถามอะไร (ข้าม Rhubarb และการเชื่อม Claude เว้นแต่ใส่สวิตช์ด้านล่าง)
#   -WithRhubarb    ดาวน์โหลด Rhubarb Lip Sync ด้วย
#   -ConnectClaude  เชื่อม MCP กับ Claude Desktop ด้วย
#   -NoShortcuts    ไม่สร้างไอคอนบนเดสก์ท็อป/Start Menu
param([switch]$Unattended, [switch]$WithRhubarb, [switch]$ConnectClaude, [switch]$NoShortcuts)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root = $PSScriptRoot
Set-Location $root

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Ok($text) { Write-Host "    $text" -ForegroundColor Green }
function Warn($text) { Write-Host "    $text" -ForegroundColor Yellow }
function Ask($question) {
  if ($Unattended) { return $false }
  $a = Read-Host "$question [Y/n]"
  return ($a -eq "" -or $a -match "^[yY]")
}

Write-Host "Katun Studio - ตัวติดตั้ง" -ForegroundColor White

# 1) Node.js
Step "ตรวจ Node.js"
$node = Get-Command node -ErrorAction SilentlyContinue
$major = if ($node) { [int]((node -v).TrimStart("v").Split(".")[0]) } else { 0 }
if ($major -lt 20) {
  Warn "ต้องใช้ Node.js 20 ขึ้นไป (พบ: $(if ($node) { node -v } else { 'ไม่มี' }))"
  if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Ask "ติดตั้ง Node.js LTS ด้วย winget เลยไหม?")) {
    winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  } else {
    throw "กรุณาติดตั้ง Node.js LTS จาก https://nodejs.org แล้วรันตัวติดตั้งอีกครั้ง"
  }
}
Ok "Node.js $(node -v)"

# 2) ไลบรารี
Step "ติดตั้งไลบรารี (npm install) อาจใช้เวลา 1-3 นาที"
npm install --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -ne 0) { throw "npm install ล้มเหลว" }
Ok "ครบแล้ว"

Step "สร้างหน้าจอโปรแกรม (build)"
npm run build --silent
if ($LASTEXITCODE -ne 0) { throw "build หน้าจอไม่สำเร็จ" }
Ok "พร้อม"

# 3) ตัวเรนเดอร์ (Chrome Headless Shell ที่ Remotion ใช้)
Step "เตรียมตัวเรนเดอร์วิดีโอ"
node node_modules/@remotion/cli/remotion-cli.js browser ensure
if ($LASTEXITCODE -ne 0) { Warn "เตรียมไม่สำเร็จ จะลองดาวน์โหลดอีกครั้งตอนเรนเดอร์ครั้งแรก" } else { Ok "พร้อม" }

# 4) ไฟล์ตั้งค่า
Step "ไฟล์ตั้งค่า"
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Ok "สร้าง .env แล้ว (ใส่ Azure key ได้ในหน้า ตั้งค่า ของโปรแกรม)" } else { Ok ".env มีอยู่แล้ว" }

# 5) คำสั่ง katun ใน Terminal
Step "ลงทะเบียนคำสั่ง katun"
npm link --no-audit --no-fund --loglevel=error
if ($LASTEXITCODE -eq 0) { Ok "ใช้คำสั่ง katun ได้ใน Terminal ใหม่" } else { Warn "ลงทะเบียนไม่สำเร็จ ใช้ 'node bin\katun.js' แทนได้" }

# 6) ไอคอนและทางลัด
if (-not $NoShortcuts) {
  Step "สร้างไอคอน Katun Studio"
  $ico = Join-Path $root "assets\katun.ico"
  New-Item -ItemType Directory -Force (Split-Path $ico) | Out-Null
  Add-Type -AssemblyName System.Drawing
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(58, 134, 255))), 0, 0, 63, 63)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(244, 162, 97))), 12, 10, 40, 40)
  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(43, 45, 66))
  $g.FillEllipse($dark, 22, 22, 6, 8); $g.FillEllipse($dark, 36, 22, 6, 8)
  $g.FillEllipse((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 30, 42))), 27, 34, 10, 8)
  $g.Dispose()
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $fs = [System.IO.File]::Create($ico); $icon.Save($fs); $fs.Close()

  $shell = New-Object -ComObject WScript.Shell
  $targets = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Katun Studio.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "Katun Studio.lnk")
  )
  foreach ($path in $targets) {
    $lnk = $shell.CreateShortcut($path)
    # เปิดผ่าน Katun.vbs: ไม่มีหน้าต่างดำ โปรแกรมขึ้นเป็นหน้าต่างของตัวเอง
    $lnk.TargetPath = Join-Path $env:SystemRoot "System32\wscript.exe"
    $lnk.Arguments = '"' + (Join-Path $root "Katun.vbs") + '"'
    $lnk.WorkingDirectory = $root
    $lnk.IconLocation = $ico
    $lnk.WindowStyle = 1
    $lnk.Description = "Katun Studio - ทำวิดีโอ AI แบบ 2D"
    $lnk.Save()
  }
  Ok "มีไอคอนบนเดสก์ท็อปและใน Start Menu แล้ว"
}

# 7) Rhubarb (ไม่บังคับ)
Step "Rhubarb Lip Sync (ปากขยับแม่นยำ ไม่บังคับ)"
if (Test-Path "tools\rhubarb\rhubarb.exe") { Ok "ติดตั้งแล้ว" }
elseif ($WithRhubarb -or (Ask "ดาวน์โหลด Rhubarb จาก GitHub (ประมาณ 70 MB) ไหม?")) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\setup-rhubarb.ps1")
} else { Warn "ข้าม (ติดตั้งทีหลังได้ในหน้า ตั้งค่า ของโปรแกรม)" }

# 8) เชื่อม Claude Desktop (ไม่บังคับ)
Step "เชื่อม MCP กับ Claude Desktop (ไม่บังคับ)"
if ($ConnectClaude -or (Ask "เชื่อม Katun กับ Claude Desktop เลยไหม?")) {
  node bin\katun.js connect claude-desktop
} else { Warn "ข้าม (เชื่อมทีหลังได้ในหน้า ตั้งค่า & เชื่อมต่อ AI หรือคำสั่ง katun connect claude-desktop)" }

Step "ตรวจความพร้อม"
node bin\katun.js doctor

Write-Host "`nติดตั้งเสร็จแล้ว! เปิดโปรแกรมได้จากไอคอน 'Katun Studio' หรือพิมพ์ katun ใน Terminal" -ForegroundColor Green
if (Ask "เปิด Katun Studio เลยไหม?") { Start-Process "wscript.exe" -ArgumentList ('"' + (Join-Path $root "Katun.vbs") + '"') }
