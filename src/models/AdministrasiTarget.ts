import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { JenisTarget } from '@/core/farmasiTarget';

/**
 * Satu tujuan rekap administrasi: grup WhatsApp manajemen/rekam medis atau nomor
 * petugasnya.
 *
 * Tabel TERPISAH dari `farmasi_target`, `bpjs_target`, dan `erm_target` walau
 * bentuk barisnya nyaris identik -- lihat migrations/047. Di sini pemisahannya
 * membawa satu hal yang tidak dipunyai ketiganya: halaman `/administrasi` sampai
 * migrasi itu TIDAK PUNYA daftar tujuan sama sekali, karena kesembilan kelas
 * pemicunya berujung ke nomor seorang PASIEN. Tabel ini memperkenalkan penerima
 * STAF pertama di halaman itu.
 *
 * Validasi dan normalisasi alamatnya tetap dipakai bersama
 * (`core/farmasiTarget.ts`), dan itu disengaja: yang dipakai bersama adalah cara
 * membaca sebuah JID, bukan keputusan tentang siapa yang menerima apa.
 */
export class AdministrasiTarget extends Model<
  InferAttributes<AdministrasiTarget>,
  InferCreationAttributes<AdministrasiTarget>
> {
  declare id: CreationOptional<number>;
  declare jenis: JenisTarget;
  declare chatId: string;
  declare label: string;
  /**
   * Menerima rekap bulanan administrasi.
   *
   * Bawaannya MATI, memperketat dengan sengaja -- pola yang sama dengan
   * `boleh_tanya` (020) dan `terima_bulanan` farmasi (046). Isinya memang
   * seluruhnya angka, tapi angka itu mencakup kelengkapan berkas dan closing
   * billing: bacaan manajemen, bukan bacaan shift, dan sebuah tujuan yang baru
   * ditambahkan tidak boleh langsung menerimanya hanya karena seseorang
   * memasukkannya ke daftar.
   *
   * Dinamai menurut ISINYA, bukan `isActive` saja: rekap administrasi berikutnya
   * akan menambah centangnya sendiri di tabel ini, persis seperti
   * `farmasi_target` tumbuh dari satu jadi tujuh.
   */
  declare terimaBulanan: CreationOptional<boolean>;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AdministrasiTarget.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    jenis: { type: DataTypes.ENUM('grup', 'personal'), allowNull: false },
    chatId: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'chat_id' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    terimaBulanan: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'terima_bulanan',
    },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'administrasi_target', timestamps: false },
);
