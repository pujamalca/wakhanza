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
    [string]$OutputDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "backups"),
    # Cadangan lama dipangkas sendiri. Tanpa ini direktori backup tumbuh tanpa
    # batas sampai disk penuh -- dan disk penuh menghentikan MariaDB, yaitu
    # justru bencana yang cadangan ini ada untuk menghadapinya.
    [int]$KeepDays = 30
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

# Rekomendasi teknis 9 Agustus 2026 (R9): cadangan berjalan tiap hari dan
# TIDAK ADA yang pernah memeriksanya. Ukurannya terbukti berayun 14,53 MB ->
# 56,87 MB dalam satu minggu produksi tanpa satu orang pun melihat -- bisa
# jadi wajar (lonjakan kunjungan pasien), bisa juga tanda dump gagal sebagian
# atau sesi WhatsApp membengkak tak wajar. Skrip ini hanya bisa MENANDAI
# penyimpangan, bukan MEMUTUSKAN mana yang wajar -- itu tetap pekerjaan
# manusia, dan fungsi ini cuma memastikan ada manusia yang diberi tahu.
#
# TIDAK PERNAH melempar -- prinsip yang sama dengan worker/alert.ts's
# sendAlert(): kegagalan mengirim peringatan tidak boleh membuat backup.ps1
# sendiri gagal, itu menukar satu masalah (ukuran mencurigakan) dengan dua
# (cadangan hari ini pun tidak pernah tersimpan).
function Send-BackupAlert {
    param([string]$Message)
    try {
        $dbHost = Get-EnvFileValue "WA_DB_HOST"
        $dbPort = Get-EnvFileValue "WA_DB_PORT"
        if (-not $dbPort) { $dbPort = "3306" }
        $dbName = Get-EnvFileValue "WA_DB_NAME"
        $dbUser = Get-EnvFileValue "WA_DB_USER"
        $dbPass = Get-EnvFileValue "WA_DB_PASS"
        if (-not $dbHost -or -not $dbUser -or -not $dbName) {
            Write-Output "    (peringatan dilewati -- kredensial WA_DB_* tidak lengkap di .env)"
            return
        }

        # alert.webhook_url hidup di tabel app_setting (dashboard), bukan
        # .env -- dibaca lewat `mysql` langsung karena skrip ini PowerShell
        # murni, tidak mengimpor kode Node/Sequelize milik aplikasi.
        if ($dbPass) { $env:MYSQL_PWD = $dbPass }
        try {
            $mentah = & mysql -h $dbHost -P $dbPort -u $dbUser -N -e "SELECT v FROM app_setting WHERE k='alert.webhook_url'" $dbName 2>$null
        } finally {
            Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
        }
        $url = ($mentah | Out-String).Trim()
        if (-not $url -or $url -notmatch '^https?://') {
            Write-Output "    (peringatan dilewati -- alert.webhook_url belum diisi)"
            return
        }

        # Bentuk payload SAMA PERSIS dengan worker/alert.ts's sendAlert():
        # `text` di depan supaya Slack/Discord/Telegram memakainya apa
        # adanya tanpa adaptor kedua hanya karena sumbernya PowerShell.
        $payload = @{
            text    = "[wakhanza/$env:COMPUTERNAME] $Message"
            kind    = "backup_size_anomaly"
            message = $Message
            detail  = $null
            host    = $env:COMPUTERNAME
            at      = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
        } | ConvertTo-Json

        Invoke-RestMethod -Uri $url -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 10 | Out-Null
        Write-Output "    (peringatan terkirim ke alert.webhook_url)"
    } catch {
        Write-Output "    (peringatan GAGAL terkirim -- $($_.Exception.Message) -- backup ini TETAP dianggap berhasil)"
    }
}

# Env var lebih dulu (pemakaian manual), lalu .env sebagai cadangan.
# Jalur .env yang membuat penjadwalan mungkin sama sekali: Task Scheduler
# menjalankan skrip ini tanpa sesi interaktif, jadi tidak ada tempat untuk
# mengetik frasa sandi. .env sudah jadi tempat rahasia lain di proyek ini,
# gitignored, dan dikunci ke akun saat ini + SYSTEM oleh `npm run harden:permissions`.
$passphrase = $env:WAKHANZA_BACKUP_PASSPHRASE
if (-not $passphrase) { $passphrase = Get-EnvFileValue "WAKHANZA_BACKUP_PASSPHRASE" }
if (-not $passphrase) {
    throw "Frasa sandi tidak ada. Isi WAKHANZA_BACKUP_PASSPHRASE di .env, atau set env var-nya (minimal 20 karakter acak)."
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
    $dumpErr = Join-Path $workDir "mysqldump-stderr.txt"
    $dumpArgs = @("-h", $waDbHost, "-P", $waDbPort, "-u", $waDbUser, "--single-transaction", "--routines", $waDbName)
    if ($waDbPass) { $env:MYSQL_PWD = $waDbPass }

    # `$ErrorActionPreference` diturunkan HANYA untuk pemanggilan native ini.
    #
    # mysqldump MariaDB 10.4 di sini menulis satu peringatan tak berbahaya ke
    # stderr setiap kali jalan:
    #   Warning: option 'max_allowed_packet': unsigned value ... adjusted to ...
    # PowerShell 5.1 membungkus tiap baris stderr proses native jadi ErrorRecord
    # (NativeCommandError), dan dengan ErrorActionPreference 'Stop' itu menjadi
    # galat yang MENGHENTIKAN skrip -- padahal dump-nya sendiri berhasil dan
    # kode keluarnya 0.
    #
    # Bedanya cuma muncul di jalur terjadwal, dan itu yang membuatnya berbahaya:
    # dijalankan manual dari shell, peringatannya lewat begitu saja dan cadangan
    # terbentuk normal; dijalankan Task Scheduler lewat `-Command ... *>&1`,
    # skripnya mati di langkah 1 dan TIDAK ADA berkas cadangan yang terbentuk --
    # setiap hari, jam 01:00, tanpa seorang pun melihat. Sama persis pola
    # `trustHost` (CLAUDE.md): kelas kesalahan yang justru dimaafkan saat
    # dijalankan dengan tangan.
    #
    # Yang menentukan berhasil/gagal sekarang adalah KODE KELUAR mysqldump plus
    # ukuran berkas hasilnya, bukan ada-tidaknya tulisan di stderr.
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $mysqldump.Source @dumpArgs 2> $dumpErr | Out-File -FilePath $sqlDump -Encoding utf8
        $dumpExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEAP
        Remove-Item Env:\MYSQL_PWD -ErrorAction SilentlyContinue
    }

    if ($dumpExit -ne 0) {
        $pesan = if (Test-Path $dumpErr) { (Get-Content $dumpErr -Raw) } else { "(tidak ada keluaran stderr)" }
        throw "mysqldump gagal dengan kode keluar ${dumpExit}: $pesan"
    }
    if (-not (Test-Path $sqlDump) -or (Get-Item $sqlDump).Length -eq 0) {
        throw "dump database kosong -- dibatalkan, bukan cadangan yang gagal senyap."
    }
    # Dibuang sebelum dikompresi: isinya cuma peringatan, dan tidak ada gunanya
    # ikut terenkripsi ke dalam cadangan.
    Remove-Item $dumpErr -ErrorAction SilentlyContinue

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

    # --- R9: bandingkan ukuran dengan cadangan sebelumnya, tandai bila
    # selisihnya di luar wajar. Dijalankan SETELAH cadangan baru tersimpan
    # (angkanya perlu ada), TAPI SEBELUM pemangkasan (supaya cadangan
    # "sebelumnya" yang dibandingkan tidak mungkin baru saja dihapus).
    $AMBANG_PERSEN_SELISIH = 40
    $backupSebelumnya = Get-ChildItem -Path $OutputDir -Filter "wakhanza-backup-*.enc" |
        Where-Object { $_.FullName -ne $outFile } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
    if ($backupSebelumnya -and $backupSebelumnya.Length -gt 0) {
        $ukuranBaru = (Get-Item $outFile).Length
        $ukuranLama = $backupSebelumnya.Length
        $persenSelisih = [math]::Round((($ukuranBaru - $ukuranLama) / $ukuranLama) * 100, 1)
        if ([math]::Abs($persenSelisih) -gt $AMBANG_PERSEN_SELISIH) {
            $arah = if ($persenSelisih -gt 0) { "naik" } else { "turun" }
            $pesan = "Ukuran cadangan wakhanza $arah $([math]::Abs($persenSelisih))% dari hari sebelumnya " +
                "($([math]::Round($ukuranLama/1MB,2)) MB -> $([math]::Round($ukuranBaru/1MB,2)) MB). " +
                "Bukan otomatis berarti gagal -- tapi layak diperiksa manusia."
            Write-Output "[peringatan] $pesan"
            Send-BackupAlert -Message $pesan
        } else {
            Write-Output "    (selisih ukuran vs cadangan sebelumnya: $persenSelisih%, dalam batas wajar)"
        }
    } else {
        Write-Output "    (tidak ada cadangan sebelumnya untuk dibandingkan -- ini yang pertama)"
    }

    # Pemangkasan dijalankan SETELAH cadangan baru berhasil ditulis, tidak
    # pernah sebelumnya: kalau dump gagal, skrip sudah melempar di atas dan
    # tidak ada satu pun cadangan lama yang telanjur dihapus.
    if ($KeepDays -gt 0) {
        $batas = (Get-Date).AddDays(-$KeepDays)
        $lama = Get-ChildItem -Path $OutputDir -Filter "wakhanza-backup-*.enc" |
            Where-Object { $_.LastWriteTime -lt $batas -and $_.FullName -ne $outFile }
        foreach ($f in $lama) {
            Remove-Item $f.FullName -Force
            Write-Output "     dipangkas (lebih tua dari $KeepDays hari): $($f.Name)"
        }
    }

    Write-Output "Uji pemulihan dengan: powershell -File scripts/restore-backup.ps1 -BackupFile `"$outFile`""
} finally {
    Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}

# Reset eksplisit -- robocopy di atas bisa meninggalkan $LASTEXITCODE non-nol
# (mis. 9) walau backup ini berhasil; skrip pemanggil (cron/task scheduler)
# memeriksa kode keluar PROSES INI, bukan robocopy di tengah jalan.
exit 0
