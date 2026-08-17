import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { JenisTarget } from '@/core/farmasiTarget';

/**
 * Satu tujuan tambahan untuk SEBUAH formulir: grup WhatsApp atau nomor petugas
 * yang dikabarkan setiap kali jawaban baru masuk (053).
 *
 * Bentuknya sengaja kembar dengan `FarmasiTarget` dan `TemplateTarget` --
 * `chat_id` disimpan sudah sebagai JID lengkap untuk kedua jenis, divalidasi
 * lewat `core/farmasiTarget.ts` yang sama, dan dipilih staf dari `wa_group`
 * yang sama. Tiga tabel dengan tiga bentuk berbeda adalah tiga tempat yang bisa
 * menyimpang.
 *
 * Yang membedakannya dari `TemplateTarget` cuma kuncinya: di sana `trigger_code`,
 * di sini `form_id`. Menumpang tabel itu menuntut trigger_code palsu seperti
 * `FORMULIR:7`, dan nilai itu akan muncul di setiap tempat yang menganggap
 * kolom tersebut kode pemicu sungguhan -- `Template.findByPk()`, penyaring
 * halaman Antrean, dan `triggerLabel()`. Lihat migrations/053.
 */
export class WaFormTarget extends Model<InferAttributes<WaFormTarget>, InferCreationAttributes<WaFormTarget>> {
  declare id: CreationOptional<number>;
  declare formId: number;
  declare jenis: JenisTarget;
  declare chatId: string;
  declare label: string;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WaFormTarget.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    formId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'form_id' },
    jenis: { type: DataTypes.ENUM('grup', 'personal'), allowNull: false },
    chatId: { type: DataTypes.STRING(64), allowNull: false, field: 'chat_id' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'wa_form_target', timestamps: false },
);
