import { HelpSection } from '@/components/ui';

/**
 * Isi laci bantuan `/farmasi`, satu susunan per tab.
 *
 * ## Kenapa berkas ini ada
 *
 * `/farmasi` diukur memuat **32.039 karakter prosa** -- 38% dari seluruh
 * dashboard -- di 21 `Callout` dan 27 `Petunjuk` pada satu rute. Prosanya
 * sendiri tidak salah: halaman di proyek ini memang sengaja menuliskan alasannya
 * di depan staf, dan keputusan itu dipertahankan. Yang salah adalah TEMPATNYA.
 *
 * Keterangan yang dibaca sekali seumur pemasangan ("apa itu tab Pengadaan",
 * "kenapa sakelarnya berdiri sendiri") duduk di jalur yang dilewati petugas
 * puluhan kali sehari, dan melipatnya tidak menolong: kotak terlipat TETAP
 * memakan satu baris judul dan tetap memutus aliran antara satu kontrol dan
 * berikutnya. Pada halaman berisi belasan lipatan, deretan judul terlipat itu
 * sendiri jadi kebisingan yang baru.
 *
 * ## Yang TIDAK boleh dipindah ke sini
 *
 * Peringatan yang harus dibaca **sebelum** sebuah sakelar dinyalakan tetap
 * terbentang di halamannya. Lima yang tinggal di `page.tsx`:
 *
 * - data pasien ke grup (tab Resep)
 * - kolom pasien yang sengaja tidak dibaca (tab Penjualan)
 * - Pemesanan bukan pengganti Pengadaan (dua pesan untuk satu kejadian)
 * - hibah belum pernah tercatat -- periksa sebelum menyalakan
 * - menu pemesanan praktis belum dipakai -- periksa sebelum menyalakan
 *
 * Memindahkan salah satunya ke sini menukar halaman yang lebih pendek dengan
 * keputusan yang diambil tanpa keterangan. Lihat `DESIGN_SYSTEM.md` §5.
 *
 * ## Kenapa satu berkas, bukan prop di tiap tab
 *
 * Isinya dirender di SERVER dan diserahkan ke `HelpPanel` sebagai `children`,
 * jadi seluruh prosa tetap ada di HTML halaman: bisa dicari Ctrl+F, bisa dibaca
 * pembaca layar. Ia hanya tidak tergambar sampai diminta -- itu yang
 * membedakannya dari menghapus prosa.
 */

const Tabel = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-caption">{children}</span>
);

const Tekan = ({ children }: { children: React.ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);

/** Berlaku untuk SELURUH halaman, jadi ikut di tiap tab. */
function BerlakuSemua() {
  return (
    <HelpSection title="Berlaku untuk semua pesan di halaman ini">
      <p>
        <Tekan>Permintaan “Berhenti Kirim Otomatis” dari pasien tidak berlaku.</Tekan> Pesan di halaman
        ini tidak dikirim ke pasien melainkan ke staf, jadi tidak ada nomor pasien yang bisa dicocokkan
        ke daftar tolak — dan koordinasi kerja internal memang bukan sesuatu yang bisa dihentikan
        pasien.
      </p>
      <p>
        <Tekan>Jam tenang dilewati.</Tekan> Jam tenang melindungi orang yang sedang tidur di rumah,
        bukan shift malam yang justru menunggu pesan ini. Menahannya sampai pagi juga akan membuat
        seluruh resep semalam menumpuk lalu terkirim serentak sebagai puluhan pesan basi sekaligus.
      </p>
    </HelpSection>
  );
}

function BantuanTujuan() {
  return (
    <>
      <HelpSection title="Satu daftar tujuan, dipakai keenam fitur">
        <p>
          Enam centang di tiap baris menjawab enam pertanyaan yang berbeda: <Tekan>Aktif</Tekan>{' '}
          menerima notifikasi resep, <Tekan>Boleh tanya</Tekan> boleh membuat nomor rumah sakit
          menjawab, <Tekan>Darurat stok</Tekan> menerima rekap persediaan, <Tekan>Pengadaan</Tekan>{' '}
          menerima nota pembelian, <Tekan>Hibah</Tekan> menerima nota barang pemberian, dan{' '}
          <Tekan>Pemesanan</Tekan> menerima nota pesanan ke pemasok.
        </p>
        <p>
          Sengaja terpisah — sebuah grup sangat wajar perlu tahu tiap resep tanpa ikut membaca harga
          beli dari pemasok, nilai barang hibah punya batas kerahasiaan yang lain lagi, dan memantau
          apa yang sedang <em>dipesan</em> adalah pekerjaan yang berbeda dari mencocokkan apa yang
          sudah <em>datang</em>.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanResep() {
  return (
    <>
      <HelpSection title="Dari mana datanya">
        <p>
          Kedua kejadian di tab ini dibaca dari tabel <Tabel>resep_obat</Tabel> milik SIMRS Khanza.
          wakhanza tidak pernah menulis apa pun ke sana.
        </p>
      </HelpSection>
      <HelpSection title="Rekap harian: satu pesan sehari berisi ANGKA saja">
        <p>
          Pada jam yang disetel, sistem membaca seluruh resep satu hari lalu mengirim{' '}
          <Tekan>satu pesan</Tekan> berisi totalnya: jumlah resep, baris obat, racikan, berapa yang
          sudah diserahkan dan berapa yang belum, plus rincian per dokter.
        </p>
        <p>
          Berbeda dari notifikasi per resep, rekap ini{' '}
          <Tekan>tidak menyentuh tabel pasien sama sekali</Tekan> — bukan “dibaca lalu tidak
          ditampilkan”, melainkan <Tabel>reg_periksa</Tabel> dan <Tabel>pasien</Tabel> memang tidak
          ikut dalam query-nya, sehingga tidak ada jalan apa pun menuju identitas seseorang. Nama obat
          dan aturan pakai juga tidak; yang dihitung cuma banyaknya.
        </p>
        <p>
          Karena itu rekap bisa dipakai <Tekan>tanpa</Tekan> menyalakan notifikasi per resep — dan
          bagi rumah sakit yang belum memutuskan soal data pasien di grup, itulah kombinasi yang masuk
          akal.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanStok() {
  return (
    <>
      <HelpSection title="Arah MASUK — menjawab pertanyaan yang dikirim ke nomor rumah sakit">
        <p>
          Pertanyaan seperti “stok paracetamol?” dijawab dengan data dari <Tabel>databarang</Tabel> dan{' '}
          <Tabel>gudangbarang</Tabel> milik SIMRS Khanza. Punya sakelarnya sendiri: <Tekan>tidak</Tekan>{' '}
          terpengaruh sakelar di tab Notifikasi resep maupun sakelar di Balasan otomatis.
        </p>
      </HelpSection>
      <HelpSection title="Ini katalog apotek, bukan resep siapa pun">
        <p>
          Yang dibaca hanya daftar barang beserta harga dan stok gudang — tidak ada kolom yang
          menghubungkan sebuah obat dengan seorang pasien, dan pertanyaan dari sebuah nomor tidak
          pernah dipakai untuk mencari pasien.
        </p>
        <p>
          Yang tetap keputusan apotek: apakah <Tekan>persediaan dan daftar harga</Tekan> boleh dijawab
          otomatis, dan kepada siapa.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanDarurat() {
  return (
    <>
      <HelpSection title="Dipicu WAKTU — bukan oleh kejadian apa pun di Khanza">
        <p>
          Pada jam yang dijadwalkan, sistem membaca barang yang stoknya sudah menyentuh atau turun di
          bawah <Tabel>stokminimal</Tabel> di Khanza, lalu mengirimkan daftarnya. Sakelarnya sendiri,{' '}
          <Tekan>tidak</Tekan> terpengaruh sakelar di tab Notifikasi resep.
        </p>
      </HelpSection>
      <HelpSection title="Barang tanpa ambang minimal tidak ikut dihitung">
        <p>
          Khanza membandingkan stok dengan <Tabel>stokminimal</Tabel> apa adanya, sehingga barang yang
          ambangnya belum pernah disetel (stok 0, minimum 0) ikut terhitung darurat — di database ini
          141 dari 348. Itu bukan keadaan darurat melainkan entri katalog yang belum pernah distok, dan
          daftar yang dipenuhi kebisingan berhenti dibaca dalam seminggu.
        </p>
        <p>Yang dilaporkan hanya barang yang ambangnya memang disetel apotek.</p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanPengadaan() {
  return (
    <>
      <HelpSection title="Berbunyi saat pembelian disimpan di Khanza">
        <p>
          Setiap pembelian yang disimpan lewat menu{' '}
          <Tekan>Transaksi Pengadaan Obat, Alkes &amp; BHP Medis</Tekan> dikirim sebagai nota berisi
          pemasok, daftar barang, dan totalnya. Sakelarnya berdiri sendiri: <Tekan>tidak</Tekan>{' '}
          terpengaruh sakelar di tab Notifikasi resep.
        </p>
      </HelpSection>
      <HelpSection title="Nota pembelian tidak menyebut satu pun pasien">
        <p>
          Yang dibaca hanya <Tabel>pembelian</Tabel> dan <Tabel>detailbeli</Tabel> beserta master
          pemasok, barang, dan petugas — tidak ada satu kolom pun yang menautkan sebuah pembelian
          dengan seorang pasien, dan variabel pasien memang tidak tersedia untuk ditambahkan ke isi
          pesan.
        </p>
        <p>
          Yang tetap perlu dipertimbangkan adalah <Tekan>harga beli dari pemasok</Tekan>, yang punya
          nilai dagang tersendiri — lihat sakelarnya di halaman.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanHibah() {
  return (
    <>
      <HelpSection title="Berbunyi saat penerimaan hibah disimpan di Khanza">
        <p>
          Setiap penerimaan yang disimpan lewat menu <Tekan>Hibah Obat &amp; BHP</Tekan> dikirim
          sebagai nota berisi asal hibah, daftar barang, dan nilainya. Sakelarnya berdiri sendiri:{' '}
          <Tekan>tidak</Tekan> terpengaruh sakelar di tab Notifikasi resep maupun Pengadaan.
        </p>
      </HelpSection>
      <HelpSection title="Nota hibah tidak menyebut satu pun pasien">
        <p>
          Yang dibaca hanya <Tabel>hibah_obat_bhp</Tabel> dan <Tabel>detailhibah_obat_bhp</Tabel>{' '}
          beserta master pemberi, barang, dan petugas — tidak ada satu kolom pun yang menautkan sebuah
          penerimaan hibah dengan seorang pasien, dan variabel pasien memang tidak tersedia untuk
          ditambahkan ke isi pesan.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanPemesanan() {
  return (
    <>
      <HelpSection title="Berbunyi saat pesanan disimpan di Khanza">
        <p>
          Setiap pesanan yang disimpan lewat menu <Tekan>Surat Pemesanan Obat &amp; BHP</Tekan>{' '}
          dikirim sebagai nota berisi pemasok, daftar barang, dan harganya. Sakelarnya berdiri sendiri:{' '}
          <Tekan>tidak</Tekan> terpengaruh sakelar di tab mana pun yang lain.
        </p>
      </HelpSection>
      <HelpSection title="Nota pemesanan tidak menyebut satu pun pasien">
        <p>
          Yang dibaca hanya <Tabel>surat_pemesanan_medis</Tabel> dan{' '}
          <Tabel>detail_surat_pemesanan_medis</Tabel> beserta master pemasok, barang, dan pegawai —
          tidak ada satu kolom pun yang menautkan sebuah pesanan dengan seorang pasien, dan variabel
          pasien memang tidak tersedia untuk ditambahkan ke isi pesan.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanPenjualan() {
  return (
    <>
      <HelpSection title="Berbunyi saat nota penjualan disimpan — DAN saat nota dihapus">
        <p>
          Setiap nota yang disimpan lewat menu{' '}
          <Tekan>Transaksi Penjualan Obat, Alkes &amp; BHP</Tekan> dikirim berisi daftar barang dan
          totalnya. Nota yang <Tekan>dihapus</Tekan> dikabarkan sebagai pembatalan — satu-satunya
          pemicu di sistem ini yang juga memberitakan sesuatu yang lenyap.
        </p>
      </HelpSection>
      <HelpSection title="Bagaimana pembatalan bisa terdeteksi, padahal barisnya sudah tidak ada">
        <p>
          Baris yang dihapus tidak meninggalkan apa pun untuk dibaca, jadi deteksinya menuntut ingatan
          sendiri: tiap nota yang sudah dikabarkan dicatat di buku pantau. Nota yang hilang dari
          jendela pindai <Tekan>sementara masih berada di dalam jendela itu</Tekan> berarti dihapus.
        </p>
        <p>
          Syarat “masih di dalam jendela” itu yang menahan salah tafsir terbesarnya: nota yang menua
          keluar sendiri dari jendela karena waktu berjalan, dan tanpa syarat itu setiap nota lama
          akan dilaporkan terhapus.
        </p>
      </HelpSection>
      <HelpSection title="Rekap harian, dan sakelarnya berdiri sendiri">
        <p>
          Rekap adalah <Tekan>alternatif</Tekan> dari kabar per nota, bukan tambahannya. Karena itu
          sakelarnya terpisah: rumah sakit yang cuma ingin satu pesan sehari tidak perlu menyalakan
          16–46 pesan sehari untuk mendapatkannya.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

function BantuanBulanan() {
  return (
    <>
      <HelpSection title="Satu pesan sebulan, merangkum SELURUH tab lain">
        <p>
          Kedelapan tab di depannya masing-masing mengurus satu jenis kejadian. Yang ini merangkum
          semuanya sekaligus untuk bulan yang baru lewat: resep berikut angka mutunya, plus keempat
          jalur barang — pengadaan, pemesanan, hibah, dan penjualan.
        </p>
        <p>
          Periodenya <Tekan>selalu bulan sebelumnya</Tekan>, tidak bisa disetel. Bulan berjalan selalu
          setengah jadi, dan menyediakan pilihan untuk merekapnya berarti menyediakan cara
          menghasilkan angka yang salah tanpa satu pun galat.
        </p>
      </HelpSection>
      <HelpSection title="Yang cuma terlihat dari rekap bulanan, dan tidak dari rekap harian">
        <p>
          <Tekan>Tren.</Tekan> Rekap harian menampilkan satu angka tanpa pembanding, sehingga kenaikan
          yang pelan tidak pernah terbaca sebagai kenaikan. Terukur di sini: resep yang belum
          diserahkan naik dari 9 (Februari) ke 175 (Juli) — dari 2% menjadi 25,5%. Yang belum ditelaah
          dari 30 ke 145.
        </p>
        <p>
          <Tekan>Pasien versus kunjungan.</Tekan> Keduanya disediakan terpisah karena angkanya jauh
          berbeda: Juli 2026 punya 634 kunjungan dari 541 pasien. Memakai yang satu dengan label yang
          satunya berarti laporan meleset 15% setiap bulan.
        </p>
      </HelpSection>
      <HelpSection title="Telaah resep dibaca dari Khanza, bukan dari sistem ini">
        <p>
          Khanza punya menu telaah resep sendiri, dan isinya sudah dipakai — 10.463 baris tercatat.
          Yang dihitung di sini cuma <Tekan>ada-tidaknya</Tekan> telaah untuk sebuah resep, tidak
          pernah hasil telaahnya: penilaian klinis atas resep seorang pasien tidak pernah dibaca dari
          Khanza sama sekali.
        </p>
      </HelpSection>
      <HelpSection title="Kenapa tombol uji ada di sini, sementara tab lain tidak punya">
        <p>
          Rekap ini berbunyi <Tekan>sekali sebulan</Tekan>. Kalau bentuk pesannya ternyata keliru,
          kesempatan berikutnya datang tiga puluh hari lagi. Pratinjau membuktikan isinya di layar;
          kirim uji membuktikan ia benar-benar tiba, karena kiriman ke kode grup yang salah pun tetap
          tercatat berhasil.
        </p>
      </HelpSection>
      <BerlakuSemua />
    </>
  );
}

const ISI = {
  tujuan: BantuanTujuan,
  resep: BantuanResep,
  stok: BantuanStok,
  darurat: BantuanDarurat,
  pengadaan: BantuanPengadaan,
  pemesanan: BantuanPemesanan,
  hibah: BantuanHibah,
  penjualan: BantuanPenjualan,
  bulanan: BantuanBulanan,
} as const;

export type TabBantuan = keyof typeof ISI;

/**
 * Isinya berganti mengikuti tab yang sedang dibuka, tapi PINTUNYA tetap satu.
 *
 * Tab di halaman ini adalah halaman tersendiri (`?tab=`, bukan state klien),
 * jadi bantuan yang tidak ikut berganti akan menyuruh pembacanya menyaring
 * delapan bagian untuk menemukan satu yang berlaku baginya.
 */
export function BantuanFarmasi({ tab }: { tab: TabBantuan }) {
  const Isi = ISI[tab];
  return <Isi />;
}
