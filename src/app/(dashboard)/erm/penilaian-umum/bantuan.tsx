import { HelpSection } from '@/components/ui';

/**
 * Prosa tingkat B (orientasi): dibaca sekali saat pemasangan, lalu tidak lagi.
 *
 * Dirender di SERVER, jadi seluruh isinya tetap ada di HTML halaman -- bisa
 * dicari Ctrl+F, bisa dibaca pembaca layar -- hanya tidak tergambar sampai
 * diminta. Itu yang membedakannya dari menghapus prosa.
 *
 * Yang TIDAK ada di sini, dan sengaja: peringatan privasi di sakelar utama dan
 * peringatan "belum ada tujuan". Keduanya tingkat A (pagar) -- dibaca sebelum
 * tindakan yang tidak bisa ditarik kembali, jadi tempatnya terbentang di halaman.
 */
export function BantuanPenilaian() {
  return (
    <>
      <HelpSection title="Apa yang dijawab halaman ini">
        <p>
          Pasien yang statusnya <strong>Baru</strong> di Khanza wajib punya asesmen awal keperawatan.
          Halaman ini menunjukkan siapa yang belum punya, dan siapa yang punya tapi isiannya belum
          lengkap.
        </p>
        <p>
          Tabelnya berguna sendiri tanpa mengaktifkan apa pun. Sakelar dan jadwal di bawahnya hanya
          menambahkan satu hal: pesan WhatsApp otomatis pada jam yang Anda setel, supaya tidak perlu
          ada yang ingat membuka halaman ini.
        </p>
      </HelpSection>

      <HelpSection title="Tiga golongan, dan kenapa bukan dua">
        <p>
          <strong>Belum diisi</strong> — tidak ada asesmen sama sekali untuk kunjungan itu. Ini kasus
          yang paling sering.
        </p>
        <p>
          <strong>Terisi sebagian</strong> — asesmennya ada, tapi salah satu kolom yang Anda tandai
          wajib masih kosong.
        </p>
        <p>
          <strong>Lengkap</strong> — asesmennya ada dan seluruh kolom wajib terisi.
        </p>
        <p>
          Golongan kedua ambangnya Anda yang tentukan lewat <strong>Kolom yang harus terisi</strong>.
          Semua kolom asesmen di Khanza bertipe &quot;tidak boleh NULL&quot;, jadi kolom yang tidak
          diisi tersimpan sebagai teks kosong — bukan sebagai ketiadaan. Itu sebabnya &quot;ada
          barisnya&quot; tidak bisa dipakai sebagai satu-satunya ukuran.
        </p>
      </HelpSection>

      <HelpSection title="Kenapa jamnya dua, dan boleh berapa pun">
        <p>
          Jarak dari pendaftaran ke pengisian asesmen di rumah sakit ini rata-rata dua jam, dan
          sebagian diisi jauh lebih lambat. Rekap tunggal di sore hari akan menyebut pasien
          &quot;belum diisi&quot; pada saat perawatnya memang belum sempat.
        </p>
        <p>
          Bawaannya dua jam dengan peran berbeda: <strong>13:00</strong> sebagai pengingat di tengah
          hari, <strong>19:30</strong> sebagai hitungan akhir setelah pengisian praktis berhenti.
          Anda bisa menambah atau menguranginya — tulis berapa pun, pisahkan dengan koma.
        </p>
        <p>
          Kalau worker sempat mati melewati beberapa jam sekaligus, hanya jam TERAKHIR yang berbunyi.
          Isi rekap dihitung saat dikirim, jadi mengejar jam yang terlewat hanya menghasilkan dua
          pesan yang isinya nyaris sama.
        </p>
      </HelpSection>

      <HelpSection title="Yang tidak pernah dibaca sistem ini">
        <p>
          Isi asesmennya sendiri — keluhan utama, riwayat penyakit, alergi, skala nyeri, kondisi
          psikologis, keadaan ekonomi — <strong>tidak pernah diambil dari Khanza sama sekali</strong>.
          Yang dibaca hanya apakah kolomnya kosong atau tidak, bukan isinya.
        </p>
        <p>
          Jadi rekap ini tahu tekanan darah seorang pasien sudah dicatat, tanpa pernah tahu berapa
          angkanya. Itu bukan pengaturan yang bisa dinyalakan; kolomnya memang tidak ada dalam query.
        </p>
      </HelpSection>

      <HelpSection title="Kalau poli lain mulai dipakai">
        <p>
          Khanza punya asesmen awal terpisah untuk gigi, mata, kebidanan, dan IGD. Halaman ini
          membaca yang <strong>umum / rawat jalan</strong> saja.
        </p>
        <p>
          Selama hanya Poliklinik Umum yang menerima pasien baru, mengosongkan{' '}
          <strong>Batasi ke kode poli</strong> sudah benar. Begitu poli lain mulai dipakai, isi kode
          polinya — kalau tidak, pasien poli gigi akan dilaporkan belum mengisi asesmen umum padahal
          yang wajib untuknya asesmen gigi, dan itu tidak memunculkan pesan galat apa pun.
        </p>
      </HelpSection>
    </>
  );
}
