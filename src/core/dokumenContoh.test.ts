import { contohIsiDokumen } from './dokumenContoh';
import { renderDokumenHtml } from './dokumenHtml';
import type { KopSurat } from './suratDoc';

const KOP: KopSurat = {
  namaRs: 'RS Contoh',
  alamatRs: 'Jalan RS 1',
  kotaRs: 'Kota Contoh',
  propinsiRs: 'Propinsi Contoh',
  kontakRs: '0800000000',
  emailRs: 'kontak@contoh.test',
  logoDataUri: '',
};

/**
 * Yang dijaga di sini bukan bentuk halamannya (itu tugas `dokumenDoc.test.ts`)
 * melainkan DUA janji yang membuat dokumen karangan boleh ada sama sekali:
 * ia berangkat lewat penyusun yang sungguhan, dan ia mengaku karangan.
 */
describe('contohIsiDokumen', () => {
  const OPSI = { tanggal: '2026-08-18', rincianObat: true };

  it('menghasilkan isi untuk ketiga jenis, termasuk yang tabelnya kosong di Khanza', () => {
    expect(contohIsiDokumen('lab', OPSI).jenis).toBe('lab');
    expect(contohIsiDokumen('radiologi', OPSI).jenis).toBe('radiologi');
    expect(contohIsiDokumen('nota', OPSI).jenis).toBe('nota');
  });

  /**
   * Radiologi adalah satu-satunya alasan modul ini ada: nol baris di Khanza,
   * jadi tanpa contoh karangan sakelarnya harus diputuskan tanpa seorang pun
   * pernah melihat bentuk berkasnya.
   */
  it('membawa narasi bacaan radiologi utuh, berikut baris Kesan-nya', () => {
    const isi = contohIsiDokumen('radiologi', OPSI);
    if (isi.jenis !== 'radiologi') throw new Error('jenis tidak sesuai');
    expect(isi.pemeriksaan).toContain('Foto Thorax PA');
    expect(isi.bacaan).toHaveLength(1);
    expect(isi.bacaan[0]!.teks).toContain('Kesan:');
  });

  it('mengikuti sakelar rincian obat, supaya contohnya bukan bentuk lain', () => {
    const penuh = contohIsiDokumen('nota', { ...OPSI, rincianObat: true });
    const ringkas = contohIsiDokumen('nota', { ...OPSI, rincianObat: false });
    if (penuh.jenis !== 'nota' || ringkas.jenis !== 'nota') throw new Error('jenis tidak sesuai');

    expect(penuh.baris.some((b) => b.label.includes('OBAT CONTOH'))).toBe(true);
    expect(ringkas.baris.some((b) => b.label.includes('OBAT CONTOH'))).toBe(false);
    expect(ringkas.obatDiringkas).toBe(true);

    // Angkanya tetap sama -- pagar yang sama dengan nota sungguhan.
    const total = (x: typeof penuh) => x.baris.find((b) => b.jenis === 'total')!.total;
    expect(total(ringkas)).toBe(total(penuh));
  });

  /**
   * Berkasnya bisa diunduh dan diteruskan seperti berkas sungguhan. Dokumen
   * rumah sakit berisi angka karangan yang tidak menyebut dirinya karangan
   * adalah dokumen palsu, apa pun niat pembuatnya -- jadi pitanya wajib, dan
   * wajib TIDAK muncul pada dokumen biasa.
   */
  it('mencetak pita CONTOH hanya saat opsinya dinyalakan', () => {
    const isi = contohIsiDokumen('radiologi', OPSI);
    const dengan = renderDokumenHtml(isi, KOP, { catatanKaki: '', qrDataUri: '', contoh: true });
    const tanpa = renderDokumenHtml(isi, KOP, { catatanKaki: '', qrDataUri: '' });

    expect(dengan).toContain('CONTOH BENTUK DOKUMEN');
    expect(dengan).toContain('KARANGAN');
    expect(tanpa).not.toContain('CONTOH BENTUK DOKUMEN');
  });

  /** Nilainya harus MENCOLOK palsu, bukan nama yang tampak wajar. */
  it('memakai identitas yang jelas bukan pasien mana pun', () => {
    const isi = contohIsiDokumen('lab', OPSI);
    expect(isi.kepala.namaPasien).toBe('PASIEN CONTOH');
    expect(isi.kepala.noRm).toBe('000000');
    expect(isi.kepala.noRawat).toBe('0000/00/00/000000');
  });
});
