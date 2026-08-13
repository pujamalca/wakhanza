import { HelpSection } from '@/components/ui';

/**
 * Isi laci bantuan `/template`.
 *
 * Golongan ORIENTASI saja. Yang TETAP di halaman: peringatan tabrakan
 * `KONTROL_ULANG` × `BOOK_REMIND`, dan hanya pada keadaan yang benar-benar
 * merugikan pasien — yaitu saat keduanya aktif. Di luar keadaan itu alasannya
 * ada di sini, supaya bisa dibaca SEBELUM sakelarnya dinyalakan alih-alih
 * sesudah keluhan masuk.
 *
 * Bentuk lamanya menampilkan kotak itu SELALU (dilipat saat tidak bentrok), dan
 * itu berarti setiap pembukaan halaman membayar satu baris judul untuk
 * peringatan yang belum berlaku.
 */

const Tekan = ({ children }: { children: React.ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);

export function BantuanTemplate({ footerKode }: { footerKode: string | null }) {
  return (
    <>
      <HelpSection title="Template pemicu otomatis">
        <p>
          Satu template per pemicu, dan daftarnya bertambah hanya saat ada pemicu baru. Dipakai{' '}
          <Tekan>otomatis oleh worker</Tekan> saat kejadiannya terdeteksi — staf tidak pernah
          memilihnya.
        </p>
        <p>
          Di bawah tiap nama tertulis <Tekan>tabel Khanza yang dibaca</Tekan> dan{' '}
          <Tekan>kapan pesannya berbunyi</Tekan>; keterangan lengkapnya muncul saat tombol Ubah
          ditekan. Sistem ini hanya <Tekan>membaca</Tekan> — tidak pernah menulis apa pun ke database
          Khanza.
        </p>
        <p>
          Tombol <Tekan>Tujuan</Tekan> mengatur ke mana pesannya dikirim. Bawaannya hanya ke nomor
          pasien yang bersangkutan; bisa ditambah (atau diganti) grup WhatsApp / nomor petugas — sama
          seperti notifikasi farmasi.
        </p>
      </HelpSection>

      <HelpSection title="Template broadcast — dipilih MANUAL, kebalikan dari yang di atas">
        <p>
          Gunanya supaya pesan yang sering dipakai tidak diketik ulang; boleh sebanyak yang
          diperlukan. Variabelnya lebih sedikit karena satu broadcast bisa merentang banyak kunjungan,
          sehingga hal seperti nomor antrian atau nama poli tidak punya arti tunggal.
        </p>
      </HelpSection>

      {footerKode && (
        <HelpSection title="Satu baris kode unik ditambahkan otomatis di akhir setiap pesan">
          <p>
            Bentuknya <span className="font-mono text-caption">{footerKode}</span>, berbeda untuk
            setiap pesan — supaya kiriman massal tidak berisi teks yang identik, yang terbaca sebagai
            spam oleh WhatsApp. Tidak perlu ditulis di template. Atur atau matikan di Pengaturan.
          </p>
        </HelpSection>
      )}

      <HelpSection title="Sebelum menyalakan “Pengingat kontrol (non-BPJS)”, periksa “Pengingat H-1”">
        <p>
          Khanza punya setelan <span className="font-mono text-caption">JADIKANBOOKINGSURATKONTROL</span>{' '}
          di berkas konfigurasi kliennya — <Tekan>tidak terlihat dari dashboard ini</Tekan>. Bila
          menyala, setiap surat kontrol yang disimpan juga membuat satu booking untuk pasien dan
          tanggal yang sama, sehingga Pengingat H-1 sudah mengingatkan pasien itu dan Pengingat kontrol
          akan mengirim pesan kedua untuk kunjungan yang sama.
        </p>
        <p>
          Pada surat kontrol terakhir yang dibuat di server ini,{' '}
          <Tekan>tidak ada booking yang ikut terbentuk</Tekan> — jadi sejauh yang terlihat, keduanya
          tidak bertabrakan di sini. Tapi setelan itu dipegang klien Khanza: kalau IT rumah sakit
          mengubahnya, tabrakannya muncul tanpa ada tanda apa pun di sini.
        </p>
        <p>
          Catatan variabel: <span className="font-mono text-caption">{'{nama_poli}'}</span> hanya
          terisi bila setelan Khanza itu menyala — poli tidak disimpan di tabel suratnya. Karena di
          sini tidak terbentuk booking, <Tekan>variabel itu akan tampil kosong</Tekan>.
        </p>
      </HelpSection>
    </>
  );
}
