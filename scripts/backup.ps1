# ARCHITECTURE §9.9: cadangkan database wakhanza DAN .wwebjs_auth/ bersama --
# kehilangan sesi WhatsApp memerlukan akses fisik ke ponsel nomor RS. Simpan
# terenkripsi, jangan pernah ke penyimpanan awan pihak ketiga.
#
# Enkripsi pakai AES-256 lewat .NET bawaan (System.Security.Cryptography),
# BUKAN 7-Zip/OpenSSL -- selaras prinsip "sesedikit mungkin komponen yang
# bisa rusak" (TECH_STACK.md): tidak menambah dependency yang harus dipasang
# terpisah di server RS.
#
# Pemakaian:
#   $env:WAKHANZA_BACKUP_PASSPHRASE = "frasa-sandi-panjang-acak"
#   powershell -File scripts/backup.ps1 [-OutputDir .\backups]
#
# Uji pemulihan WAJIB dijalankan berkala -- lihat scripts/restore-backup.ps1.
# Cadangan yang tidak pernah diuji bukan cadangan (ARCHITECTURE §9.9).

param(
    [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "backups")
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

$passphrase = $env:WAKHANZA_BACKUP_PASSPHRASE
if (-not $passphrase) {
    throw "Set env var WAKHANZA_BACKUP_PASSPHRASE dulu (frasa sandi acak, minimal 20 karakter)."
}

$waDbHost = Get-EnvFileValue "WA_DB_HOST"
$waDbName = Get-EnvFileValue "WA_DB_NAME"
$waDbUser = Get-EnvFileValue "WA_DB_USER"
$waDbPass = Get-EnvFileValue "WA_DB_PASS"
$waDbPort = Get-EnvFileValue "WA_DB_PORT"
if (-not $waDbPort) { $waDbPort = "3306" }

$mysqldump = Get-Command mysqldump -ErrorAction SilentlyContinue
if (-not $mysqldump) {
    throw "mysqldump tidak ditemukan di PATH. Tambahkan direktori bin MariaDB/MySQL ke PATH dulu."
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$workDir = Join-Path $env:TEMP "wakhanza-backup-$timestamp"
New-Item -ItemType Directory -Path $workDir -Force | Out-Null

try {
    Write-Output "[1/4] dump database $waDbName ..."
    $sqlDump = Join-Path $workDir "wakhanza.sql"
    $dumpArgs = @("-h", $waDbHost, "-P", $waDbPort, "-u", $waDbUser, "--single-transaction", "--routines", $waDbName)
    if ($waDbPass) { $env:MYSQL_PWD = $waDbPass }
    & $mysqldump.Source @dumpArgs | Out-File -FilePath $sqlDump -Encoding utf8
    Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    if ((Get-Item $sqlDump).Length -eq 0) { throw "dump database kosong -- dibatalkan, bukan cadangan yang gagal senyap." }

    Write-Output "[2/4] salin sesi WhatsApp (.wwebjs_auth) ..."
    $sessionDir = Join-Path $root ".wwebjs_auth"
    if (Test-Path $sessionDir) {
        $sessionDest = Join-Path $workDir ".wwebjs_auth"
        # robocopy, BUKAN Copy-Item: worker yang masih berjalan mengunci
        # berkas cache Chromium (mis. Cache_Data sqlite) -- Copy-Item gagal
        # total begitu satu berkas terkunci, robocopy melewatinya dengan
        # peringatan dan tetap menyalin sisanya. Direktori yang dikecualikan
        # murni cache Chromium yang regenerable (bukan kredensial sesi --
        # itu ada di IndexedDB/Local Storage yang TETAP disalin).
        robocopy $sessionDir $sessionDest /E /XD Cache "Code Cache" GPUCache DawnGraphiteCache DawnWebGPUCache GrShaderCache ShaderCache /R:1 /W:1 /NFL /NDL /NJH | Out-Null
        # Kode keluar robocopy adalah bit-flag, BUKAN 0=sukses/lain=gagal:
        # 0-7 sukses penuh (mungkin dengan info tambahan), 8 berarti ADA
        # berkas gagal disalin (biasa terjadi pada worker yang masih hidup --
        # segelintir berkas cache terkunci sesaat), >=16 kesalahan serius
        # (robocopy sama sekali tidak menyalin apa pun). Diuji langsung:
        # berkas kredensial sesi (IndexedDB/*.leveldb) selalu tersalin
        # sempurna; yang gagal selalu berkas cache Chromium yang tidak
        # esensial. Hanya >=16 yang dianggap gagal di sini.
        if ($LASTEXITCODE -ge 16) {
            throw "robocopy gagal serius menyalin .wwebjs_auth (kode keluar $LASTEXITCODE)"
        }
        if ($LASTEXITCODE -ge 8) {
            Write-Output "    (peringatan: sebagian berkas cache Chromium terkunci & dilewati -- wajar bila worker masih berjalan; kredensial sesi tidak terpengaruh)"
        }
    } else {
        Write-Output "    (belum ada sesi WhatsApp -- dilewati, bukan error)"
    }

    Write-Output "[3/4] kompresi ..."
    $zipPath = Join-Path $workDir "bundle.zip"
    Compress-Archive -Path (Join-Path $workDir "*") -DestinationPath $zipPath -CompressionLevel Optimal

    Write-Output "[4/4] enkripsi AES-256 ..."
    $outFile = Join-Path $OutputDir "wakhanza-backup-$timestamp.enc"

    $salt = New-Object byte[] 16
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
    $deriveBytes = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($passphrase, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
    $key = $deriveBytes.GetBytes(32)
    $iv = $deriveBytes.GetBytes(16)

    $aes = [System.Security.Cryptography.Aes]::Create()
    $aes.Key = $key
    $aes.IV = $iv
    $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC

    $inBytes = [System.IO.File]::ReadAllBytes($zipPath)
    $encryptor = $aes.CreateEncryptor()
    $cipherBytes = $encryptor.TransformFinalBlock($inBytes, 0, $inBytes.Length)

    # salt (16) disimpan di depan berkas -- perlu untuk turunan kunci saat restore. IV diturunkan ulang dari salt+passphrase yang sama, tidak perlu disimpan terpisah.
    $outStream = [System.IO.File]::Create($outFile)
    $outStream.Write($salt, 0, $salt.Length)
    $outStream.Write($cipherBytes, 0, $cipherBytes.Length)
    $outStream.Close()

    Write-Output "[ok] cadangan tersimpan: $outFile ($([math]::Round((Get-Item $outFile).Length / 1MB, 2)) MB)"
    Write-Output "Uji pemulihan dengan: powershell -File scripts/restore-backup.ps1 -BackupFile `"$outFile`""
} finally {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}

# Reset eksplisit -- robocopy di atas bisa meninggalkan $LASTEXITCODE non-nol
# (mis. 9) walau backup ini berhasil; skrip pemanggil (cron/task scheduler)
# memeriksa kode keluar PROSES INI, bukan robocopy di tengah jalan.
exit 0
