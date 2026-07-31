export function PageHeader({ title, description }: { title: string; description?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold">{title}</h1>
      {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}
