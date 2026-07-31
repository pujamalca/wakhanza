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
module.exports = {
  apps: [
    {
      name: 'wakhanza-worker',
      script: 'node_modules/.bin/tsx',
      args: 'src/worker/index.ts',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '800M', // ARCHITECTURE §12.4: Chromium merembeskan memori, restart aman karena outbox permanen
      restart_delay: 5000,
      env: {
        NODE_ENV: 'production',
      },
      out_file: 'logs/pm2-worker.out.log',
      error_file: 'logs/pm2-worker.error.log',
    },
    {
      name: 'wakhanza-web',
      script: 'node_modules/.bin/next',
      args: 'start -H 127.0.0.1 -p 3100',
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
