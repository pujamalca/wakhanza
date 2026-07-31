import { loginAction } from './actions';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Card, Input, Button } from '@/components/ui';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center p-8">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <Card className="w-full max-w-sm">
        <form action={loginAction} className="space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">wakhanza</p>
            <h1 className="text-lg font-semibold">Masuk ke dashboard</h1>
            <p className="text-sm text-muted-foreground">Khusus petugas rumah sakit.</p>
          </div>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Nama pengguna atau kata sandi salah, atau akun sedang terkunci.
            </p>
          )}

          <div className="space-y-1">
            <label htmlFor="username" className="text-sm font-medium">
              Nama pengguna
            </label>
            <Input id="username" name="username" type="text" required autoComplete="username" className="w-full" />
          </div>

          <div className="space-y-1">
            <label htmlFor="password" className="text-sm font-medium">
              Kata sandi
            </label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" className="w-full" />
          </div>

          <Button type="submit" variant="primary" size="md" className="w-full">
            Masuk
          </Button>
        </form>
      </Card>
    </main>
  );
}
