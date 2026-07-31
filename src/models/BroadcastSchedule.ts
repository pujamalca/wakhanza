import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { RepeatKind } from '@/core/schedule';

/**
 * Definisi broadcast terjadwal/berulang -- worker (bukan dashboard) yang
 * mengeksekusi saat next_run_at jatuh tempo, lihat worker/broadcastScheduleRunner.ts.
 * filter_json memakai lookback_days RELATIF (bukan dateFrom/dateTo tetap
 * seperti broadcast_campaign.filter_json), lihat khanza/broadcastSchedule.ts.
 */
export class BroadcastSchedule extends Model<InferAttributes<BroadcastSchedule>, InferCreationAttributes<BroadcastSchedule>> {
  declare id: CreationOptional<number>;
  declare name: string;
  declare createdBy: string;
  declare filterJson: string;
  declare messageBody: string;
  declare repeatKind: RepeatKind;
  declare timeOfDay: string;
  declare dayOfWeek: number | null;
  declare dayOfMonth: number | null;
  declare runOnceAt: Date | null;
  declare stopAfterDate: Date | null;
  declare isActive: CreationOptional<boolean>;
  declare nextRunAt: Date | null;
  declare lastRunAt: Date | null;
  declare lastCampaignId: number | null;
  declare createdAt: CreationOptional<Date>;
}

BroadcastSchedule.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(255), allowNull: false },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    filterJson: { type: DataTypes.TEXT, allowNull: false, field: 'filter_json' },
    messageBody: { type: DataTypes.TEXT, allowNull: false, field: 'message_body' },
    repeatKind: { type: DataTypes.ENUM('once', 'daily', 'weekly', 'monthly'), allowNull: false, field: 'repeat_kind' },
    timeOfDay: { type: DataTypes.STRING(5), allowNull: false, field: 'time_of_day' },
    dayOfWeek: { type: DataTypes.TINYINT, allowNull: true, field: 'day_of_week' },
    dayOfMonth: { type: DataTypes.TINYINT, allowNull: true, field: 'day_of_month' },
    runOnceAt: { type: DataTypes.DATE, allowNull: true, field: 'run_once_at' },
    stopAfterDate: { type: DataTypes.DATEONLY, allowNull: true, field: 'stop_after_date' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    nextRunAt: { type: DataTypes.DATE, allowNull: true, field: 'next_run_at' },
    lastRunAt: { type: DataTypes.DATE, allowNull: true, field: 'last_run_at' },
    lastCampaignId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, field: 'last_campaign_id' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'broadcast_schedule', timestamps: false },
);
