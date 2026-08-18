import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { AKAR, baca, barisDari, berkasTerlacak, buangKomentar, type Pemeriksaan, type Temuan } from './tipe';

/* ------------------------------------------------------------------------- *
 * 1. Primitif UI tidak boleh ditimpa lewat `className`
 * ------------------------------------------------------------------------- */

/**
 * Dua utility Tailwind untuk properti CSS yang SAMA menang berdasarkan urutan
 * Tailwind MENGHASILKAN CSS-nya, bukan urutan kemunculan di string `className`.
 * Jadi `<Button className="rounded-full">` di atas komponen yang sudah membawa
 * `rounded-md` bisa diam-diam KALAH -- tampilannya tidak berubah, tidak ada
 * galat, dan yang menulisnya menyimpulkan Tailwind-nya rusak.
 *
 * Aturannya sudah tertulis di CLAUDE.md dan DESIGN_SYSTEM.md. Yang belum ada
 * sampai berkas ini adalah sesuatu yang MEMERIKSANYA -- dan aturan yang cuma
 * tertulis dilanggar oleh orang yang tidak pernah membacanya.
 */
const PRIMITIF = ['Button', 'LinkButton', 'Input', 'Textarea', 'Select', 'Badge'];

/** Yang mengatur properti yang SUDAH dipegang varian komponennya. */
const UTILITY_TERLARANG =
  /(?:^|\s)(?:p|px|py|pt|pb|pl|pr)-\S+|(?:^|\s)bg-\S+|(?:^|\s)rounded\S*|(?:^|\s)text-(?:xs|sm|base|lg|xl|2xl|3xl)(?:\s|$)|(?:^|\s)font-(?:bold|semibold|medium|normal)(?:\s|$)/;

/** Ambil isi tag dari `<Nama` sampai `>` yang di LUAR tanda kutip. */
function isiTag(kode: string, mulai: number): string {
  let i = mulai;
  let kutip: string | null = null;
  while (i < kode.length) {
    const c = kode[i] as string;
    if (kutip !== null) {
      if (c === kutip) kutip = null;
    } else if (c === '"' || c === "'" || c === '`') {
      kutip = c;
    } else if (c === '>') {
      return kode.slice(mulai, i);
    }
    i += 1;
  }
  return kode.slice(mulai);
}

export const pemeriksaanPrimitif: Pemeriksaan = {
  nama: 'primitif',
  judul: 'Primitif UI tidak ditimpa warna/padding/ukuran lewat className',
  alasan:
    'Timpaan lewat className bisa KALAH tanpa satu pun galat, tergantung urutan Tailwind ' +
    'menghasilkan CSS-nya. Kalau ukuran/warna yang ada tidak cukup, tambah varian baru di ' +
    'komponennya (src/components/ui), jangan ditimpa dari luar. Lebar/margin/flex tetap boleh.',
  jalankan(): Temuan[] {
    const temuan: Temuan[] = [];

    for (const berkas of berkasTerlacak()) {
      if (!berkas.endsWith('.tsx')) continue;
      if (berkas.startsWith('src/components/ui/')) continue; // di dalam rumahnya sendiri, sah

      const kode = buangKomentar(baca(berkas));

      for (const nama of PRIMITIF) {
        const pola = new RegExp(`<${nama}[\\s/>]`, 'g');
        for (const cocok of kode.matchAll(pola)) {
          const tag = isiTag(kode, cocok.index ?? 0);
          const kelas = /className="([^"]*)"/.exec(tag)?.[1];
          if (kelas === undefined) continue;
          const langgar = UTILITY_TERLARANG.exec(kelas)?.[0]?.trim();
          if (langgar === undefined) continue;
          temuan.push({
            berkas,
            baris: barisDari(kode, cocok.index ?? 0),
            pesan: `<${nama} className="... ${langgar} ..."`,
          });
        }
      }
    }

    return temuan;
  },
};

/* ------------------------------------------------------------------------- *
 * 2. Halaman yang menunggu database wajib punya rangka muat + batas galat
 * ------------------------------------------------------------------------- */

const MODUL_DATABASE = /@\/(?:models|khanza|db)\b/;

/**
 * Satu tingkat penelusuran impor lokal (`./queries`, `./actions`) sudah cukup:
 * bentuk yang dipakai di sini adalah `page.tsx` yang memanggil `./queries`.
 * Menelusuri lebih dalam menukar sedikit ketelitian dengan pemeriksa yang
 * lambat dan sulit dijelaskan saat ia salah.
 */
function menyentuhDatabase(berkasPage: string): boolean {
  const kode = buangKomentar(baca(berkasPage));
  if (MODUL_DATABASE.test(kode)) return true;

  const dir = dirname(join(AKAR, berkasPage));
  for (const cocok of kode.matchAll(/from\s+'(\.\.?\/[^']+)'/g)) {
    const acuan = cocok[1] as string;
    for (const akhiran of ['.ts', '.tsx', '/index.ts']) {
      const lintasan = resolve(dir, acuan + akhiran);
      if (!existsSync(lintasan)) continue;
      if (MODUL_DATABASE.test(buangKomentar(readFileSync(lintasan, 'utf8')))) return true;
      break;
    }
  }

  return false;
}

/** Cari `nama` di segmen ini atau mana pun di atasnya, sampai `src/app`. */
function adaDiAtasnya(berkasPage: string, nama: string): boolean {
  let dir = dirname(join(AKAR, berkasPage));
  const batas = join(AKAR, 'src', 'app');

  for (;;) {
    if (existsSync(join(dir, nama))) return true;
    if (dir === batas || dir.length <= batas.length) return false;
    dir = dirname(dir);
  }
}

export const pemeriksaanBatasRute: Pemeriksaan = {
  nama: 'batas-rute',
  judul: 'Halaman yang menunggu database punya rangka muat DAN batas galat',
  alasan:
    'Tanpa loading.tsx, menekan menu tidak mengubah apa pun sampai query pulang -- yang ' +
    'terbaca petugas sebagai "klik saya tidak masuk", lalu ditekan lagi. Tanpa error.tsx, ' +
    'query yang gagal mendarat sebagai layar bawaan Next.js tanpa jalan kembali. Keduanya ' +
    'boleh diletakkan di tingkat grup: satu berkas menutup seluruh rute di bawahnya.',
  jalankan(): Temuan[] {
    const temuan: Temuan[] = [];

    for (const berkas of berkasTerlacak()) {
      if (!/^src\/app\/.*\/page\.tsx$/.test(berkas)) continue;
      if (!/export default async function/.test(baca(berkas))) continue;
      if (!menyentuhDatabase(berkas)) continue;

      const segmen = relative(join(AKAR, 'src', 'app'), dirname(join(AKAR, berkas))).replace(/\\/g, '/');
      for (const perlu of ['loading.tsx', 'error.tsx']) {
        if (adaDiAtasnya(berkas, perlu)) continue;
        temuan.push({
          berkas,
          pesan: `tidak ada ${perlu} di segmen "${segmen}" maupun di atasnya`,
        });
      }
    }

    return temuan;
  },
};
