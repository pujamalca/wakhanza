import Link from 'next/link';
import { Card } from '@/components/ui';
import type { KataTakTerjawab as Kata } from '@/core/pertanyaanTakTerjawab';

/**
 * Daftar kerja penulisan aturan, disusun dari pesan yang TIDAK terjawab.
 *
 * Terukur saat panel ini dibuat: 207 dari 218 pesan masuk 30 hari terakhir
 * (95%) tidak pernah dibalas apa pun. Angka "Tidak ada aturan yang cocok" di
 * atas sudah menunjukkan MASALAHNYA sejak lama, tapi berhenti di situ -- ia
 * tidak pernah mengatakan aturan APA yang perlu ditulis. Teksnya memang bisa
 * dibaca satu per satu di /pesan-masuk, tapi membaca 207 baris untuk mencari
 * polanya adalah pekerjaan yang tidak akan pernah dilakukan siapa pun.
 *
 * Tiga keadaan yang harus dibedakan, dan menyamakannya adalah cara tercepat
 * membuat panel ini disalahpahami:
 *
 *   teks tidak disimpan  -> tidak bisa dianalisis (bukan "tidak ada masalah")
 *   tidak ada yang lolos -> memang tidak ada pola berulang
 *   ada daftarnya        -> ini yang perlu dikerjakan
 */
export function KataTakTerjawab({
  kata,
  jumlahPesan,
  hari,
  simpanTeks,
}: {
  kata: Kata[];
  jumlahPesan: number;
  hari: number;
  simpanTeks: boolean;
}) {
  return (
    <Card>
      <div className="space-y-3 text-sm">
        <div>
          <h3 className="font-medium">Kata yang sering ditanya tapi belum punya aturan</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Dihitung dari {jumlahPesan} pesan perorangan yang tidak dibalas dalam {hari} hari terakhir. Kata yang sudah
            dipakai aturan mana pun tidak ditampilkan, jadi yang tersisa adalah yang benar-benar belum punya jawaban.
          </p>
        </div>

        {!simpanTeks ? (
          /* Kalimatnya WAJIB menyebut sebabnya. Panel kosong tanpa keterangan
             terbaca sebagai "tidak ada pertanyaan yang terlewat" -- kesimpulan
             yang berlawanan dengan kenyataan, dan justru di halaman yang ada
             untuk menunjukkan sebaliknya. */
          <div className="rounded-md border border-warning/30 bg-warning/5 p-2.5 text-xs">
            <span className="font-medium">Belum bisa dianalisis.</span> Penyimpanan teks pesan masuk sedang mati, jadi
            yang tercatat hanya bahwa ada pesan — bukan isinya. Nyalakan{' '}
            <Link href="/pesan-masuk" className="underline">
              di halaman Pesan masuk
            </Link>{' '}
            bila ingin daftar ini terisi. Perlu diketahui: isinya bisa memuat keluhan medis, dan tabelnya ikut
            tercadangkan.
          </div>
        ) : kata.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {jumlahPesan === 0
              ? 'Tidak ada pesan yang terlewat tanpa jawaban dalam rentang ini.'
              : 'Belum ada kata yang berulang di lebih dari satu pesan — belum ada pola yang layak jadi aturan.'}
          </p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-1.5">
              {kata.map((k) => (
                <li
                  key={k.kata}
                  className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs"
                  title={`Muncul di ${k.jumlahPesan} pesan berbeda yang tidak dibalas`}
                >
                  <span className="font-medium">{k.kata}</span>{' '}
                  <span className="tabular-nums text-muted-foreground">{k.jumlahPesan}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Angkanya berapa <span className="font-medium">pesan berbeda</span> yang memuat kata itu, bukan berapa kali
              kata itu muncul — satu orang yang mengulang kata yang sama tidak terhitung sebagai banyak orang. Buka{' '}
              <Link href="/pesan-masuk" className="underline">
                Pesan masuk
              </Link>{' '}
              untuk membaca kalimat aslinya sebelum menulis aturannya.
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
