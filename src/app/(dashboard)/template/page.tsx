import { Template, BroadcastTemplate } from '@/models';
import { auth } from '@/auth';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import { TemplateForm } from './TemplateForm';
import { BroadcastTemplateForm, NewBroadcastTemplateForm } from './BroadcastTemplateForm';
import { PageHeader, EmptyState } from '@/components/ui';

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
        <p className="mb-4 text-xs text-muted-foreground">
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
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((t) => (
          <TemplateForm
            key={t.triggerCode}
            triggerCode={t.triggerCode}
            initialLabel={t.label}
            initialBody={t.body}
            initialActive={t.isActive}
            readOnly={readOnly}
          />
        ))}
      </div>

      <h2 className="mb-1 mt-8 font-medium">Template broadcast</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Berbeda dari yang di atas: ini <span className="font-medium">dipilih manual</span> saat menyusun Broadcast atau Broadcast
        terjadwal, supaya pesan yang sering dipakai tidak diketik ulang. Boleh sebanyak yang diperlukan. Variabelnya lebih
        sedikit karena satu broadcast bisa merentang banyak kunjungan, sehingga hal seperti nomor antrian atau nama poli tidak
        punya arti tunggal.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {broadcastTemplates.map((t) => (
          <BroadcastTemplateForm
            key={t.id}
            id={t.id}
            initialName={t.name}
            initialBody={t.body}
            initialActive={t.isActive}
            readOnly={readOnly}
          />
        ))}
        {!readOnly && <NewBroadcastTemplateForm />}
      </div>
      {readOnly && broadcastTemplates.length === 0 && <EmptyState>Belum ada template broadcast.</EmptyState>}
    </div>
  );
}
