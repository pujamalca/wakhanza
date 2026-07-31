import { Template } from '@/models';
import { auth } from '@/auth';
import { TemplateForm } from './TemplateForm';
import { PageHeader } from '@/components/ui';

export default async function TemplatePage() {
  const session = await auth();
  const readOnly = session?.user.role !== 'admin';

  const templates = await Template.findAll({ order: [['triggerCode', 'ASC']] });

  return (
    <div>
      <PageHeader
        title="Template pesan"
        description={readOnly ? 'Hanya admin yang bisa menyunting template.' : 'Perubahan berlaku langsung, tanpa perlu restart.'}
      />
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
