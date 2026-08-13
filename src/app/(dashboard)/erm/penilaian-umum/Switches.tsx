'use client';

import { useState, useTransition } from 'react';
import { Callout } from '@/components/ui';
import { toggleErmAction, togglePenilaianAction } from './actions';

function Sakelar({
  aktif,
  onUbah,
  label,
}: {
  aktif: boolean;
  onUbah: (v: boolean) => Promise<void>;
  label: string;
}) {
  const [pending, start] = useTransition();
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={aktif}
        disabled={pending}
        onChange={(e) => {
          const v = e.currentTarget.checked;
          start(() => {
            void onUbah(v);
          });
        }}
        className="h-4 w-4 rounded border-border accent-primary"
      />
      <span className="text-label">{label}</span>
    </label>
  );
}

/**
 * Sakelar UTAMA ERM.
 *
 * Peringatannya sengaja TIDAK dilipat -- ia tingkat A (pagar): dibaca SEBELUM
 * tindakan yang tidak bisa ditarik kembali. Pesan WhatsApp yang sudah terkirim
 * ke sebuah grup tidak bisa ditarik, dan yang beredar di sini adalah nama pasien
 * berikut nomor rekam medisnya. Melipatnya menukar halaman yang lebih pendek
 * dengan keputusan yang diambil tanpa keterangan.
 */
export function MasterSwitch({
  aktif,
  penilaianAktif,
  adaTujuan,
}: {
  aktif: boolean;
  penilaianAktif: boolean;
  adaTujuan: boolean;
}) {
  return (
    <div className="space-y-3">
      <Sakelar aktif={aktif} onUbah={toggleErmAction} label="Aktifkan menu ERM" />

      <Callout variant="privasi" title="Rekap ini memuat nama pasien dan nomor rekam medis">
        <p>
          Penerimanya grup WhatsApp atau nomor petugas yang Anda daftarkan sendiri, dan keanggotaan
          sebuah grup diatur di luar sistem ini — siapa pun bisa ditambahkan admin grup kapan saja
          tanpa terlihat di dashboard.
        </p>
        <p className="mt-2">
          Kalau nama pasien tidak boleh beredar di sana, setel <strong>Tingkat rincian</strong> ke
          &quot;Ringkas&quot;: angkanya tetap utuh, daftar namanya tidak ikut.
        </p>
      </Callout>

      {aktif && penilaianAktif && !adaTujuan && (
        <Callout variant="warning" title="Rekap menyala tapi belum ada tujuan yang mencentang">
          <p>
            Rekapnya tidak akan pergi ke mana pun, dan itu tidak menghasilkan pesan galat di mana pun
            — worker hanya mencatat peringatan lalu diam. Tambahkan tujuan di bagian
            <strong> Tujuan pengiriman</strong> lalu centang &quot;Terima rekap&quot;.
          </p>
        </Callout>
      )}
    </div>
  );
}

/** Sakelar submenu, BERTINGKAT di bawah sakelar utama. */
export function PenilaianSwitch({ aktif, ermAktif }: { aktif: boolean; ermAktif: boolean }) {
  const [tampilkan, setTampilkan] = useState(false);
  return (
    <div className="space-y-2">
      <Sakelar aktif={aktif} onUbah={togglePenilaianAction} label="Kirim rekap terjadwal" />
      {!ermAktif && aktif && (
        <p className="text-caption text-muted-foreground">
          Menu ERM sedang mati, jadi rekap ini tidak berjalan walau tercentang.
        </p>
      )}
      <button
        type="button"
        onClick={() => setTampilkan((v) => !v)}
        className="text-caption text-muted-foreground underline underline-offset-2 hover:text-foreground"
      >
        {tampilkan ? 'Sembunyikan' : 'Apa yang dikirim?'}
      </button>
      {tampilkan && (
        <p className="measure text-prose text-muted-foreground">
          Pada tiap jam yang Anda setel, worker membaca seluruh pasien baru hari itu lalu mengirim
          satu pesan berisi siapa saja yang asesmen awal keperawatannya belum diisi atau belum
          lengkap. Halaman ini tetap berguna penuh walau rekapnya mati — tabel di bawah menjawab
          pertanyaan yang sama, hanya perlu dibuka sendiri.
        </p>
      )}
    </div>
  );
}
