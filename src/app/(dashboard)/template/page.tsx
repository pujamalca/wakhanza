import { Template, BroadcastTemplate } from '@/models';
import { auth } from '@/auth';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import { TriggerTemplateTable, BroadcastTemplateTable } from './TemplateTable';
import { PageHeader } from '@/components/ui';

export default async function TemplatePage() {
  const session = await auth();
  const readOnly = session?.user.role !== 'admin';

  const [templates, broadcastTemplates] = await Promise.all([
    Template.findAll({ order: [['triggerCode', 'ASC']] }),
    BroadcastTemplate.findAll({ order: [['name', 'ASC']] }),
  ]);
  // Template yang disunting di sini BUKAN teks akhir yang diterima pasien --
  // satu baris kode unik ditambahkan otomatis di bawahnya (core/uniqueCode.ts).
  // Ditampilkan supaya staf tidak kaget menemukannya di pesan sungguhan.
  const uniqueCodeFooter = await previewUniqueCodeFooter('preview|template');

  return (
    <div>
      <PageHeader
        title="Template pesan"
        description={readOnly ? 'Hanya admin yang bisa menyunting template.' : 'Perubahan berlaku langsung, tanpa perlu restart.'}
      />

      {uniqueCodeFooter && (
        <p className="mb-6 text-xs text-muted-foreground">
          Satu baris kode unik ditambahkan otomatis di akhir setiap pesan (mis. <span className="font-mono">{uniqueCodeFooter}</span>
          ), berbeda untuk setiap pesan — supaya kiriman massal tidak berisi teks yang identik, yang terbaca sebagai spam oleh
          WhatsApp. Tidak perlu ditulis di template. Atur atau matikan di Pengaturan.
        </p>
      )}

      <h2 className="mb-1 font-medium">Template pemicu otomatis</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Tujuh template ini dipakai <span className="font-medium">otomatis oleh worker</span> saat kejadiannya terdeteksi di
        Khanza (pasien dapat antrian, hasil lab siap, obat siap, dan seterusnya). Staf tidak pernah memilihnya — jumlahnya tetap
        tujuh, satu per pemicu.
      </p>
      <TriggerTemplateTable
        readOnly={readOnly}
        rows={templates.map((t) => ({
          triggerCode: t.triggerCode,
          label: t.label,
          body: t.body,
          isActive: t.isActive,
        }))}
      />

      <h2 className="mb-1 mt-8 font-medium">Template broadcast</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Berbeda dari yang di atas: ini <span className="font-medium">dipilih manual</span> saat menyusun Broadcast atau Broadcast
        terjadwal, supaya pesan yang sering dipakai tidak diketik ulang. Boleh sebanyak yang diperlukan. Variabelnya lebih
        sedikit karena satu broadcast bisa merentang banyak kunjungan, sehingga hal seperti nomor antrian atau nama poli tidak
        punya arti tunggal.
      </p>
      <BroadcastTemplateTable
        readOnly={readOnly}
        rows={broadcastTemplates.map((t) => ({ id: t.id, name: t.name, body: t.body, isActive: t.isActive }))}
      />
    </div>
  );
}
