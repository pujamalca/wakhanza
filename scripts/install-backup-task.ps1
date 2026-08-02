# Mendaftarkan cadangan harian ke Windows Task Scheduler.
#
# Kenapa ini perlu ada sebagai skrip, bukan sebaris instruksi di dokumen:
# `backup.ps1` sudah ada dan sudah pernah diuji manual sejak Fase 4, tapi tidak
# pernah dijadwalkan -- direktori `backups\` bahkan belum pernah terbentuk.
# Cadangan yang bergantung pada seseorang mengingat untuk menjalankannya bukan
# cadangan. Yang hilang bila disk mati bukan cuma riwayat: `opt_out` adalah
# catatan permintaan berhenti dari pasien (tidak bisa direkonstruksi dari mana
# pun), `audit_log` sengaja append-only, dan `.wwebjs_auth` yang hilang berarti
# scan QR ulang dengan akses fisik ke ponsel nomor RS.
#
# Berjalan sebagai SYSTEM, dan itu keputusan sadar:
#   - tidak perlu menyimpan password akun di Task Scheduler
#   - tetap jalan saat tidak ada yang login (server RS umumnya begitu)
#   - .env & .wwebjs_auth memang SUDAH memberi akses ke SYSTEM
#     (`npm run harden:permissions`, TECH_STACK.md "Izin Berkas")
#   - mysqldump ada di PATH tingkat MESIN, jadi SYSTEM ikut menemukannya
#
# Pemakaian:
#   powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -At 01:30 -KeepDays 60
#   powershell -ExecutionPolicy Bypass -File scripts/install-backup-task.ps1 -Uninstall

param(
    [string]$TaskName = "wakhanza-backup-harian",
    # 01:00: setelah lalu lintas pasien reda, dan SEBELUM pembersihan berkala
    # worker jam 02:00 -- jadi cadangan hari itu masih memuat baris yang justru
    # akan dipangkas beberapa jam kemudian.
    [string]$At = "01:00",
    [int]$KeepDays = 30,
    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backupScript = Join-Path $PSScriptRoot "backup.ps1"
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "backup-task.log"

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Output "[ok] tugas terjadwal '$TaskName' dihapus."
    } else {
        Write-Output "[-] tugas terjadwal '$TaskName' memang tidak ada."
    }
    exit 0
}

# --- prasyarat, diperiksa SEKARANG supaya kegagalannya tidak muncul jam 01:00 ---

if (-not (Test-Path $backupScript)) { throw "scripts/backup.ps1 tidak ditemukan." }

$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) { throw ".env tidak ditemukan -- backup.ps1 membaca kredensial database dari sana." }

$punyaFrasa = (Get-Content $envFile | Where-Object { $_ -match '^WAKHANZA_BACKUP_PASSPHRASE=.+' } | Measure-Object).Count -gt 0
if (-not $punyaFrasa) {
    throw @"
WAKHANZA_BACKUP_PASSPHRASE belum ada di .env.

Task Scheduler tidak punya sesi interaktif, jadi frasa sandinya harus sudah
tersimpan sebelum tugasnya didaftarkan. Buat satu yang acak:

  `$b = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes(`$b)
  Add-Content .env ("WAKHANZA_BACKUP_PASSPHRASE=" + [Convert]::ToBase64String(`$b))
  npm run harden:permissions

CATAT FRASA ITU DI LUAR MESIN INI JUGA. Ia satu-satunya kunci isi cadangan,
dan menyimpannya HANYA di .env berarti kebakaran/disk mati menghapus cadangan
beserta kuncinya sekaligus.
"@
}

# mysqldump wajib ada di PATH tingkat mesin -- PATH milik user tidak terbaca SYSTEM.
$mesinPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$adaMysqldump = $false
foreach ($p in ($mesinPath -split ';')) {
    if ($p -and (Test-Path (Join-Path $p "mysqldump.exe"))) { $adaMysqldump = $true; break }
}
if (-not $adaMysqldump) {
    throw "mysqldump.exe tidak ada di PATH tingkat MESIN. Tugas ini berjalan sebagai SYSTEM, yang tidak membaca PATH milik user -- tambahkan direktori bin MariaDB ke PATH sistem dulu."
}

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

# --- pendaftaran ---

# Keluaran dialihkan ke berkas: tugas terjadwal tidak punya konsol, jadi tanpa
# ini satu-satunya jejak kegagalan adalah kode keluar di Task Scheduler -- yang
# tidak memberi tahu APA yang gagal.
$perintah = "& '$backupScript' -KeepDays $KeepDays *>&1 | Tee-Object -FilePath '$logFile' -Append"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NonInteractive -NoProfile -ExecutionPolicy Bypass -Command `"$perintah`"" `
    -WorkingDirectory $root

$trigger = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Force `
    -Description "Cadangan harian database wakhanza + sesi WhatsApp, terenkripsi AES-256." | Out-Null

Write-Output "[ok] tugas terjadwal '$TaskName' terpasang -- setiap hari pukul $At sebagai SYSTEM."
Write-Output "     log   : $logFile"
Write-Output "     simpan: $KeepDays hari"
Write-Output ""
Write-Output "Jalankan sekali sekarang untuk membuktikannya:"
Write-Output "  Start-ScheduledTask -TaskName $TaskName"
Write-Output ""
Write-Output "Lalu WAJIB uji pemulihannya -- cadangan yang tidak pernah diuji bukan cadangan:"
Write-Output "  powershell -File scripts/restore-backup.ps1 -BackupFile <berkas .enc terbaru>"
