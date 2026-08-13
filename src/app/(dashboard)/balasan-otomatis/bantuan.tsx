import { HelpSection } from '@/components/ui';

/**
 * Isi laci bantuan `/balasan-otomatis`.
 *
 * Yang TETAP di halaman dan tetap terbentang: peringatan "Bukan untuk pertanyaan
 * medis". Itu batas tanggung jawab yang harus terbaca sebelum aturan pertama
 * ditulis — memindahkannya ke balik satu klik menukar halaman yang lebih pendek
 * dengan aturan yang ditulis tanpa mengetahui batasnya.
 */

const Kode = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-caption">{children}</span>
);

const Tekan = ({ children }: { children: React.ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);

export function BantuanBalasanOtomatis() {
  return (
    <>
      <HelpSection title="Cara kerjanya: aturan pertama yang cocok menang, satu pesan satu balasan">
        <ol className="ml-4 list-decimal space-y-2">
          <li>
            Pasien mengirim pesan ke nomor WhatsApp rumah sakit. Permintaan{' '}
            <Kode>Berhenti Kirim Otomatis</Kode> selalu diperiksa lebih dulu dan tidak pernah bisa
            disandera aturan mana pun.
          </li>
          <li>
            Aturan diperiksa berurutan dari <Tekan>urutan terkecil</Tekan>. Yang pertama cocok yang
            dipakai.
          </li>
          <li>
            Balasannya masuk ke antrean kirim yang sama dengan notifikasi lain, jadi ikut tercatat di
            Antrean dan Log. Jam tenang <Tekan>tidak berlaku</Tekan> di sini: pasien sedang menunggu
            jawaban atas pesannya sendiri.
          </li>
          <li>
            Pasien yang meminta <Kode>Berhenti Kirim Otomatis</Kode>{' '}
            <Tekan>tetap dibalas di sini</Tekan> — yang ia hentikan adalah pemberitahuan otomatis
            (antrian, hasil, obat, tagihan, pengingat jadwal), bukan jawaban atas pesan yang ia kirim
            sendiri.
          </li>
        </ol>
      </HelpSection>

      <HelpSection title="Menulis aturan lewat chat WhatsApp, bukan lewat halaman ini">
        <p>
          Alamat yang terdaftar di bagian <Tekan>Perintah lewat WhatsApp</Tekan> bisa menyusun aturan
          langsung dari chat — berguna saat yang paling tahu jawabannya sedang tidak di depan
          komputer. Perintahnya:
        </p>
        <ul className="ml-4 mt-2 list-disc space-y-1">
          <li>
            <Kode>/tambah-jawaban-otomatis</Kode> — dituntun tiga langkah: nama aturan, kata kunci,
            isi balasan.
          </li>
          <li>
            <Kode>/daftar-jawaban-otomatis</Kode> — melihat aturan yang ada berikut status aktifnya.
          </li>
          <li>
            <Kode>/ubah-jawaban-otomatis</Kode> dan <Kode>/hapus-jawaban-otomatis</Kode> — pilih dari
            daftar bernomor.
          </li>
          <li>
            <Kode>/uji-jawaban-otomatis</Kode> — mengetik kalimat contoh, dijawab aturan mana yang
            akan membalas berikut teks jadinya. Tidak mengirim apa pun ke siapa pun.
          </li>
          <li>
            <Kode>/batal</Kode> — berhenti di tengah jalan.
          </li>
          <li>
            <Kode>/bantuan</Kode> (juga <Kode>/help</Kode>) — bukan sekadar daftar perintah:
            menyebut apakah balasan otomatis sedang menyala, berapa aturan yang tersimpan berikut
            kata kunci dan status masing-masing, apakah aturan baru dari chat langsung aktif, dan
            apa lagi yang boleh ditanyakan dari alamat itu. Dua fakta pertama tidak terlihat dari
            mana pun lewat WhatsApp, dan tanpanya aturan yang benar terlihat persis seperti aturan
            yang gagal.
          </li>
        </ul>
        <p className="mt-2">
          Boleh disingkat (<Kode>/tambah</Kode>, <Kode>/daftar</Kode>, …), dan argumennya boleh
          sebaris: <Kode>/uji jadwal dokter</Kode> langsung menjawab tanpa bertanya dulu.
        </p>
        <p className="mt-2">
          Tiga hal yang berbeda dari menyusun lewat halaman ini. Pertama, aturan barunya{' '}
          <Tekan>nonaktif</Tekan> secara bawaan dan baru menjawab pasien setelah dicentang aktif di
          tabel Aturan — kecuali sakelar &quot;langsung aktif&quot; dinyalakan. Kedua,
          pemeriksaannya sama persis (nama tidak boleh kembar, kata kunci minimal dua huruf, variabel
          tak dikenal ditolak), jadi tidak ada yang bisa lolos lewat chat yang ditolak di sini.
          Ketiga, percakapan yang ditinggalkan di tengah kedaluwarsa sendiri, lalu pesan berikutnya
          kembali diperlakukan seperti pesan biasa.
        </p>
        <p className="mt-2">
          Di dalam grup, hanya orang yang <Tekan>memulai</Tekan> percakapan yang jawabannya dipakai —
          pesan peserta lain lewat begitu saja. Tapi setiap anggota grup itu tetap bisa memulai
          percakapannya sendiri, jadi mendaftarkan sebuah grup berarti memberi wewenang kepada semua
          anggotanya.
        </p>
      </HelpSection>
    </>
  );
}
