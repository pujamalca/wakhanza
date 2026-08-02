# ARCHITECTURE §9.9: "cadangan yang tidak pernah diuji bukan cadangan."
# Skrip ini mendekripsi + mengekstrak + memverifikasi ISI cadangan. Secara
# default TIDAK menimpa database wakhanza yang sedang berjalan -- itu
# tindakan merusak yang butuh konfirmasi eksplisit terpisah. Jalankan skrip
# ini secara rutin (mis. bulanan) sebagai bukti cadangan benar-benar valid.
#
# Pemakaian (verifikasi isi saja, tanpa restore sungguhan):
#   $env:WAKHANZA_BACKUP_PASSPHRASE = "frasa-sandi-yang-sama-saat-backup"
#   powershell -File scripts/restore-backup.ps1 -BackupFile .\backups\wakhanza-backup-....enc
#
# Pemakaian (restore sungguhan ke database uji baru -- BUKAN wakhanza produksi):
#   Ditemukan langsung saat diuji: WA_DB_USER (wakhanza_rw) di .env SENGAJA
#   tidak punya hak CREATE DATABASE global (hanya CREATE tabel di dalam
#   database wakhanza yang sudah ada, lihat TECH_STACK.md) -- properti
#   least-privilege yang baik, tapi berarti membuat database uji BARU perlu
#   akun dengan hak lebih luas (root/admin MariaDB), bukan WA_DB_USER.
#   powershell -File scripts/restore-backup.ps1 -BackupFile ... -RestoreDbName wakhanza_restore_test -AdminUser root

param(
    [Parameter(Mandatory = $true)][string]$BackupFile,
    [string]$RestoreDbName, # bila diisi, benar-benar memulihkan ke database bernama ini (BUKAN wakhanza produksi)
    [string]$AdminUser = "root", # WAJIB hak CREATE DATABASE -- default cocok untuk MariaDB lokal, timpa untuk server RS
    [string]$AdminPassword = ""
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

function Get-EnvFileValue {
    param([string]$Key)
    $envFile = Join-Path $root ".env"
    if (-not (Test-Path $envFile)) { return $null }
    $line = Get-Content $envFile | Where-Object { $_ -match "^$Key=" } | Select-Object -First 1
    if (-not $line) { return $null }
    return ($line -split '=', 2)[1]
}

# Sumber yang sama persis dengan backup.ps1 -- kalau keduanya membaca dari
# tempat berbeda, cadangan bisa terenkripsi dengan frasa yang tidak pernah
# bisa ditemukan lagi saat dibutuhkan.
$passphrase = $env:WAKHANZA_BACKUP_PASSPHRASE
if (-not $passphrase) { $passphrase = Get-EnvFileValue "WAKHANZA_BACKUP_PASSPHRASE" }
if (-not $passphrase) {
    throw "Frasa sandi tidak ada. Isi WAKHANZA_BACKUP_PASSPHRASE di .env, atau set env var-nya (harus sama dengan saat backup.ps1)."
}
if (-not (Test-Path $BackupFile)) {
    throw "Berkas cadangan tidak ditemukan: $BackupFile"
}

$workDir = Join-Path $env:TEMP "wakhanza-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    Write-Output "[1/3] dekripsi ..."
    $allBytes = [System.IO.File]::ReadAllBytes($BackupFile)
    $salt = $allBytes[0..15]
    $cipherBytes = $allBytes[16..($allBytes.Length - 1)]

    $deriveBytes = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($passphrase, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $key = $deriveBytes.GetBytes(32)
    $iv = $deriveBytes.GetBytes(16)

    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.Key = $key
    $aes.IV = $iv
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC

    $decryptor = $aes.CreateDecryptor()
    try {
        $plainBytes = $decryptor.TransformFinalBlock($cipherBytes, 0, $cipherBytes.Length)
    } catch {
        throw "Dekripsi gagal -- frasa sandi salah, atau berkas cadangan rusak. INI TEMUAN, bukan gangguan skrip: cadangan ini tidak bisa dipulihkan sebagaimana adanya."
    }

    $zipPath = Join-Path $workDir "bundle.zip"
    [System.IO.File]::WriteAllBytes($zipPath, $plainBytes)

    Write-Output "[2/3] ekstrak ..."
    Expand-Archive -Path $zipPath -DestinationPath $workDir -Force

    Write-Output "[3/3] verifikasi isi ..."
    $sqlDump = Join-Path $workDir "wakhanza.sql"
    $problems = @()

    if (-not (Test-Path $sqlDump)) {
        $problems += "wakhanza.sql tidak ada di dalam cadangan"
    } else {
        $content = Get-Content $sqlDump -Raw
        foreach ($table in @('outbox', 'template', 'audit_log', 'patient_contact')) {
            if ($content -notmatch "CREATE TABLE.*``?$table``?") {
                $problems += "tabel '$table' tidak ditemukan di dump SQL"
            }
        }
        Write-Output "    wakhanza.sql: $([math]::Round((Get-Item $sqlDump).Length / 1KB, 1)) KB"
    }

    $sessionDir = Join-Path $workDir ".wwebjs_auth"
    if (Test-Path $sessionDir) {
        Write-Output "    .wwebjs_auth: ada ($(( Get-ChildItem -Recurse $sessionDir | Measure-Object).Count) berkas)"
    } else {
        Write-Output "    .wwebjs_auth: TIDAK ADA di cadangan ini (tidak selalu masalah -- cek apakah backup.ps1 memang belum ada sesi saat itu)"
    }

    if ($problems.Count -gt 0) {
        Write-Output "`n[GAGAL] cadangan tidak lolos verifikasi:"
        $problems | ForEach-Object { Write-Output "  - $_" }
        exit 1
    }

    Write-Output "`n[ok] cadangan valid: dekripsi berhasil, dump SQL berisi tabel inti, terekstrak bersih."

    if ($RestoreDbName) {
        Write-Output "`nMemulihkan ke database '$RestoreDbName' (BUKAN wakhanza produksi) ..."

        # WAJIB kredensial eksplisit -- `mysql` tanpa -u memakai nama akun
        # Windows saat ini sebagai username MySQL. Ditemukan langsung: itu
        # gagal (Access denied) TAPI tidak menghentikan skrip di sini
        # sebelumnya, karena kegagalan exe native tidak otomatis melempar
        # exception PowerShell -- makanya $LASTEXITCODE diperiksa manual
        # setelah tiap pemanggilan, bukan diasumsikan berhasil.
        #
        # Dipakai -AdminUser (default root), BUKAN WA_DB_USER dari .env:
        # ditemukan langsung juga saat diuji, wakhanza_rw sengaja tidak
        # punya hak CREATE DATABASE global (TECH_STACK.md) sehingga tidak
        # bisa membuat database uji baru sama sekali.
        $dbHost = Get-EnvFileValue "WA_DB_HOST"
        $dbPort = Get-EnvFileValue "WA_DB_PORT"
        if (-not $dbPort) { $dbPort = "3306" }
        if (-not $dbHost) { $dbHost = "localhost" }

        if ($AdminPassword) { $env:MYSQL_PWD = $AdminPassword }
        try {
            & mysql -h $dbHost -P $dbPort -u $AdminUser -e "CREATE DATABASE IF NOT EXISTS ``$RestoreDbName``;"
            if ($LASTEXITCODE -ne 0) { throw "CREATE DATABASE '$RestoreDbName' gagal (kode keluar $LASTEXITCODE) -- coba -AdminUser/-AdminPassword yang punya hak CREATE DATABASE" }

            Get-Content $sqlDump | & mysql -h $dbHost -P $dbPort -u $AdminUser $RestoreDbName
            if ($LASTEXITCODE -ne 0) { throw "impor dump SQL ke '$RestoreDbName' gagal (kode keluar $LASTEXITCODE)" }

            $tableCount = (& mysql -h $dbHost -P $dbPort -u $AdminUser -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$RestoreDbName';" 2>$null)
        } finally {
            Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
        }

        if ([int]$tableCount -lt 1) {
            throw "restore tampak sukses tapi '$RestoreDbName' berisi 0 tabel -- INI TEMUAN, bukan restore yang valid."
        }
        Write-Output "[ok] dipulihkan ke '$RestoreDbName': $tableCount tabel. Periksa manual sebelum dipakai, lalu DROP DATABASE `$RestoreDbName` setelah selesai."
    } else {
        Write-Output "(Jalankan lagi dengan -RestoreDbName <nama> untuk benar-benar memulihkan ke database uji.)"
    }
} finally {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}
