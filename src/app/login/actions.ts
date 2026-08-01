'use server';

import { AuthError } from 'next-auth';
import { redirect } from 'next/navigation';
import { signIn } from '@/auth';

export async function loginAction(formData: FormData): Promise<void> {
  try {
    await signIn('credentials', {
      username: formData.get('username'),
      password: formData.get('password'),
      redirectTo: '/ringkasan',
    });
  } catch (err) {
    // signIn() sendiri melempar sinyal redirect internal saat SUKSES -- jangan
    // ditangkap di sini, cuma AuthError (kredensial salah/terkunci) yang perlu.
    if (err instanceof AuthError) {
      redirect('/login?error=1');
    }
    throw err;
  }
}
