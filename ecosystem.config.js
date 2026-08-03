// PM2. ARCHITECTURE §1: wakhanza-worker WAJIB instances:1, exec_mode:'fork' --
// TIDAK PERNAH 'cluster'. Klien whatsapp-web.js memegang sesi di memori dan
// mengunci direktori .wwebjs_auth; dua instance berarti dua Chromium
// memperebutkan satu sesi, berakhir dengan sesi rusak dan QR harus dipindai
// ulang. wakhanza-web boleh diskalakan bebas karena tidak memegang state apa
// pun -- semua koordinasi lewat tabel wakhanza (lihat src/worker/pipeline.ts,
// wa-client.ts).
//
// Worker dijalankan lewat tsx (bukan dikompilasi dulu ke JS) -- tsx sudah
// jadi dependency produksi (bukan devDependency) justru karena PM2 memakainya
// langsung di sini. Ini menghindari pipeline build kedua yang terpisah dari
// build Next.js, dengan ongkos: tsx wajib ada di node_modules produksi.
//
// JANGAN menunjuk `script` ke `node_modules/.bin/<apa pun>`. Berkas di .bin
// tanpa ekstensi adalah skrip /bin/sh (npm menaruh pembungkus .cmd/.ps1
// terpisah untuk Windows), dan PM2 menjalankan `script` dengan node -- jadi
// node mencoba mem-parse skrip shell sebagai JavaScript dan mati dengan
// "SyntaxError: missing ) after argument list", berulang-ulang karena
// autorestart. Ini menimpa KEDUA app di bawah dan baru ketahuan saat benar-benar
// dijalankan lewat PM2 di Windows; `npm run worker` tidak pernah menyentuh
// jalur ini karena npm memilih pembungkus .cmd sendiri.
//
// Yang dipakai sekarang: berkas JS/TS sungguhan + interpreter node eksplisit.
// Untuk worker sengaja `node --import tsx berkas.ts`, BUKAN CLI tsx: CLI itu
// menjalankan kode di proses ANAK, sehingga PM2 hanya mengawasi pembungkusnya.
// Akibatnya max_memory_restart di bawah akan mengukur pembungkus yang selalu
// kecil alih-alih Chromium yang merembes (justru satu-satunya alasan angka itu
// ada), dan SIGTERM saat restart berhenti di pembungkus tanpa pernah sampai ke
// handler shutdown di src/worker/index.ts yang menutup sesi WhatsApp dan pool
// database. `--import` membuat semuanya satu proses.
module.exports = {
  apps: [
    {
      name: 'wakhanza-worker',
      script: 'src/worker/index.ts',
      interpreter: 'node',
      interpreter_args: '--import tsx',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '800M', // ARCHITECTURE §12.4: Chromium merembeskan memori, restart aman karena outbox permanen
      restart_delay: 5000,
      // Windows tidak punya sinyal POSIX, jadi PM2 tidak benar-benar mengirim
      // SIGTERM dan handler shutdown di src/worker/index.ts praktis tidak
      // pernah menyala -- terbukti: barisnya nol kali di seluruh log restart.
      // Dengan ini PM2 mengirim pesan IPC 'shutdown' yang ditangani di sana.
      shutdown_with_message: true,
      // Bawaannya 1600 ms. Menutup Chromium dan menuntaskan flush state sesi
      // (.wwebjs_auth, LevelDB) tidak selesai secepat itu, jadi SIGKILL datang
      // di tengah penulisan dan meninggalkan sesi yang pada start BERIKUTNYA
      // menggantung di `authenticating` tanpa batas waktu.
      kill_timeout: 20000,
      // Exit 75 = instance ini mundur karena instance lain mengambil alih sesi
      // (KODE_KELUAR_DIGANTIKAN di src/worker/singleInstance.ts). WAJIB tidak
      // di-autorestart: pengganti sudah hidup dan sedang memegang sesi, jadi
      // meluncurkan satu lagi hanya menghasilkan pengusiran berikutnya --
      // itulah loop 115 restart / 15 menit pada 3 Agustus 2026. Exit 0
      // (shutdown biasa) dan exit 1 (watchdog sesi, pemeriksaan kesehatan)
      // sengaja TIDAK didaftarkan: keduanya justru bergantung pada PM2
      // menyalakan ulang.
      //
      // Butuh daemon PM2 >= 5.x yang mengenal opsi ini. Daemon 5.2.2 yang
      // sempat berjalan di mesin ini TIDAK -- opsinya diterima diam-diam lalu
      // diabaikan, jadi perbaikannya tampak terpasang padahal tidak berlaku.
      // Periksa dengan `pm2 ping` (In memory PM2 version) sesudah `pm2 update`.
      stop_exit_codes: [75],
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/pm2-worker.out.log',
      error_file: 'logs/pm2-worker.error.log',
    },
    {
      name: 'wakhanza-web',
      // Berkas JS sungguhan di balik shim .bin/next -- lihat catatan panjang di atas.
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3100',
      interpreter: 'node',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/pm2-web.out.log',
      error_file: 'logs/pm2-web.error.log',
    },
  ],
};
