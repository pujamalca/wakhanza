import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { MatchMode } from '@/core/autoReply';

/**
 * Satu aturan balasan otomatis: kata kunci apa yang memicu, dan apa balasannya.
 * Dikelola staf lewat /balasan-otomatis. Lihat migrations/010_auto_reply.sql
 * untuk alasan pemisahannya dari auto_reply_log.
 */
export class AutoReplyRule extends Model<InferAttributes<AutoReplyRule>, InferCreationAttributes<AutoReplyRule>> {
  declare id: CreationOptional<number>;
  declare label: string;
  /** Larik JSON. Selalu lewat parseKeywords/serializeKeywords, jangan JSON.parse langsung. */
  declare keywords: string;
  declare matchMode: CreationOptional<MatchMode>;
  declare body: string;
  declare priority: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

AutoReplyRule.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    label: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    keywords: { type: DataTypes.TEXT, allowNull: false },
    matchMode: {
      type: DataTypes.ENUM('contains', 'exact'),
      allowNull: false,
      defaultValue: 'contains',
      field: 'match_mode',
    },
    body: { type: DataTypes.TEXT, allowNull: false },
    priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'auto_reply_rule', timestamps: false },
);

/**
 * JSON rusak mengembalikan larik kosong, bukan melempar. Aturan dengan kata
 * kunci kosong tidak pernah cocok (core/autoReply.ts), jadi satu baris yang
 * rusak menonaktifkan DIRINYA SENDIRI -- bukan menjatuhkan penanganan seluruh
 * pesan masuk, yang akan terjadi kalau kesalahannya dibiarkan naik ke atas.
 */
export function parseKeywords(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    return [];
  }
}

export function serializeKeywords(list: readonly string[]): string {
  return JSON.stringify(list);
}
