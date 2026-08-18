<#
.SYNOPSIS
  Enam pemeriksaan sebelum wakhanza-worker dimulai ulang, lalu stop + start.

.DESCRIPTION
  Prosedurnya sudah tertulis lengkap di CLAUDE.md. Yang tetap terjadi: pada
  16 Agustus 2026 sesinya diperiksa dan seluruhnya sehat, lalu di-restart, dan
  penautannya tersangkut -- yang terlewat cuma satu butir, `uptime` 13 menit,
  yang artinya itu restart KEDUA. Di mesin ini butir yang terlewat berujung
  pada pemindaian QR yang menuntut akses fisik ke ponsel nomor RS.

  Tiga hal yang menempel pada skrip ini:

  1. BAWAANNYA MEMERIKSA SAJA. Tanpa -Jalankan ia tidak menyentuh apa pun.
     Restart di instalasi ini bukan operasi rutin; ia harus diminta dengan
     sengaja, bukan terjadi karena skripnya kebetulan dijalankan.

  2. `pm2 stop` lalu `pm2 start`, TIDAK PERNAH `pm2 restart`. Bedanya bukan
     gaya: `stop` menutup Chromium lewat shutdown() sampai tuntas, sementara
     `restart` melahirkan pengganti sebelum yang lama melepas direktori sesi.

  3. `pm2 jlist` memuat SELURUH env proses berikut kredensial database. Ia
     disalurkan ke berkas sementara, dibaca dengan node untuk mengambil DUA
     angka saja, lalu berkasnya dihapus di blok finally. Jangan pernah
     menampilkannya utuh ke layar atau menempelkannya ke tiket.

.PARAMETER Jalankan
  Benar-benar hentikan lalu jalankan lagi. Tanpa ini: hanya laporan.

.PARAMETER AbaikanUptime
  Lewati pagar uptime 30 menit. Hanya untuk keadaan yang sudah dipahami betul
  -- misalnya worker baru saja mati sendiri dan memang belum sempat berumur.
#>
param(
  [switch]$Jalankan,
  [switch]$AbaikanUptime
)

$ErrorActionPreference = 'Stop'
$AKAR = Split-Path -Parent $PSScriptRoot
Set-Location $AKAR

$AMBANG_UPTIME_MENIT = 30
$AMBANG_CHROMIUM_MB = 3000
$BATAS_TUNGGU_DETIK = 120

function Tulis($tanda, $teks) { Write-Output ("  {0,-5} {1}" -f $tanda, $teks) }

$penahan = New-Object System.Collections.ArrayList

# --- 1-4. bagian database ---------------------------------------------------
Write-Output ''
Write-Output 'Pemeriksaan database:'
& npx tsx scripts/pra-restart.ts
if ($LASTEXITCODE -ne 0) { [void]$penahan.Add('pemeriksaan database') }

# --- 5. uptime PM2 ----------------------------------------------------------
Write-Output ''
Write-Output 'Pemeriksaan proses:'

$berkasJlist = Join-Path $env:TEMP ("wakhanza-jlist-{0}.json" -f ([guid]::NewGuid().ToString('N')))
try {
  # Keluarannya TIDAK pernah menyentuh layar: ia memuat kredensial database.
  & pm2 jlist | Out-File -FilePath $berkasJlist -Encoding utf8
  $ringkas = & node -e @"
const l = require(process.argv[1]);
const w = l.find(p => p.name === 'wakhanza-worker');
if (!w) { console.log('TIDAK-ADA 0 0'); process.exit(0); }
const menit = Math.round((Date.now() - w.pm2_env.pm_uptime) / 60000);
console.log([w.pm2_env.status, menit, w.pm2_env.restart_time].join(' '));
"@ $berkasJlist
} finally {
  if (Test-Path $berkasJlist) { Remove-Item $berkasJlist -Force }
}

$bagian = $ringkas.Trim() -split '\s+'
$statusPm2 = $bagian[0]
$uptimeMenit = [int]$bagian[1]

if ($statusPm2 -ne 'online') {
  Tulis 'TAHAN' "status PM2         $statusPm2"
  [void]$penahan.Add('status PM2 bukan online')
} else {
  Tulis 'OK' "status PM2         online (restart ke-$($bagian[2]))"
}

if ($uptimeMenit -lt $AMBANG_UPTIME_MENIT -and -not $AbaikanUptime) {
  Tulis 'TAHAN' "uptime             $uptimeMenit menit"
  [void]$penahan.Add("uptime baru $uptimeMenit menit")
} else {
  Tulis 'OK' "uptime             $uptimeMenit menit"
}

# --- 6. ukuran Chromium -----------------------------------------------------
# Penyaring CommandLine WAJIB: di mesin ini ada belasan chrome.exe lain milik
# pemakai, dan mematikan semuanya berarti menutup peramban orang di tengah kerja.
$chrome = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*wwebjs_auth*' })
$chromeMb = 0
if ($chrome.Count -gt 0) {
  $chromeMb = [math]::Round((($chrome | Measure-Object -Property WorkingSetSize -Sum).Sum) / 1MB)
}

if ($chromeMb -gt $AMBANG_CHROMIUM_MB) {
  Tulis 'TAHAN' "Chromium           $chromeMb MB / $($chrome.Count) proses"
  [void]$penahan.Add("Chromium $chromeMb MB")
} else {
  Tulis 'OK' "Chromium           $chromeMb MB / $($chrome.Count) proses"
}

# --- hasil ------------------------------------------------------------------
Write-Output ''
if ($penahan.Count -gt 0) {
  Write-Output "MENAHAN restart ($($penahan.Count)): $($penahan -join '; ')"
  Write-Output ''
  Write-Output 'Uptime di bawah 30 menit berarti ada yang sudah menyalakannya ulang;'
  Write-Output 'restart berikutnya jadi yang KEDUA, dan yang kedua-lah yang tersangkut.'
  Write-Output 'Chromium yang membengkak membuat navigasi halaman lambat, dan balapan'
  Write-Output 'inject() vs navigasi jadi hampir selalu kalah -- gejalanya tersangkut'
  Write-Output 'di "menautkan" tanpa satu pun baris log menyebut memori.'
  exit 1
}

Write-Output 'Keenam pemeriksaan aman.'

if (-not $Jalankan) {
  Write-Output 'Tidak ada yang diubah. Tambahkan -Jalankan untuk benar-benar memulai ulang.'
  exit 0
}

# --- stop -------------------------------------------------------------------
Write-Output ''
Write-Output 'Menghentikan (pm2 stop, BUKAN restart)...'
& pm2 stop wakhanza-worker | Out-Null

$sisa = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
  Where-Object { $_.CommandLine -like '*wwebjs_auth*' })
if ($sisa.Count -gt 0) {
  Write-Output "  PERINGATAN: $($sisa.Count) Chromium pemegang sesi masih hidup sesudah stop."
  Write-Output '  Itu berarti shutdown() tidak tuntas. Matikan HANYA yang ini sebelum start:'
  Write-Output '    Get-CimInstance Win32_Process -Filter "Name=''chrome.exe''" |'
  Write-Output '      Where-Object { $_.CommandLine -like "*wwebjs_auth*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'
  exit 1
}
Tulis 'OK' 'sisa Chromium pemegang sesi: 0'

# --- start ------------------------------------------------------------------
Write-Output ''
Write-Output 'Menjalankan...'
$mulai = Get-Date
& pm2 start wakhanza-worker | Out-Null

# Penautan sehat terukur 5-13 detik; BATAS_INIT_MS worker sendiri 180 detik.
# Menunggu lebih lama daripada itu tidak menjawab apa pun -- worker sudah
# menjatuhkan dirinya lewat shutdown() dan menerbitkan peringatan.
$siap = $false
while (((Get-Date) - $mulai).TotalSeconds -lt $BATAS_TUNGGU_DETIK) {
  Start-Sleep -Seconds 5
  & npx tsx scripts/pra-restart.ts | Out-Null
  if ($LASTEXITCODE -eq 0) { $siap = $true; break }
}

$detik = [math]::Round(((Get-Date) - $mulai).TotalSeconds, 1)
Write-Output ''
if ($siap) {
  Write-Output "Sesi kembali ready dalam $detik detik."
  & npx tsx scripts/pra-restart.ts
  exit 0
}

Write-Output "Belum ready sesudah $detik detik."
Write-Output 'Yang perlu dikerjakan sekarang: MENUNGGU, bukan menyalakan ulang lagi.'
Write-Output 'Worker menjatuhkan dirinya sendiri di detik ke-180 lewat shutdown() berikut'
Write-Output 'peringatan session_init_stuck. Mengosongkan .wwebjs_auth adalah langkah'
Write-Output 'TERAKHIR dan menuntut ponsel nomor RS -- ia hanya berlaku bila'
Write-Output '"Runtime.callFunctionOn timed out" berulang pada durasi yang sama persis.'
exit 1
