# TECH_STACK.md "Izin Berkas": .env berisi kredensial database, .wwebjs_auth
# berisi sesi WhatsApp aktif - setara kredensial. Batasi keduanya hanya untuk
# akun yang menjalankan proses ini. Jalankan ulang tiap kali akun layanan berubah.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
    icacls $envFile /inheritance:r /grant:r "${env:USERNAME}:(R)" | Out-Null
    Write-Output "[ok] .env dibatasi hanya-baca untuk $env:USERNAME"
} else {
    Write-Output "[lewati] .env belum ada"
}

$sessionDir = Join-Path $root '.wwebjs_auth'
if (Test-Path $sessionDir) {
    icacls $sessionDir /inheritance:r /grant:r "${env:USERNAME}:(F)" /T | Out-Null
    Write-Output "[ok] .wwebjs_auth dibatasi untuk $env:USERNAME"
} else {
    Write-Output "[lewati] .wwebjs_auth belum ada (belum ada sesi WhatsApp) - jalankan skrip ini lagi setelah scan QR pertama"
}
