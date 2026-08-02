'use client';

import { useEffect, useRef } from 'react';
import { IconX } from './icons';

/**
 * Dibangun di atas elemen `<dialog>` ASLI, bukan div ber-`position:fixed`.
 *
 * `showModal()` memberi gratis empat hal yang kalau ditulis sendiri hampir
 * selalu setengah jadi: fokus keyboard terkurung di dalam dialog, Esc menutup,
 * seluruh halaman di belakangnya jadi inert (tidak bisa di-Tab maupun diklik),
 * dan backdrop tergambar oleh peramban. Petugas pendaftaran memakai keyboard
 * jauh lebih banyak daripada tetikus; dialog yang fokusnya bisa "lolos" ke
 * tabel di belakangnya membuat mereka mengetik ke tempat yang salah tanpa
 * sadar.
 *
 * Konsekuensi yang harus dijaga: `open` adalah state React, tapi peramban bisa
 * menutup dialog sendiri (Esc). Event `cancel` di bawah yang menyinkronkannya
 * balik -- tanpa itu state React tetap mengira dialognya terbuka dan tombol
 * "Ubah" berikutnya tidak membuka apa-apa.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** Untuk form berisi textarea panjang (isi pesan), bukan konfirmasi pendek. */
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    // Dijaga dua arah: showModal() pada dialog yang sudah terbuka melempar
    // InvalidStateError, dan close() pada yang sudah tertutup memicu event
    // `close` yang tidak diinginkan.
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        // Biarkan React yang menutup lewat state, supaya `open` tidak pernah
        // berbeda dari kenyataan di DOM.
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // Klik yang mendarat PERSIS di elemen dialog berarti mengenai backdrop:
        // isinya dibungkus <div> di bawah, jadi klik di dalam form tidak pernah
        // punya target === dialog.
        if (e.target === e.currentTarget) onClose();
      }}
      className={`w-[calc(100vw-2rem)] rounded-lg border bg-card p-0 text-foreground shadow-lg backdrop:bg-black/50 ${
        wide ? 'max-w-2xl' : 'max-w-md'
      }`}
    >
      <div className="max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-4 border-b p-4">
          <div className="min-w-0">
            <h2 className="font-medium">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </dialog>
  );
}

/**
 * Konfirmasi hapus. Menggantikan `window.confirm()` yang dipakai sebelumnya:
 * confirm() memblokir seluruh thread, tampilannya tidak ikut tema gelap, dan
 * di sebagian peramban bisa disenyapkan pengguna -- sehingga tombol Hapus
 * berubah jadi menghapus tanpa bertanya sama sekali.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Hapus',
  pending = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  pending?: boolean;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="space-y-4">
        <div className="text-sm text-muted-foreground">{message}</div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? 'Menghapus...' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
