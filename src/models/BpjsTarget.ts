import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { JenisTarget } from '@/core/farmasiTarget';

/**
 * Satu tujuan notifikasi BPJS: grup WhatsApp atau nomor petugas.
 *
 * Tabel TERPISAH dari `farmasi_target` walau bentuk barisnya nyaris identik --
 * lihat migrations/024 untuk alasannya. Validasi dan normalisasi alamatnya
 * memang dipakai bersama (`core/farmasiTarget.ts`), dan itu disengaja: yang
 * dipakai bersama adalah cara membaca sebuah JID, bukan keputusan tentang siapa
 * yang menerima apa.
 */
export class BpjsTarget extends Model<InferAttributes<BpjsTarget>, InferCreationAttributes<BpjsTarget>> {
  declare id: CreationOptional<number>;
  declare jenis: JenisTarget;
  declare chatId: string;
  declare label: string;
  /**
   * Menerima pemberitahuan PEMBATALAN Mobile JKN.
   *
   * Isinya menyebut nama pasien dan poli tujuannya. Bawaannya mati, dan itu
   * yang membuat sebuah tujuan baru tidak mulai menerima data pasien hanya
   * karena seseorang menambahkannya ke daftar.
   */
  declare terimaBatal: CreationOptional<boolean>;
  /**
   * Menerima SALINAN pengingat surat kontrol yang dikirim ke pasien.
   *
   * Terpisah dari `terimaBatal` karena menjawab pertanyaan yang berbeda: grup
   * pendaftaran sangat wajar perlu tahu slot mana yang batal (supaya bisa diisi
   * pasien lain) tanpa ikut menerima salinan tiap pengingat kontrol.
   */
  declare terimaKontrol: CreationOptional<boolean>;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

BpjsTarget.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    jenis: { type: DataTypes.ENUM('grup', 'personal'), allowNull: false },
    chatId: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'chat_id' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    terimaBatal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'terima_batal' },
    terimaKontrol: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'terima_kontrol' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'bpjs_target', timestamps: false },
);
