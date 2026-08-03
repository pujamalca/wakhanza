import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

/**
 * Daftar grup WhatsApp yang nomor rumah sakit ikut di dalamnya, hasil pembacaan
 * sesi oleh WORKER.
 *
 * Murni CACHE untuk dipilih di layar -- tidak pernah jadi acuan saat mengirim.
 * Yang menentukan tujuan tetap `farmasi_target.chat_id`, yang disalin saat staf
 * memilih. Kalau tabel ini jadi acuan, grup yang keluar dari daftar (nomor RS
 * dikeluarkan, atau sinkronisasi gagal) akan diam-diam menghentikan notifikasi
 * yang sudah dipasang.
 *
 * `nama` di sini juga BUKAN yang ditampilkan di daftar tujuan: label tujuan
 * ditulis staf sendiri, karena nama grup bisa diubah anggotanya kapan saja.
 */
export class WaGroup extends Model<InferAttributes<WaGroup>, InferCreationAttributes<WaGroup>> {
  declare chatId: string;
  declare nama: string;
  declare jumlahPeserta: number | null;
  declare syncedAt: CreationOptional<Date>;
}

WaGroup.init(
  {
    chatId: { type: DataTypes.STRING(64), primaryKey: true, field: 'chat_id' },
    nama: { type: DataTypes.STRING(160), allowNull: false },
    jumlahPeserta: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'jumlah_peserta' },
    syncedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'synced_at' },
  },
  { sequelize: db, tableName: 'wa_group', timestamps: false },
);
