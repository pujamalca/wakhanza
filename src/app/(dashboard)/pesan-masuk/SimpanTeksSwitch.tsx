'use client';

import { useTransition } from 'react';
import { Button, Badge } from '@/components/ui';
import { toggleSimpanTeksAction } from './actions';

/**
 * Sakelar penyimpanan ISI pesan.
 *
 * Ditempatkan di halaman ini dan bukan di /pengaturan supaya keputusannya
 * diambil di depan barang buktinya -- orang yang sedang menatap daftar kalimat
 * pasien adalah orang yang paling tepat memutuskan apakah kalimat itu memang
 * pantas disimpan.
 */
export function SimpanTeksSwitch({ aktif, hariSimpan }: { aktif: boolean; hariSimpan: number }) {
  const [pending, start] = useTransition();

  return (
    <section className="mb-6 rounded-lg border p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-title">Simpan isi pesan</h2>
            <Badge variant={aktif ? 'success' : 'neutral'}>{aktif ? 'Disimpan' : 'Tidak disimpan'}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {aktif ? (
              <>
                Isi pesan pasien tersimpan di database selama{' '}
                <span className="font-medium text-foreground">{hariSimpan} hari</span>, lalu dihapus otomatis. Perlu
                disadari: pesan pasien bisa berisi keluhan medis, tabel ini{' '}
                <span className="font-medium text-foreground">bukan rekam medis</span>, ia ikut tercadangkan, dan
                terbaca siapa pun yang bisa masuk sebagai admin. Matikan bila rumah sakit tidak menghendaki itu — daftar
                di bawah tetap menampilkan siapa yang mengirim, kapan, dan berapa panjang pesannya.
              </>
            ) : (
              <>
                Yang dicatat hanya <span className="font-medium text-foreground">siapa, kapan, dan berapa panjang</span>{' '}
                — isi pesannya tidak disimpan sama sekali. Pesan yang masuk sebelum ini dimatikan tetap ada sampai umurnya
                lewat {hariSimpan} hari.
              </>
            )}
          </p>
        </div>
        <Button
          variant={aktif ? 'secondary' : 'primary'}
          className="w-full shrink-0 justify-center sm:w-auto"
          disabled={pending}
          onClick={() => start(() => void toggleSimpanTeksAction(!aktif))}
        >
          {pending ? 'Menyimpan...' : aktif ? 'Berhenti simpan isi' : 'Simpan isi pesan'}
        </Button>
      </div>
    </section>
  );
}
