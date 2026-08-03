import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export type WaSessionStatus = 'disconnected' | 'qr_pending' | 'authenticating' | 'ready' | 'failed';
/**
 * `sync_groups` membaca daftar grup yang diikuti nomor RS lalu menuliskannya ke
 * `wa_group`. Lewat sini dan bukan HTTP karena hanya worker yang memegang sesi
 * WhatsApp -- aturan yang sama seperti QR dan tombol sambung ulang.
 */
export type WaSessionCommand = 'none' | 'reconnect' | 'logout' | 'sync_groups';

export class WaSession extends Model<InferAttributes<WaSession>, InferCreationAttributes<WaSession>> {
  declare id: CreationOptional<number>;
  declare status: CreationOptional<WaSessionStatus>;
  declare qrData: string | null;
  declare qrIssuedAt: Date | null;
  declare phoneNumber: string | null;
  declare heartbeatAt: Date | null;
  declare command: CreationOptional<WaSessionCommand>;
  declare lastError: string | null;
}

WaSession.init(
  {
    id: { type: DataTypes.TINYINT.UNSIGNED, primaryKey: true, defaultValue: 1 },
    status: {
      type: DataTypes.ENUM('disconnected', 'qr_pending', 'authenticating', 'ready', 'failed'),
      allowNull: false,
      defaultValue: 'disconnected',
    },
    qrData: { type: DataTypes.TEXT, allowNull: true, field: 'qr_data' },
    qrIssuedAt: { type: DataTypes.DATE, allowNull: true, field: 'qr_issued_at' },
    phoneNumber: { type: DataTypes.STRING(20), allowNull: true, field: 'phone_number' },
    heartbeatAt: { type: DataTypes.DATE, allowNull: true, field: 'heartbeat_at' },
    command: {
      type: DataTypes.ENUM('none', 'reconnect', 'logout', 'sync_groups'),
      allowNull: false,
      defaultValue: 'none',
    },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
  },
  { sequelize: db, tableName: 'wa_session', timestamps: false },
);
