import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

/**
 * Satu baris per pesan MASUK yang diproses balasan otomatis -- termasuk yang
 * tidak dibalas. Justru yang tidak dibalas paling berguna: itu bahan untuk
 * menyetel kata kunci.
 *
 * `inbound_preview` biasanya NULL. Lihat migrations/010_auto_reply.sql untuk
 * alasannya (tabel ini bukan rekam medis).
 */
export type AutoReplyOutcome = 'matched' | 'fallback' | 'no_match' | 'rate_limited' | 'duplicate';

export class AutoReplyLog extends Model<InferAttributes<AutoReplyLog>, InferCreationAttributes<AutoReplyLog>> {
  declare id: CreationOptional<number>;
  declare phoneE164: string;
  declare ruleId: number | null;
  declare outcome: AutoReplyOutcome;
  declare inboundPreview: string | null;
  declare createdAt: CreationOptional<Date>;
}

AutoReplyLog.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    phoneE164: { type: DataTypes.STRING(20), allowNull: false, field: 'phone_e164' },
    ruleId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'rule_id' },
    outcome: {
      type: DataTypes.ENUM('matched', 'fallback', 'no_match', 'rate_limited', 'duplicate'),
      allowNull: false,
    },
    inboundPreview: { type: DataTypes.STRING(120), allowNull: true, field: 'inbound_preview' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'auto_reply_log', timestamps: false },
);
