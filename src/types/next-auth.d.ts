import type { AppUserRole } from '@/models';

declare module 'next-auth' {
  interface User {
    username: string;
    role: AppUserRole;
  }
  interface Session {
    user: {
      id: string;
      name: string;
      username: string;
      role: AppUserRole;
    };
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    username: string;
    role: AppUserRole;
  }
}
