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

const ISI = {
  sakit: BantuanSakit,
  sehat: BantuanSakit,
  hasil: BantuanHasil,
  pengaturan: BantuanHasil,
} as const;

export type TabBantuanAdministrasi = keyof typeof ISI;

export function BantuanAdministrasi({ tab }: { tab: TabBantuanAdministrasi }) {
  const Isi = ISI[tab];
  return <Isi />;
}
