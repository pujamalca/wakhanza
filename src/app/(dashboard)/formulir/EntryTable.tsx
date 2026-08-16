'use client';

import { useState, useTransition } from 'react';
import {
  Button,
  Badge,
  Modal,
  Select,
  Textarea,
  EmptyState,
  IconInbox,
  tableWrapperClass,
  theadClass,
  rowClass,
  cellClass,
} from '@/components/ui';
import type { StatusEntry } from '@/models';
import { updateEntryAction } from './actions';

export interface EntryRow {
  id: number;
  formNama: string;
  phoneE164: string | null;
  noRkmMedis: string | null;
  dariGrup: boolean;
  jawaban: Array<{ pertanyaan: string; jawaban: string }>;
  status: StatusEntry;
  catatan: string | null;
  ditanganiOleh: string | null;
  createdAt: string;
}

/**
 * `baru` sengaja `warning`, bukan `info`: ia satu-satunya status yang berarti
 * BELUM ADA YANG MENYENTUH permintaan seseorang, dan warna netral membuatnya
 * terbaca sederajat dengan yang sudah ditangani.
 */
const WARNA: Record<StatusEntry, 'warning' | 'info' | 'success' | 'neutral'> = {
  baru: 'warning',
  diproses: 'info',
  selesai: 'success',
  batal: 'neutral',
};

const LABEL: Record<StatusEntry, string> = {
  baru: 'Baru',
  diproses: 'Diproses',
  selesai: 'Selesai',
  batal: 'Batal',
};

export function EntryTable({ entries }: { entries: EntryRow[] }) {
  const [dibuka, setDibuka] = useState<EntryRow | null>(null);

  if (entries.length === 0) {
    return (
      <EmptyState icon={<IconInbox className="h-6 w-6" />} title="Belum ada jawaban masuk">
        Jawaban muncul di sini begitu ada pasien yang menyelesaikan sebuah formulir. Yang dibatalkan di tengah tidak
        pernah tersimpan.
      </EmptyState>
    );
  }

  return (
    <>
      <div className={tableWrapperClass}>
        <table className="w-full text-body">
          <thead className={theadClass}>
            <tr>
              <th className={cellClass}>Masuk</th>
              <th className={cellClass}>Formulir</th>
              <th className={`${cellClass} hidden md:table-cell`}>Pengirim</th>
              <th className={`${cellClass} hidden lg:table-cell`}>Isian pertama</th>
              <th className={cellClass}>Status</th>
              <th className={`${cellClass} w-px whitespace-nowrap`}>Tindakan</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className={rowClass}>
                <td className={`${cellClass} whitespace-nowrap tabular-nums text-muted-foreground`}>{e.createdAt}</td>
                <td className={cellClass}>{e.formNama}</td>
                <td className={`${cellClass} hidden md:table-cell`}>
                  {e.dariGrup ? (
                    <span className="text-muted-foreground">dari grup</span>
                  ) : (
                    <>
                      <span className="tabular-nums">{e.phoneE164 ?? '—'}</span>
                      {/*
                        Ketiadaan no. RM ditulis apa adanya, bukan dikosongkan.
                        Nomor yang dipakai beberapa pasien sengaja TIDAK ditebak
                        salah satunya, dan staf perlu tahu bahwa yang harus
                        ditanyakan adalah siapa orangnya -- bukan mengira
                        penautannya rusak.
                      */}
                      <span className="block text-caption text-muted-foreground">
                        {e.noRkmMedis ? `RM ${e.noRkmMedis}` : 'nomor belum tertaut ke satu pasien'}
                      </span>
                    </>
                  )}
                </td>
                <td className={`${cellClass} hidden lg:table-cell max-w-xs truncate text-muted-foreground`}>
                  {e.jawaban[0]?.jawaban || '—'}
                </td>
                <td className={cellClass}>
                  <Badge variant={WARNA[e.status]}>{LABEL[e.status]}</Badge>
                </td>
                <td className={`${cellClass} whitespace-nowrap`}>
                  <Button variant="ghost" size="xs" onClick={() => setDibuka(e)}>
                    Lihat
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dibuka && <EntryModal entry={dibuka} onClose={() => setDibuka(null)} />}
    </>
  );
}

function EntryModal({ entry, onClose }: { entry: EntryRow; onClose: () => void }) {
  const [status, setStatus] = useState<StatusEntry>(entry.status);
  const [catatan, setCatatan] = useState(entry.catatan ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={entry.formNama}
      description={`Masuk ${entry.createdAt}${entry.noRkmMedis ? ` · RM ${entry.noRkmMedis}` : ''}`}
    >
      <div className="space-y-3">
        <dl className="space-y-2 rounded-md border p-3 text-body">
          {entry.jawaban.map((j, i) => (
            <div key={i}>
              <dt className="text-caption text-muted-foreground">{j.pertanyaan}</dt>
              {/*
                `whitespace-pre-wrap` karena jawabannya diketik pasien dan boleh
                berbaris-baris. Dirender sebagai teks React biasa, tidak pernah
                `dangerouslySetInnerHTML` -- isinya masukan dari luar.
              */}
              <dd className="whitespace-pre-wrap">{j.jawaban || <span className="text-muted-foreground">—</span>}</dd>
            </div>
          ))}
        </dl>

        {!entry.dariGrup && entry.phoneE164 && (
          <p className="text-caption text-muted-foreground">
            Pengirim: <span className="tabular-nums">{entry.phoneE164}</span>
            {!entry.noRkmMedis && ' — nomor ini belum bisa ditautkan ke satu pasien tertentu.'}
          </p>
        )}

        <label className="block space-y-1">
          <span className="block text-caption font-medium">Status</span>
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusEntry)}
            fieldSize="sm"
            className="w-full"
          >
            <option value="baru">Baru — belum disentuh</option>
            <option value="diproses">Diproses — sedang dikerjakan</option>
            <option value="selesai">Selesai — sudah ditindaklanjuti</option>
            <option value="batal">Batal — tidak perlu ditindaklanjuti</option>
          </Select>
        </label>

        <label className="block space-y-1">
          <span className="block text-caption font-medium">Catatan penanganan (boleh kosong)</span>
          <Textarea
            value={catatan}
            onChange={(e) => setCatatan(e.target.value)}
            rows={3}
            placeholder="mis. sudah ditelepon, obat disiapkan untuk diambil besok"
            className="w-full"
            fieldSize="sm"
          />
          <span className="block text-caption text-muted-foreground">
            Hanya untuk staf. Tidak pernah dikirim ke pasien.
          </span>
        </label>

        {entry.ditanganiOleh && (
          <p className="text-caption text-muted-foreground">Terakhir ditangani: {entry.ditanganiOleh}</p>
        )}

        {error && <p className="text-caption text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Tutup
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const hasil = await updateEntryAction(entry.id, status, catatan);
                if (hasil.error) setError(hasil.error);
                else onClose();
              })
            }
          >
            {pending ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
