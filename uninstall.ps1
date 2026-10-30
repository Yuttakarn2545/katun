# ถอนการติดตั้ง Katun Studio: ลบไอคอน คำสั่ง katun และการเชื่อม Claude Desktop
# ไม่ลบโฟลเดอร์ projects/ ของคุณ (ลบโฟลเดอร์ทั้งหมดเองถ้าไม่ต้องการแล้ว)
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot

node bin\katun.js disconnect claude-desktop
npm unlink -g katun --loglevel=error
foreach ($dir in @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs"))) {
  Remove-Item (Join-Path $dir "Katun Studio.lnk") -ErrorAction SilentlyContinue
}
Write-Host "ถอนการติดตั้งแล้ว ไฟล์โปรเจกต์ใน projects\ ยังอยู่ครบ" -ForegroundColor Green
