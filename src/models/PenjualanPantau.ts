import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

/**
 * BUKU INGATAN nota penjualan yang sudah dikabarkan (migrations/040).
 *
 * Satu-satunya alasan tabel ini ada: sebuah baris yang dihapus di Khanza tidak
 * meninggalkan apa pun untuk dibaca, jadi "dihapus" dan "tidak pernah ada"
 * terlihat persis sama bagi poller yang cuma membaca `penjualan`. Membedakannya
 * MENUNTUT ingatan tentang apa yang dulu ada -- tidak ada jalan lain, dan
 * alternatif `riwayat_barang_medis` ditolak lewat tiga pengukuran yang tercatat
 * di migrasinya.
 *
 * Baris ditulis HANYA saat notifikasi "disimpan" benar-benar dibuat. Itu yang
 * membuat penghapusan nota lama -- yang bernomor sebelum lantai aktivasi, atau
 * yang jatuh di luar jendela sejak awal -- tidak pernah dilaporkan: ia tidak
 * pernah masuk ke sini.
 *
 * BUKAN cache dan BUKAN salinan `penjualan`. Ia tidak menyimpan satu pun isi
 * nota -- tidak barangnya, tidak angkanya, dan tentu tidak pembelinya. Yang
 * disimpan cuma "kami pernah mengabarkan nomor ini".
 */
export class PenjualanPantau extends Model<
  InferAttributes<PenjualanPantau>,
  InferCreationAttributes<PenjualanPantau>
> {
  declare notaJual: string;
  /**
   * Naik satu tiap kali nomor yang sama dipakai lagi sesudah penghapusannya
   * dikabarkan. Khanza menomori dari `MAX(RIGHT(nota_jual,3))` per tanggal, jadi
   * menghapus nota terakhir hari itu membuat nomornya dipakai ulang -- dan tanpa
   * penghitung ini penjualan penggantinya memakai kunci idempoten yang sama lalu
   * ditolak `uq_idem` tanpa satu pun galat.
   */
  declare generasi: number;
  declare dikabarkanAt: Date;
  /** Terisi saat penghapusannya sudah dikabarkan. NULL = masih dipantau. */
  declare hapusAt: Date | null;
}

PenjualanPantau.init(
  {
    notaJual: { type: DataTypes.STRING(20), primaryKey: true, field: 'nota_jual' },
    generasi: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    /**
     * Ditulis sendiri lewat `defaultValue: NOW`, bukan dibiarkan diisi
     * `DEFAULT current_timestamp()` milik MariaDB -- itulah yang menjaga
     * tulis/baca tetap sepasang di bawah `timezone: '+00:00'` milik Sequelize.
     * Konsekuensi bacanya: nilai yang terlihat di CLI `mysql` BUKAN jam dinding
     * WIB; pakai `CONVERT_TZ(kolom,'+00:00','+07:00')`.
     */
    dikabarkanAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'dikabarkan_at' },
    hapusAt: { type: DataTypes.DATE, allowNull: true, field: 'hapus_at' },
  },
  { sequelize: db, tableName: 'penjualan_pantau', timestamps: false },
);
