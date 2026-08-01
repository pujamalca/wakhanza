# TECH_STACK.md "Izin Berkas": .env berisi kredensial database, .wwebjs_auth
# berisi sesi WhatsApp aktif - setara kredensial. Batasi keduanya hanya untuk
# akun yang menjalankan proses ini. Jalankan ulang tiap kali akun layanan berubah.
#
# SYSTEM WAJIB ikut diberi akses, dan itu bukan pelonggaran.
#
# Versi pertama skrip ini hanya memberi akses ke $env:USERNAME. Di mesin
# pengembangan itu tampak benar karena `npm run worker` dijalankan dari shell
# akun tersebut. Tapi topologi produksi proyek ini adalah PM2
# (ecosystem.config.js), dan proses yang diluncurkan PM2 di Windows berjalan
# sebagai SYSTEM - terukur lewat `whoami` dari dalam proses yang diluncurkan
# PM2, bukan dikira. Akibatnya /inheritance:r membuang ACE bawaan SYSTEM, lalu
# worker mati berulang dengan galat yang menyesatkan:
#
#   Error: Variabel lingkungan SIK_DB_HOST wajib diisi (lihat .env.example)
#
# Menyesatkan karena berkasnya ADA dan statSync() atasnya berhasil - yang gagal
# hanya membaca ISINYA (EPERM), dan process.loadEnvFile() menelan bedanya.
#
# Menambahkan SYSTEM tidak melemahkan apa pun yang sungguh dilindungi: proses
# SYSTEM sudah bisa mengambil alih kepemilikan berkas mana pun di mesin itu
# (SeTakeOwnership/SeBackupPrivilege), jadi mengecualikannya tidak menghalangi
# siapa-siapa - ia hanya mematahkan proses produksi kita sendiri. Yang memang
# jadi sasaran pengerasan ini tetap tertutup: akun interaktif LAIN di server RS
# tidak bisa membaca kredensial database maupun sesi WhatsApp.
#
# Kalau daemon PM2 di server RS dijalankan sebagai akun layanan khusus (bukan
# SYSTEM), tambahkan akun itu di $accounts di bawah dan jalankan ulang.

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Akun yang boleh membaca. Urutan tidak penting; /grant:r pertama yang dipakai
# bersama /inheritance:r yang menetapkan ACL, sisanya menambah.
$owner = "${env:USERNAME}"
$system = 'SYSTEM'

$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
    icacls $envFile /inheritance:r /grant:r "${owner}:(R)" | Out-Null
    icacls $envFile /grant:r "${system}:(R)" | Out-Null
    Write-Output "[ok] .env dibatasi hanya-baca untuk $owner + SYSTEM (PM2)"
} else {
    Write-Output "[lewati] .env belum ada"
}

$sessionDir = Join-Path $root '.wwebjs_auth'
if (Test-Path $sessionDir) {
    # (F) untuk keduanya: worker MENULIS ke direktori sesi terus-menerus
    # (whatsapp-web.js menyimpan state Chromium di sana), jadi hanya-baca
    # membuat sesi rusak dan QR harus dipindai ulang.
    icacls $sessionDir /inheritance:r /grant:r "${owner}:(F)" /T | Out-Null
    icacls $sessionDir /grant:r "${system}:(F)" /T | Out-Null
    Write-Output "[ok] .wwebjs_auth dibatasi untuk $owner + SYSTEM (PM2)"
} else {
    Write-Output "[lewati] .wwebjs_auth belum ada (belum ada sesi WhatsApp) - jalankan skrip ini lagi setelah scan QR pertama"
}
