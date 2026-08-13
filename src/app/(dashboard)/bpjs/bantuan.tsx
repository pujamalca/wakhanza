import { HelpSection } from '@/components/ui';

/**
 * Isi laci bantuan `/bpjs`, satu susunan per tab.
 *
 * Golongan ORIENTASI saja — lihat `DESIGN_SYSTEM.md` §5. Yang tetap di halaman
 * dan tetap terbentang: kedua peringatan privasi (data pasien ke grup pada tab
 * Tujuan, dan "ini satu-satunya pesan yang dibaca pasien" pada tab Kontrol).
 * Keduanya harus terbaca sebelum sakelarnya ditekan, bukan sesudah.
 */

const Tabel = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-caption">{children}</span>
);

const Tekan = ({ children }: { children: React.ReactNode }) => (
  <span className="font-medium text-foreground">{children}</span>
);

function BantuanTujuan() {
  return (
    <HelpSection title="Satu daftar tujuan, dipakai kedua fitur">
      <p>
        Dua centang di tiap baris menjawab dua pertanyaan yang berbeda:{' '}
        <Tekan>Terima pembatalan</Tekan> menerima pemberitahuan saat pasien membatalkan lewat Mobile
        JKN, dan <Tekan>Terima salinan kontrol</Tekan> menerima tembusan pengingat yang dikirim ke
        pasien.
      </p>
    </HelpSection>
  );
}

function BantuanBatal() {
  return (
    <>
      <HelpSection title="Penerimanya LOKET, bukan pasien">
        <p>
          Dibaca dari <Tabel>referensi_mobilejkn_bpjs_batal</Tabel> milik SIMRS Khanza — pembatalan
          yang dilakukan pasien <Tekan>sendiri lewat aplikasi Mobile JKN</Tekan>. Pasiennya sudah tahu,
          ia yang menekan tombolnya. Gunanya supaya slot yang kosong bisa ditawarkan lagi.
        </p>
      </HelpSection>
      <HelpSection title="Jam tenang dilewati, dan daftar tolak pasien tidak berlaku">
        <p>
          <Tekan>Jam tenang dilewati.</Tekan> Penerimanya staf, bukan orang yang sedang tidur di rumah
          — dan slot yang batal sering untuk besok pagi. Pembatalan pukul 21.30 yang baru diberitahukan
          pukul 07.00 tiba bersamaan dengan pasiennya sendiri datang.
        </p>
        <p>
          <Tekan>Permintaan “Berhenti Kirim Otomatis” tidak berlaku.</Tekan> Pesan ini tidak dikirim ke
          pasien, jadi tidak ada nomor pasien yang bisa dicocokkan ke daftar tolak — dan koordinasi
          kerja internal bukan sesuatu yang bisa dihentikan pasien.
        </p>
      </HelpSection>
    </>
  );
}

function BantuanKontrol() {
  return (
    <HelpSection title="Dipicu WAKTU — sekali sehari pada jam yang dipilih">
      <p>
        Dibaca dari <Tabel>bridging_surat_kontrol_bpjs</Tabel> — rencana kunjungan berikutnya yang
        sudah dijadwalkan saat pasien pulang, sering berminggu-minggu di muka.
      </p>
    </HelpSection>
  );
}

const ISI = {
  tujuan: BantuanTujuan,
  batal: BantuanBatal,
  kontrol: BantuanKontrol,
} as const;

export type TabBantuanBpjs = keyof typeof ISI;

export function BantuanBpjs({ tab }: { tab: TabBantuanBpjs }) {
  const Isi = ISI[tab];
  return <Isi />;
}
