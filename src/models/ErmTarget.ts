import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { JenisTarget } from '@/core/farmasiTarget';

/**
 * Satu tujuan rekap ERM: grup WhatsApp keperawatan atau nomor petugasnya.
 *
 * Tabel TERPISAH dari `farmasi_target` dan `bpjs_target` walau bentuk barisnya
 * nyaris identik -- lihat migrations/044. Di sini pemisahannya lebih jelas
 * daripada BPJS: penerimanya PERAWAT, dan tidak ada satu pun dari keenam centang
 * di `farmasi_target` yang artinya berlaku untuk mereka.
 *
 * Validasi dan normalisasi alamatnya tetap dipakai bersama
 * (`core/farmasiTarget.ts`), dan itu disengaja: yang dipakai bersama adalah cara
 * membaca sebuah JID, bukan keputusan tentang siapa yang menerima apa.
 */
export class ErmTarget extends Model<InferAttributes<ErmTarget>, InferCreationAttributes<ErmTarget>> {
  declare id: CreationOptional<number>;
  declare jenis: JenisTarget;
  declare chatId: string;
  declare label: string;
  /**
   * Menerima rekap kelengkapan asesmen awal keperawatan.
   *
   * Bawaannya MATI. Isinya menyebut nama pasien dan nomor rekam medisnya, jadi
   * sebuah tujuan yang baru ditambahkan tidak boleh langsung menerima data
   * pasien hanya karena seseorang memasukkannya ke daftar.
   *
   * Dinamai menurut ISINYA, bukan `isActive` saja: submenu ERM berikutnya
   * (penilaian gigi, mata, kebidanan) akan menambah centangnya sendiri di tabel
   * ini, persis seperti `farmasi_target` tumbuh dari satu jadi enam.
   */
  declare terimaPenilaianUmum: CreationOptional<boolean>;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ErmTarget.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    jenis: { type: DataTypes.ENUM('grup', 'personal'), allowNull: false },
    chatId: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'chat_id' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    terimaPenilaianUmum: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'terima_penilaian_umum',
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'erm_target', timestamps: false },
);
