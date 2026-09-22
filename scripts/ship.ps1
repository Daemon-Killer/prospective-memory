# Automated End-to-End Release Pipeline for Remy
# Builds Android Release APK and uploads directly to Google Drive

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ReminderApp = Join-Path $RepoRoot "reminder app"
$PythonExe = Join-Path $RepoRoot ".venv\Scripts\python.exe"
$UploadScript = Join-Path $RepoRoot "scripts\upload_to_drive.py"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🚀 Starting Remy Android Release Pipeline" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Typecheck
Write-Host "`n[1/3] Running TypeScript validation..." -ForegroundColor Yellow
Push-Location $ReminderApp
try {
    npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw "TypeScript verification failed!" }
} finally {
    Pop-Location
}

# 2. Build Android Release APK
Write-Host "`n[2/3] Building standalone Android Release APK (gradlew assembleRelease)..." -ForegroundColor Yellow
Push-Location (Join-Path $ReminderApp "android")
try {
    .\gradlew.bat assembleRelease
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleRelease failed!" }
} finally {
    Pop-Location
}

# 3. Deploy to Google Drive
Write-Host "`n[3/3] Uploading Release APK to Google Drive..." -ForegroundColor Yellow
& $PythonExe $UploadScript
if ($LASTEXITCODE -ne 0) { throw "Google Drive upload failed!" }

Write-Host "`n✨ Pipeline complete! APK is live on Google Drive." -ForegroundColor Green
