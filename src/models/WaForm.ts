import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { MatchMode } from '@/core/autoReply';

/**
 * Definisi satu formulir: kata kunci apa yang memulainya, dan kalimat apa yang
 * membuka serta menutupnya. Pertanyaannya sendiri di `wa_form_field`.
 *
 * `keywords` dan `matchMode` sengaja sebentuk persis dengan `auto_reply_rule`
 * supaya `parseKeywords()`/`serializeKeywords()` dan `matchRule()` yang sudah
 * ada dipakai apa adanya -- lihat (3) di migrations/051_formulir.sql.
 */
export class WaForm extends Model<InferAttributes<WaForm>, InferCreationAttributes<WaForm>> {
  declare id: CreationOptional<number>;
  declare nama: string;
  /** Larik JSON. Selalu lewat parseKeywords/serializeKeywords, jangan JSON.parse langsung. */
  declare kataKunci: string;
  declare matchMode: CreationOptional<MatchMode>;
  declare priority: CreationOptional<number>;
  declare pesanPembuka: string;
  declare pesanPenutup: string;
  declare isActive: CreationOptional<boolean>;
  /** Formulir ini boleh diisi dari dalam grup WhatsApp. Bawaan tidak. */
  declare bolehGrup: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WaForm.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    nama: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    kataKunci: { type: DataTypes.TEXT, allowNull: false, field: 'kata_kunci' },
    matchMode: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'contains', field: 'match_mode' },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    pesanPembuka: { type: DataTypes.TEXT, allowNull: false, field: 'pesan_pembuka' },
    pesanPenutup: { type: DataTypes.TEXT, allowNull: false, field: 'pesan_penutup' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'is_active' },
    bolehGrup: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'boleh_grup' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'wa_form', timestamps: false },
);
