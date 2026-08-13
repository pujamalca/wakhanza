import { Template, BroadcastTemplate, TemplateTarget, WaGroup, WaSession } from '@/models';
import { auth } from '@/auth';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import { bacaHalaman, hitungPaginasi, hrefHalaman, UKURAN_HALAMAN } from '@/core/pagination';
import { TriggerTemplateTable, BroadcastTemplateTable } from './TemplateTable';
import { PageHeader, Pagination, Callout, HelpPanel } from '@/components/ui';
import { BantuanTemplate } from './bantuan';

export default async function TemplatePage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await auth();
  const readOnly = session?.user.role !== 'admin';

  const { page: pageParam } = await searchParams;
  // Hanya tabel template BROADCAST yang dipaginasi. Tabel di atasnya berisi
  // satu baris per PEMICU (PK-nya `trigger_code`), dan bertambah hanya saat ada
  // pemicu BARU -- bukan seiring pemakaian -- jadi kendali halaman di sana tidak
  // akan pernah bisa berpindah ke mana pun. Jumlah barisnya sengaja TIDAK
  // ditulis di sini: klaim "tepat tujuh baris" pernah ada dan terbukti keliru
  // dua kali (025 menambah dua, 032 menambah satu lagi).
  const p = hitungPaginasi(bacaHalaman(pageParam), await BroadcastTemplate.count(), UKURAN_HALAMAN.konfigurasi);

  const [templates, broadcastTemplates, semuaTarget, grup, sesi] = await Promise.all([
    Template.findAll({ order: [['triggerCode', 'ASC']] }),
    BroadcastTemplate.findAll({ order: [['name', 'ASC']], limit: p.limit, offset: p.offset }),
    // Seluruh tujuan dibaca sekali lalu dikelompokkan di memori -- satu query
    // per pemicu untuk tabel yang isinya belasan baris tidak sepadan, dan
    // jumlah query itu akan ikut bertambah tiap ada pemicu baru. SENGAJA
    // tidak dipaginasi: ia mengisi modal Tujuan per pemicu, bukan tabel.
    TemplateTarget.findAll({ order: [['id', 'ASC']] }),
    // Pengisi dropdown pemilih grup, bukan tabel -- alasan yang sama.
    WaGroup.findAll({ order: [['nama', 'ASC']] }),
    WaSession.findByPk(1),
  ]);

  const targetPerPemicu = new Map<string, typeof semuaTarget>();
  for (const t of semuaTarget) {
    const daftar = targetPerPemicu.get(t.triggerCode) ?? [];
    daftar.push(t);
    targetPerPemicu.set(t.triggerCode, daftar);
  }
  // Template yang disunting di sini BUKAN teks akhir yang diterima pasien --
  // satu baris kode unik ditambahkan otomatis di bawahnya (core/uniqueCode.ts).
  // Ditampilkan supaya staf tidak kaget menemukannya di pesan sungguhan.
  const uniqueCodeFooter = await previewUniqueCodeFooter('preview|template');

  return (
    <div>
      <PageHeader
        title="Template pesan"
        description={readOnly ? 'Hanya admin yang bisa menyunting template.' : 'Perubahan berlaku langsung, tanpa perlu restart.'}
        help={
          <HelpPanel>
            <BantuanTemplate footerKode={uniqueCodeFooter || null} />
          </HelpPanel>
        }
      />

      <h2 className="mb-3 text-title">Template pemicu otomatis</h2>

      {/*
        Peringatan tabrakan KONTROL_ULANG x BOOK_REMIND.

        Dulu kotak ini SELALU dirender -- terbentang saat bentrok, dilipat saat
        tidak. Bentuk terlipatnya membayar satu baris judul di setiap pembukaan
        halaman untuk peringatan yang belum berlaku, dan itu persis kebisingan
        yang penataan ulang ini ada untuk menghilangkan.
        Sekarang: muncul HANYA pada keadaan yang benar-benar merugikan pasien.
        Alasannya, untuk dibaca SEBELUM sakelarnya dinyalakan, pindah ke laci
        bantuan -- tetap ada, tidak lagi menghalangi.
      */}
      {(() => {
        const aktif = (kode: string) => templates.some((t) => t.triggerCode === kode && t.isActive);
        if (!aktif('KONTROL_ULANG') || !aktif('BOOK_REMIND')) return null;
        return (
          <Callout
            variant="warning"
            className="mb-3"
            title="Pengingat kontrol (non-BPJS) dan Pengingat H-1 sama-sama aktif — sebagian pasien menerima DUA pesan"
          >
            <p>
              Bila setelan Khanza <span className="font-mono text-caption">JADIKANBOOKINGSURATKONTROL</span>{' '}
              menyala, setiap surat kontrol yang disimpan juga membuat satu booking untuk pasien dan
              tanggal yang sama — sehingga Pengingat H-1 sudah mengingatkan pasien itu dan Pengingat
              kontrol mengirim pesan kedua untuk kunjungan yang sama.
            </p>
            <p className="mt-1">
              Periksa sekali apakah pasien benar-benar menerima dua pesan, lalu matikan salah satunya.
              Keterangan lengkapnya ada di tombol Bantuan.
            </p>
          </Callout>
        );
      })()}
      <TriggerTemplateTable
        readOnly={readOnly}
        waSiap={sesi?.status === 'ready'}
        grup={grup.map((g) => ({ chatId: g.chatId, nama: g.nama, jumlahPeserta: g.jumlahPeserta }))}
        rows={templates.map((t) => ({
          triggerCode: t.triggerCode,
          label: t.label,
          body: t.body,
          isActive: t.isActive,
          tujuanMode: t.tujuanMode,
          batasPasienHarian: t.batasPasienHarian,
          targets: (targetPerPemicu.get(t.triggerCode) ?? []).map((x) => ({
            id: x.id,
            jenis: x.jenis,
            chatId: x.chatId,
            label: x.label,
            isActive: x.isActive,
          })),
        }))}
      />

      <h2 className="mb-3 mt-10 text-title">Template broadcast</h2>
      <BroadcastTemplateTable
        readOnly={readOnly}
        rows={broadcastTemplates.map((t) => ({ id: t.id, name: t.name, body: t.body, isActive: t.isActive }))}
      />
      <Pagination
        page={p.halaman}
        totalPages={p.totalHalaman}
        count={p.jumlah}
        hrefFor={(n) => hrefHalaman('/template', {}, n)}
        unit="template"
      />
    </div>
  );
}
