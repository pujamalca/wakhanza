import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export class SendLog extends Model<InferAttributes<SendLog>, InferCreationAttributes<SendLog>> {
  declare id: CreationOptional<number>;
  declare outboxId: number;
  declare attempt: number;
  declare outcome: 'sent' | 'error';
  declare detail: string | null;
  declare durationMs: number | null;
  declare createdAt: CreationOptional<Date>;
}

SendLog.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    outboxId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, field: 'outbox_id' },
    attempt: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false },
    outcome: { type: DataTypes.ENUM('sent', 'error'), allowNull: false },
    detail: { type: DataTypes.TEXT, allowNull: true },
    durationMs: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true, field: 'duration_ms' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'send_log', timestamps: false },
);
