import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { InboundMessage, Outbox } from '@/models';
import { gabungPercakapan, type PesanCatatanRingkas, type PesanKeluarRingkas } from '@/core/percakapan';
import { labelAck } from '@/core/waAck';
import {
  PageHeader,
  Callout,
  Badge,
  CopyButton,
  EmptyState,
  LinkButton,
  outboxStatusLabel,
  outboxStatusVariant,
  triggerLabel,
  IconChat,
  IconChevronLeft,
} from '@/components/ui';
import { BalasForm } from './BalasForm';
import { KotakGulung } from './KotakGulung';

/**
 * Satu PERCAKAPAN, dibaca dari dua tabel sekaligus.
 *
 * Halaman `/pesan-masuk` menjawab "apa yang masuk hari ini" -- pertanyaan
 * pengawasan, dan tabel adalah bentuk yang benar untuknya. Yang tidak
 * dijawabnya: "apa yang sudah kita katakan ke orang ini", dan sampai halaman
 * ini ada, satu-satunya jalan menjawabnya adalah SQL langsung ke `outbox` --
 * yang justru dilarang untuk petugas (RUNBOOK §8).
 *
 * Halaman TERSENDIRI, bukan baris yang dibentangkan di tabel: tiap percakapan
 * menuntut kuerinya sendiri ke `outbox`, jadi sebagai baris yang bisa dibuka,
 * kelima puluh baris tabel akan dibaca sekaligus setiap halaman daftar dibuka.
 * Alasan yang sama persis dipakai `/broadcast-terjadwal/[id]`.
 */

const TIPE_LABEL: Record<string, string> = {
  chat: 'Teks',
  image: 'Gambar',
  video: 'Video',
  audio: 'Audio',
  ptt: 'Pesan suara',
  document: 'Dokumen',
  sticker: 'Stiker',
  location: 'Lokasi',
  vcard: 'Kontak',
  revoked: 'Ditarik kembali',
  e2e_notification: 'Notifikasi sistem',
};

/** Cukup untuk menelusuri satu percakapan, cukup sempit untuk tidak membaca ribuan baris. */
const BATAS_BARIS = 100;

function jam(d: Date): string {
  return d.toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function PercakapanPage({ params }: { params: Promise<{ chat: string }> }) {
  const session = await auth();
  // Sama seperti halaman daftarnya: isi pesan pasien bisa memuat keluhan medis.
  if (session?.user.role !== 'admin') redirect('/ringkasan');

  const { chat } = await params;
  const chatId = decodeURIComponent(chat);

  /**
   * DUA kueri atas satu tabel, bukan satu kueri lalu disaring di memori.
   *
   * `LIMIT` yang dipakai bersama akan membuat arah yang ramai melaparkan yang
   * satunya: satu grup dengan seratus balasan petugas menyisakan nol pesan
   * masuk, tanpa satu pun tanda di layar. Halamannya memang menjanjikan
   * "{BATAS_BARIS} terakhir TIAP ARAH", dan dua kueri itulah yang menepatinya.
   */
  const [masuk, keluarManual] = await Promise.all([
    InboundMessage.findAll({
      where: { chatId, arah: 'masuk' },
      order: [['id', 'DESC']],
      limit: BATAS_BARIS,
    }),
    InboundMessage.findAll({
      where: { chatId, arah: 'keluar' },
      order: [['id', 'DESC']],
      limit: BATAS_BARIS,
    }),
  ]);

  // Percakapan yang tidak ada di catatan pesan masuk tidak bisa dibuka, dan itu
  // batas yang disengaja -- halaman ini untuk MEMBALAS, bukan untuk memulai
  // percakapan dengan alamat yang diketik sendiri di URL.
  if (masuk.length === 0) {
    return (
      <div>
        <PageHeader title="Percakapan" description="Percakapan ini tidak ada di catatan pesan masuk." />
        <EmptyState icon={<IconChat className="h-6 w-6" />} title="Tidak ditemukan">
          Pesan masuk disimpan terbatas (bawaan 30 hari), jadi percakapan yang lebih lama dari itu sudah dipangkas.
        </EmptyState>
        <LinkButton href="/pesan-masuk" variant="secondary" className="mt-4">
          <IconChevronLeft className="h-4 w-4" />
          Kembali ke Pesan masuk
        </LinkButton>
      </div>
    );
  }

  const terbaru = masuk[0]!;
  const keGrup = terbaru.jenis === 'grup';
  const nomor = terbaru.phoneE164;

  /**
   * Sisi KELUAR dicocokkan lewat `chat_id` untuk grup dan `phone_e164` untuk
   * perorangan -- dua kolom, karena `enqueueMessage()` memang mengisi salah
   * satunya saja menurut jenis tujuannya (`chat_id` melewati resolvePhone
   * sepenuhnya, lihat pipeline.ts).
   *
   * Tanpa nomor yang terpetakan, sisi keluarnya memang tidak bisa dicari sama
   * sekali; percakapan tetap ditampilkan, hanya sebelah masuknya saja.
   */
  const keluar = keGrup
    ? await Outbox.findAll({ where: { chatId }, order: [['id', 'DESC']], limit: BATAS_BARIS })
    : nomor
      ? await Outbox.findAll({ where: { phoneE164: nomor }, order: [['id', 'DESC']], limit: BATAS_BARIS })
      : [];

  /**
   * Kedua arah dipetakan lewat SATU fungsi. Menyalinnya jadi dua berarti
   * "kenapa gelembung ini kosong" dijawab dua tempat yang bisa berbeda -- dan
   * yang paling gampang terlewat adalah `inbox.simpan_teks`, sakelar privasi
   * yang berlaku sama untuk pertanyaan pasien maupun balasan petugas.
   */
  const ringkas = (m: (typeof masuk)[number]): PesanCatatanRingkas => ({
    id: m.id,
    arah: m.arah,
    waktu: m.createdAt,
    teks: m.teks,
    keterangan: m.teks
      ? null
      : m.tipe === 'chat'
        ? `(isi tidak disimpan — ${m.panjangTeks} karakter)`
        : (TIPE_LABEL[m.tipe] ?? m.tipe),
    namaPengirim: m.namaKontak,
  });

  const barisCatatan: PesanCatatanRingkas[] = [...masuk.map(ringkas), ...keluarManual.map(ringkas)];

  const barisKeluar: PesanKeluarRingkas[] = keluar.map((o) => ({
    id: o.id,
    waktu: o.createdAt,
    teks: o.body,
    status: o.status,
    terkirimAt: o.sentAt,
    ackLevel: o.ackLevel,
    triggerCode: o.triggerCode,
  }));

  const lini = gabungPercakapan(barisCatatan, barisKeluar);
  const judul = terbaru.namaChat ?? terbaru.namaKontak ?? (keGrup ? 'Grup' : 'Perorangan');

  return (
    <div>
      <PageHeader
        title={judul}
        description={
          keGrup
            ? 'Percakapan grup. Balasan dari sini terbaca seluruh anggotanya.'
            : 'Percakapan dengan satu nomor, dua arah — pesan masuk, kiriman sistem, dan balasan yang diketik dari ponsel rumah sakit.'
        }
        actions={
          <LinkButton href="/pesan-masuk" variant="secondary" size="md">
            <IconChevronLeft className="h-4 w-4" />
            Pesan masuk
          </LinkButton>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
        <Badge variant="neutral">{keGrup ? 'Grup' : 'Perorangan'}</Badge>
        <span className="flex items-center gap-1">
          <span className="break-all font-mono">{chatId}</span>
          <CopyButton value={chatId} label={keGrup ? 'ID grup' : 'ID chat'} />
        </span>
        {!keGrup && nomor && (
          <span className="flex items-center gap-1">
            <span className="font-mono">{nomor}</span>
            <CopyButton value={nomor} label="Nomor" />
          </span>
        )}
      </div>

      {keGrup && (
        <Callout variant="warning" className="mb-4" title="Balasan di grup terbaca semua anggotanya">
          <p>
            Nomor rumah sakit tidak pernah membalas otomatis di grup — menjawab pertanyaan satu orang berarti seluruh
            anggota menerima pesannya, dan rentetan balasan itulah pola yang membuat sebuah nomor diblokir WhatsApp.
          </p>
          <p className="mt-2">
            Balasan dari halaman ini adalah kekecualian yang disengaja karena <strong>Anda</strong> yang mengetiknya,
            satu pesan pada satu waktu. Keanggotaan grup diatur di luar sistem ini, jadi periksa dulu siapa saja yang
            ada di sana sebelum menyebut apa pun tentang seorang pasien.
          </p>
        </Callout>
      )}

      {/* Riwayatnya yang bergulir, bukan halamannya. Kotak balasan di bawah
          karena itu tetap terlihat tanpa menggulir melewati seluruh percakapan
          lebih dulu -- dan itu satu-satunya alasan halaman ini ada. */}
      <div className="mb-4">
        <KotakGulung penanda={lini.length}>
          {lini.length > BATAS_BARIS && (
            <p className="pb-1 text-center text-xs text-muted-foreground">
              Menampilkan {BATAS_BARIS} pesan terakhir tiap arah.
            </p>
          )}
          {lini.map((b) => {
            const kirimSendiri = b.arah === 'keluar';
            return (
              <div key={b.kunci} className={`flex ${kirimSendiri ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-lg border px-3 py-2 sm:max-w-[70%] ${
                    kirimSendiri ? 'border-primary/25 bg-primary/5' : 'border-border bg-card'
                  }`}
                >
                  {!kirimSendiri && keGrup && b.namaPengirim && (
                    <p className="mb-0.5 text-xs font-medium text-muted-foreground">{b.namaPengirim}</p>
                  )}
                  {b.teks ? (
                    // `whitespace-pre-wrap` supaya baris baru yang diketik orang
                    // tetap terlihat seperti yang dikirimnya. Dirender sebagai
                    // TEKS biasa, tidak pernah HTML -- isinya datang dari luar.
                    <p className="whitespace-pre-wrap break-words text-sm">{b.teks}</p>
                  ) : (
                    <p className="text-xs italic text-muted-foreground">{b.keterangan}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{jam(b.waktu)}</span>
                    {kirimSendiri && b.triggerCode && <span>{triggerLabel(b.triggerCode)}</span>}
                    {kirimSendiri && b.status && (
                      <Badge variant={outboxStatusVariant(b.status as never)}>
                        {outboxStatusLabel(b.status as never)}
                      </Badge>
                    )}
                    {/* Kabar terkirim TIDAK ditampilkan sebagai "belum sampai"
                        saat kosong: konfirmasi hanya tiba selama sesi yang
                        mengirimnya masih hidup, jadi kolom kosong adalah
                        ketiadaan kabar, bukan kabar buruk (lihat core/waAck.ts). */}
                    {kirimSendiri && b.ackLevel !== null && <span>{labelAck(b.ackLevel, keGrup)}</span>}
                    {/* Kalimatnya sendiri yang menerangkan, bukan `title=`:
                        keterangan yang cuma muncul saat tetikus berhenti di
                        atasnya tidak pernah muncul di layar sentuh, dan tidak
                        terjangkau Ctrl+F. Selisih di bawah semenit sengaja
                        didiamkan -- itu jeda antre biasa, bukan penundaan. */}
                    {kirimSendiri && b.terkirimAt && b.terkirimAt.getTime() - b.waktu.getTime() > 60_000 && (
                      <span>tertunda, baru terkirim {jam(b.terkirimAt)}</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </KotakGulung>
      </div>

      <BalasForm chatId={chatId} keGrup={keGrup} bisaDibalas={keGrup || Boolean(nomor)} />
    </div>
  );
}
