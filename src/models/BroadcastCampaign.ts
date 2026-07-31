import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

/**
 * Jejak akuntabilitas siapa mengirim apa, ke segmen mana, kapan (bukan
 * pengaturan yang dibaca ulang tiap siklus). Hanya di-INSERT, tidak pernah
 * di-UPDATE -- jumlah terkirim/gagal dihitung langsung dari
 * `outbox WHERE campaign_id = id` saat dibaca, supaya tidak ada penghitung
 * tersimpan yang bisa basi.
 */
export class BroadcastCampaign extends Model<InferAttributes<BroadcastCampaign>, InferCreationAttributes<BroadcastCampaign>> {
  declare id: CreationOptional<number>;
  declare createdBy: string;
  declare filterJson: string;
  declare messageBody: string;
  declare recipientCount: number;
  declare createdAt: CreationOptional<Date>;
}

BroadcastCampaign.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    filterJson: { type: DataTypes.TEXT, allowNull: false, field: 'filter_json' },
    messageBody: { type: DataTypes.TEXT, allowNull: false, field: 'message_body' },
    recipientCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'recipient_count' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'broadcast_campaign', timestamps: false },
);
