import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export type OutboxStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'failed_permanent'
  | 'skipped_no_contact'
  | 'skipped_opt_out'
  | 'expired';

export class Outbox extends Model<InferAttributes<Outbox>, InferCreationAttributes<Outbox>> {
  declare id: CreationOptional<number>;
  declare idempotencyKey: string;
  declare triggerCode: string;
  declare campaignId: number | null;
  declare noRkmMedis: string | null;
  declare phoneE164: string | null;
  declare body: string;
  /**
   * Lintasan berkas lampiran RELATIF terhadap direktori media (lihat
   * lib/mediaStorage.ts) -- bukan lintasan absolut, supaya memindahkan
   * pemasangan atau direktori datanya tidak membatalkan baris lama.
   */
  declare mediaPath: string | null;
  declare mediaMime: string | null;
  /** Nama asli unggahan, HANYA untuk ditampilkan ke staf dan sebagai nama berkas di WhatsApp. */
  declare mediaName: string | null;
  declare status: CreationOptional<OutboxStatus>;
  declare attempts: CreationOptional<number>;
  declare eventAt: Date;
  declare scheduledAt: Date;
  declare sentAt: Date | null;
  declare lastError: string | null;
  declare createdAt: CreationOptional<Date>;
}

Outbox.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    idempotencyKey: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'idempotency_key' },
    triggerCode: { type: DataTypes.STRING(32), allowNull: false, field: 'trigger_code' },
    campaignId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, field: 'campaign_id' },
    noRkmMedis: { type: DataTypes.STRING(15), allowNull: true, field: 'no_rkm_medis' },
    phoneE164: { type: DataTypes.STRING(20), allowNull: true, field: 'phone_e164' },
    body: { type: DataTypes.TEXT, allowNull: false },
    mediaPath: { type: DataTypes.STRING(255), allowNull: true, field: 'media_path' },
    mediaMime: { type: DataTypes.STRING(100), allowNull: true, field: 'media_mime' },
    mediaName: { type: DataTypes.STRING(255), allowNull: true, field: 'media_name' },
    status: {
      type: DataTypes.ENUM(
        'pending',
        'sending',
        'sent',
        'failed',
        'failed_permanent',
        'skipped_no_contact',
        'skipped_opt_out',
        'expired',
      ),
      allowNull: false,
      defaultValue: 'pending',
    },
    attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    eventAt: { type: DataTypes.DATE, allowNull: false, field: 'event_at' },
    scheduledAt: { type: DataTypes.DATE, allowNull: false, field: 'scheduled_at' },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'outbox', timestamps: false },
);
