import bcrypt from 'bcrypt';
import { AppUser } from '../src/models';
import { db } from '../src/db/wakhanza';

const BCRYPT_COST = 12; // TECH_STACK.md: bcrypt native, cost 12 -- lihat ARCHITECTURE §9.3

async function main() {
  const [, , username, name, password] = process.argv;
  if (!username || !name || !password) {
    console.error('Pemakaian: npm run seed:admin -- <username> "<nama>" <password>');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Kata sandi minimal 8 karakter.');
    process.exit(1);
  }

  const existing = await AppUser.findOne({ where: { username } });
  if (existing) {
    console.error(`[gagal] pengguna '${username}' sudah ada.`);
    process.exit(1);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  await AppUser.create({ username, name, passwordHash, role: 'admin', isActive: true });
  console.log(`[ok] admin '${username}' (${name}) dibuat.`);
  await db.close();
}

main().catch((err) => {
  console.error('[seed:admin] gagal:', err.message);
  process.exit(1);
});
