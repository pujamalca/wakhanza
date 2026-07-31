import { Template } from '@/models';
import { auth } from '@/auth';
import { previewUniqueCodeFooter } from '@/worker/pipeline';
import { TemplateForm } from './TemplateForm';
import { PageHeader } from '@/components/ui';

export default async function TemplatePage() {
  const session = await auth();
  const readOnly = session?.user.role !== 'admin';

  const templates = await Template.findAll({ order: [['triggerCode', 'ASC']] });
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
    </div>
  );
}
