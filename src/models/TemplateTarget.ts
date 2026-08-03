import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { JenisTarget } from '@/core/farmasiTarget';

/**
 * Satu tujuan tambahan untuk SEBUAH pemicu pasien: grup WhatsApp atau nomor
 * petugas.
 *
 * Bentuknya sengaja kembar dengan `FarmasiTarget` -- `chat_id` disimpan sudah
 * sebagai JID lengkap untuk kedua jenis, divalidasi lewat `core/farmasiTarget.ts`
 * yang sama, dan dipilih staf dari `wa_group` yang sama. Yang membedakannya
 * cuma satu kolom: `trigger_code`, karena tujuan di sini melekat pada pemicu
 * tertentu alih-alih berlaku untuk seluruh fitur.
 *
 * Digabung jadi satu tabel dengan `farmasi_target` akan memaksa `trigger_code`
 * palsu untuk baris farmasi (tujuannya berlaku untuk KEDUA pemicu farmasi
 * sekaligus, bukan satu) dan membuat keunikannya bertabrakan -- `farmasi_target`
 * unik per tujuan, yang ini unik per (pemicu, tujuan). Lihat migrations/018.
 */
export class TemplateTarget extends Model<InferAttributes<TemplateTarget>, InferCreationAttributes<TemplateTarget>> {
  declare id: CreationOptional<number>;
  declare triggerCode: string;
  declare jenis: JenisTarget;
  declare chatId: string;
  declare label: string;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

TemplateTarget.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    triggerCode: { type: DataTypes.STRING(32), allowNull: false, field: 'trigger_code' },
    jenis: { type: DataTypes.ENUM('grup', 'personal'), allowNull: false },
    chatId: { type: DataTypes.STRING(64), allowNull: false, field: 'chat_id' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'template_target', timestamps: false },
);
