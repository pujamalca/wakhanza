import { loginAction } from './actions';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Brand } from '@/components/Brand';
import { Card, Input, Button, IconAlertTriangle } from '@/components/ui';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      {/* Sapuan warna merek yang sangat tipis di belakang kartu -- cukup untuk
          membuat halaman masuk tidak terasa seperti formulir kosong, tanpa
          mengurangi kontras kolom isiannya. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60rem_40rem_at_50%_-10%,hsl(var(--primary)/0.12),transparent)]"
      />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>

        <Card>
          <form action={loginAction} className="space-y-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Masuk ke dashboard</h1>
              <p className="mt-0.5 text-sm text-muted-foreground">Khusus petugas rumah sakit.</p>
            </div>

            {error && (
              <p className="flex gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Nama pengguna atau kata sandi salah, atau akun sedang terkunci.</span>
              </p>
            )}

            <div className="space-y-1.5">
              <label htmlFor="username" className="text-sm font-medium">
                Nama pengguna
              </label>
              <Input id="username" name="username" type="text" required autoComplete="username" className="w-full" />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Kata sandi
              </label>
              <Input id="password" name="password" type="password" required autoComplete="current-password" className="w-full" />
            </div>

            <Button type="submit" variant="primary" size="md" className="w-full justify-center">
              Masuk
            </Button>
          </form>
        </Card>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Akun terkunci sementara setelah lima kali gagal berturut-turut.
        </p>
      </div>
    </main>
  );
}
