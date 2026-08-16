import { HelpSection } from '@/components/ui';

/**
 * Golongan B (orientasi) menurut aturan empat tingkat di DESIGN_SYSTEM.md:
 * dibaca sekali saat memasang, bukan tiap kali halaman dibuka. Pagar yang harus
 * dibaca SEBELUM sakelarnya ditekan tetap terbentang di halamannya.
 */
export function BantuanFormulir() {
  return (
    <>
      <HelpSection title="Apa yang dikerjakan halaman ini">
        <p>
          Pasien mengetik kata kunci yang Anda tentukan — misalnya{' '}
          <span className="font-mono">/request-obat</span> atau <span className="font-mono">request obat</span>. Nomor
          rumah sakit lalu menuntunnya menjawab pertanyaan demi pertanyaan, dan jawabannya tersimpan sebagai satu baris
          di tab <strong>Masuk</strong> untuk ditindaklanjuti staf.
        </p>
        <p>
          Tidak ada formulir bawaan. Kata kunci, jumlah dan bunyi pertanyaannya, jenis jawabannya, serta kalimat pembuka
          dan penutupnya semuanya Anda yang menentukan — halaman ini tidak mengandaikan formulir itu tentang obat, atau
          tentang apa pun.
        </p>
      </HelpSection>

      <HelpSection title="Bentuk bergaris miring tidak perlu disetel">
        <p>
          Tanda baca diabaikan di kedua sisi saat mencocokkan, jadi kata kunci{' '}
          <span className="font-mono">request obat</span> ikut menjaring <span className="font-mono">/request-obat</span>{' '}
          dan <span className="font-mono">Request Obat!</span>. Memakai garis miring adalah kebiasaan yang boleh Anda
          pilih supaya perintahnya terlihat khas — bukan setelan tersendiri.
        </p>
      </HelpSection>

      <HelpSection title="Bagaimana orang tahu kata kuncinya">
        <p>
          Kata kuncinya Anda sendiri yang menentukan, jadi pasien hanya tahu kalau diberi tahu — lewat papan
          pengumuman, kartu berobat, atau balasan otomatis yang menyebutkannya.
        </p>
        <p>
          Satu tempat sudah menyebutkannya sendiri: alamat yang terdaftar di{' '}
          <strong>perintah lewat WhatsApp</strong> melihat daftar formulir ini berikut kata kuncinya saat mengetik{' '}
          <span className="font-mono">/bantuan</span> ke nomor rumah sakit. Yang disebut hanya formulir yang benar-benar
          akan menjawab dari alamat itu — yang nonaktif, yang belum punya pertanyaan, dan (di dalam grup) yang tidak
          dicentang &ldquo;boleh dari grup&rdquo; sengaja tidak ikut, supaya tidak ada yang disuruh mengetik sesuatu
          yang lalu didiamkan.
        </p>
      </HelpSection>

      <HelpSection title="Kenapa kata kunci bisa ditolak saat disimpan">
        <p>
          Formulir diperiksa <strong>sebelum</strong> balasan otomatis dan sebelum pertanyaan stok. Artinya kata kunci di
          sini selalu menang: kata kunci &ldquo;jadwal&rdquo; akan membuat aturan &ldquo;jadwal dokter&rdquo; berhenti
          menjawab, tanpa satu pun pesan galat.
        </p>
        <p>
          Karena tidak ada setelan apa pun yang bisa membalikkan urutan itu sesudah tersimpan, tabrakan seperti itu
          ditolak di depan — bukan sekadar diperingatkan. Ganti kata kuncinya, atau ubah aturan yang bertabrakan.
        </p>
      </HelpSection>

      <HelpSection title="Yang terjadi kalau pasien berhenti di tengah">
        <p>
          Tidak ada yang tersimpan. Baris di tab Masuk hanya dibuat ketika pertanyaan terakhir terjawab, jadi percakapan
          yang ditinggalkan tidak meninggalkan catatan setengah jadi.
        </p>
        <p>
          Pasien bisa berhenti kapan saja dengan mengetik <span className="font-mono">batal</span>. Kalau ia sekadar
          diam, sesinya kedaluwarsa sendiri menurut <span className="font-mono">formulir.sesi_timeout_menit</span>{' '}
          (bawaan 30 menit) dan pesan berikutnya dilayani seperti biasa — bukan dibaca sebagai jawaban formulir yang
          sudah dilupakannya.
        </p>
      </HelpSection>

      <HelpSection title="Menyunting formulir tidak mengganggu yang sedang mengisi">
        <p>
          Daftar pertanyaan dan kalimat penutup <strong>dibekukan</strong> saat pasien memulai. Menambah, mengubah, atau
          menghapus pertanyaan hanya berlaku untuk pengisian yang dimulai sesudahnya.
        </p>
        <p>
          Hal yang sama berlaku pada jawaban yang sudah masuk: tiap baris menyimpan pertanyaannya sendiri, jadi ia tetap
          terbaca benar sesudah formulirnya diubah — atau bahkan dihapus.
        </p>
      </HelpSection>

      <HelpSection title="Batas yang berlaku">
        <ul className="list-disc space-y-1 pl-4">
          <li>
            <strong>Kuota per nomor per hari</strong> (<span className="font-mono">formulir.maks_per_nomor_per_hari</span>
            , bawaan 3) dihitung dari formulir yang SELESAI, dan diperiksa saat memulai — bukan sesudah pasien mengisi
            semuanya.
          </li>
          <li>
            <strong>Masa simpan</strong> (<span className="font-mono">formulir.simpan_hari</span>, bawaan 90) memangkas
            jawaban lama otomatis. Isinya diketik pasien dan bisa memuat keluhan.
          </li>
          <li>
            <strong>Paling banyak 20 pertanyaan</strong> per formulir, dan jawaban 500 huruf kecuali Anda menaikkannya
            per pertanyaan.
          </li>
        </ul>
      </HelpSection>

      <HelpSection title="Kalau formulirnya tampak tidak menjawab">
        <ul className="list-disc space-y-1 pl-4">
          <li>Sakelar utama di halaman ini masih mati — selama mati tidak satu pun formulir menjawab.</li>
          <li>Formulirnya sendiri masih Nonaktif di tabel.</li>
          <li>Formulir belum punya pertanyaan. Yang seperti ini tidak pernah dicocokkan, dan tidak bisa diaktifkan.</li>
          <li>
            Pesannya dari <strong>grup</strong>, sementara formulirnya tidak dicentang &ldquo;boleh dari grup&rdquo;.
          </li>
          <li>Nomor itu sudah mencapai kuota hariannya.</li>
        </ul>
      </HelpSection>
    </>
  );
}
