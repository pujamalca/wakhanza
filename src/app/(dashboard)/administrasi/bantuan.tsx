import { HelpSection } from '@/components/ui';

/**
 * Isi laci bantuan `/administrasi`.
 *
 * Golongan ORIENTASI saja. Yang TETAP di halaman dan tetap terbentang — dan di
 * rute inilah pembedaannya paling tajam, karena yang beredar bukan kabar
 * melainkan BERKAS:
 *
 * - "Yang beredar bukan lagi kabar, melainkan surat"
 * - "Tidak ada yang memeriksa berkasnya sebelum berangkat" (kirim otomatis)
 * - "Yang dikirim di sini adalah ISI pemeriksaan, bukan kabar tentangnya"
 * - "Surat sehat TIDAK punya catatan di Khanza — baca ini dulu"
 * - "Pengiriman dokumen masih dimatikan"
 *
 * Kelimanya pagar. Tidak satu pun boleh pindah ke sini.
 */

const Kode = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-caption">{children}</span>
);

function BantuanSakit() {
  return (
    <HelpSection title="Surat dibuat di Khanza — di sini hanya dikirimkan">
      <p>
        Daftar ini membaca tabel <Kode>suratsakit</Kode>: satu baris per surat yang sudah dibuat dokter
        lewat SIMRS Khanza, lengkap dengan nomor surat dan lama istirahatnya. Halaman ini tidak pernah
        membuat, mengubah, atau menghapus surat — Khanza dibaca <strong>read-only</strong>.
      </p>
      <p>
        Rentang tanggal mengikuti tanggal surat <strong>dibuat</strong> (yang tersandi di nomor
        suratnya), bukan tanggal mulai istirahat — keduanya kerap berbeda, misalnya surat yang dibuat
        Jumat untuk istirahat mulai Senin.
      </p>
    </HelpSection>
  );
}

function BantuanHasil() {
  return (
    <HelpSection title="Bagaimana lampirannya bekerja, dan apa yang terjadi kalau gagal">
      <p>
        Lampiran ini menempel pada tiga pemicu yang sudah ada — tidak ada pemberitahuan baru, dan
        pasien tetap menerima <strong>satu</strong> WhatsApp per kejadian. Selama pemicunya nonaktif di
        halaman Template, tidak ada pesan yang keluar sama sekali dan sakelar di sini tidak melakukan
        apa-apa.
      </p>
      <p>
        Berkasnya dirender oleh worker saat kejadiannya terdeteksi, dengan batas 5 dokumen per siklus
        supaya peramban pencetak PDF tidak menumpuk di proses yang juga memegang sesi WhatsApp. Bila
        jatahnya habis atau rendernya gagal, <strong>pesannya tetap terkirim tanpa berkas</strong> —
        teks template biasa, persis seperti sebelum fitur ini ada. Pasien tidak pernah kehilangan
        pemberitahuannya karena lampirannya bermasalah; yang hilang cuma lampirannya, dan berkasnya
        tetap bisa diambil di rumah sakit.
      </p>
      <p>
        Pemeriksaan yang tetap berlaku seperti pemicu lain: daftar tolak, jam tenang, dan penggantian
        pesan untuk poli sensitif. Untuk memeriksa isinya sebelum menyalakan, jalankan{' '}
        <Kode>npm run dryrun:dokumen</Kode> di server — ia menghasilkan berkas PDF-nya tanpa mengirim
        apa pun.
      </p>
    </HelpSection>
  );
}

function BantuanBulanan() {
  return (
    <HelpSection title="Satu-satunya bagian halaman ini yang tidak mengirim apa pun ke pasien">
      <p>
        Rekap ini membaca <Kode>reg_periksa</Kode> untuk satu bulan penuh &mdash; bulan sebelum bulan berjalan, selalu
        &mdash; lalu mengirim <strong>satu pesan berisi angka</strong> ke grup staf pada tanggal dan jam yang disetel di
        bawah. Periodenya tidak bisa diubah: bulan berjalan selalu setengah jadi, dan menyediakan pilihannya berarti
        menyediakan cara menghasilkan angka yang salah tanpa satu pun galat.
      </p>
      <p>
        Rekap yang <strong>terlewat akan dikejar</strong>, kebalikan dari rekap harian. Isinya bulan yang sudah tutup,
        jadi angkanya sama persis apakah dikirim tanggal 3 atau tanggal 20 &mdash; worker yang mati sepekan lalu hidup
        lagi tetap mengirim rekap yang utuh. Akibatnya, menyalakan sakelarnya sesudah tanggal kirim lewat membuat
        rekapnya berangkat pada siklus berikutnya, bukan bulan depan.
      </p>
      <p>
        Beberapa angka akan berbunyi <strong>0 atau nyaris 0</strong> di rumah sakit ini, dan itu terukur bukan dugaan:
        diagnosa terisi pada 0,4% kunjungan, <Kode>resume_pasien</Kode> nol baris seluruhnya, surat kontrol satu baris,
        dan surat sakit berhenti dicatat sejak Februari 2025. Semuanya tetap ditampilkan &mdash; nol di sini keadaan
        yang bisa berubah, bukan sifat yang tetap, dan menyembunyikannya membuat &ldquo;belum diisi&rdquo; tidak bisa
        dibedakan dari &ldquo;tidak dibaca&rdquo;.
      </p>
      <p>
        Untuk memeriksa isinya sebelum menyalakan, jalankan <Kode>npm run dryrun:adm-bulanan</Kode> di server &mdash; ia
        mencetak rekapnya berikut pemeriksaan pagar privasinya, tanpa mengirim apa pun.
      </p>
    </HelpSection>
  );
}

const ISI = {
  sakit: BantuanSakit,
  sehat: BantuanSakit,
  hasil: BantuanHasil,
  bulanan: BantuanBulanan,
  pengaturan: BantuanHasil,
} as const;

export type TabBantuanAdministrasi = keyof typeof ISI;

export function BantuanAdministrasi({ tab }: { tab: TabBantuanAdministrasi }) {
  const Isi = ISI[tab];
  return <Isi />;
}
