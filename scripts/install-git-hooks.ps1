# Memasang git hook pre-push: typecheck + lint + test sebelum setiap `git push`.
#
# Rekomendasi teknis 9 Agustus 2026 (R6): tidak ada CI, tidak ada git hook --
# 606 uji yang selesai dalam 1,72 detik dan tidak butuh database hidup tidak
# dijalankan siapa pun kecuali diingat secara manual.
#
# `.git/hooks/` TIDAK ikut git -- berkas hook sungguhan
# (scripts/git-hooks/pre-push) adalah SUMBERnya, dan skrip ini menyalinnya ke
# tempat yang git benar-benar baca. Pola yang sama dengan
# install-backup-task.ps1: sumbernya tracked, instalasinya satu langkah
# eksplisit -- bukan otomatis lewat "prepare" di package.json (yang menjalankan
# skrip sembarang setiap kali `npm install`, dan menambah husky/lefthook cuma
# untuk ini melanggar "sesedikit mungkin komponen" yang sudah jadi alasan
# TECH_STACK.md menolak dependency serupa untuk keperluan lain).
#
# Pemakaian:
#   powershell -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/install-git-hooks.ps1 -Uninstall

param(
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$gitDir = Join-Path $root ".git"
$hooksDir = Join-Path $gitDir "hooks"
$target = Join-Path $hooksDir "pre-push"
$source = Join-Path $PSScriptRoot "git-hooks\pre-push"

if (-not (Test-Path $gitDir)) {
    throw "Bukan direktori repo git -- '$gitDir' tidak ditemukan."
}

if ($Uninstall) {
    if (Test-Path $target) {
        Remove-Item $target -Force
        Write-Output "[ok] hook pre-push dilepas."
    } else {
        Write-Output "[-] hook pre-push memang tidak terpasang."
    }
    exit 0
}

if (-not (Test-Path $source)) {
    throw "Sumber hook tidak ditemukan: $source"
}

New-Item -ItemType Directory -Path $hooksDir -Force | Out-Null
Copy-Item $source $target -Force

# Git for Windows menjalankan hook lewat sh.exe bawaannya sendiri berdasarkan
# shebang berkasnya, bukan bit executable ala Unix -- NTFS tidak punya konsep
# itu, jadi Copy-Item saja sudah cukup; tidak perlu icacls/chmod.

Write-Output "[ok] hook pre-push terpasang: $target"
Write-Output "     Menjalankan typecheck + lint + test sebelum SETIAP 'git push'."
Write-Output ""
Write-Output "Uji sekali dengan push kecil, atau jalankan langsung:"
Write-Output "  sh .git/hooks/pre-push"
Write-Output ""
Write-Output "Lepas dengan: powershell -File scripts/install-git-hooks.ps1 -Uninstall"
