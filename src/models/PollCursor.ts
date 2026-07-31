import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export class PollCursor extends Model<InferAttributes<PollCursor>, InferCreationAttributes<PollCursor>> {
  declare triggerCode: string;
  declare cursorTs: Date;
  declare lastRunAt: Date | null;
  declare lastError: string | null;
  declare rowsSeen: CreationOptional<number>;
}

PollCursor.init(
  {
    triggerCode: { type: DataTypes.STRING(32), primaryKey: true, field: 'trigger_code' },
    cursorTs: { type: DataTypes.DATE, allowNull: false, field: 'cursor_ts' },
    lastRunAt: { type: DataTypes.DATE, allowNull: true, field: 'last_run_at' },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
    rowsSeen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, field: 'rows_seen' },
  },
  { sequelize: db, tableName: 'poll_cursor', timestamps: false },
);
