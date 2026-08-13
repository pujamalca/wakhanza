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
          Pasien yang meminta <Kode>Berhenti Kirim Otomatis</Kode> <Tekan>tetap dibalas di sini</Tekan>{' '}
          — yang ia hentikan adalah pemberitahuan otomatis (antrian, hasil, obat, tagihan, pengingat
          jadwal), bukan jawaban atas pesan yang ia kirim sendiri.
        </li>
      </ol>
    </HelpSection>
  );
}
