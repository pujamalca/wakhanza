import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { WaSessionStatus } from './WaSession';

/**
 * Satu baris per PERUBAHAN status sesi WhatsApp -- lihat migrations/037.
 *
 * Ditulis SEKALI dan tidak pernah diperbarui (`wakhanza_rw` sengaja tidak
 * diberi `UPDATE` pada tabel ini, sama seperti `inbound_message`/`auto_reply_log`).
 * Jangan menulis ke tabel ini langsung -- lewat `catatTransisiStatus()` di
 * `worker/sessionHistory.ts`, satu-satunya tempat yang tahu status SEBELUMNYA
 * untuk dibandingkan.
 */
export class WaSessionEvent extends Model<InferAttributes<WaSessionEvent>, InferCreationAttributes<WaSessionEvent>> {
  declare id: CreationOptional<number>;
  /** NULL untuk transisi pertama yang pernah tercatat -- tidak ada status sebelumnya untuk dirujuk. */
  declare statusLama: WaSessionStatus | null;
  declare statusBaru: WaSessionStatus;
  declare createdAt: CreationOptional<Date>;
}

const STATUS_ENUM = ['disconnected', 'qr_pending', 'authenticating', 'ready', 'failed'] as const;

WaSessionEvent.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    statusLama: { type: DataTypes.ENUM(...STATUS_ENUM), allowNull: true, field: 'status_lama' },
    statusBaru: { type: DataTypes.ENUM(...STATUS_ENUM), allowNull: false, field: 'status_baru' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'wa_session_event', timestamps: false },
);
