import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

/**
 * Siapa yang boleh menjalankan perintah `/…-jawaban-otomatis` lewat WhatsApp.
 *
 * Tabel SENDIRI, bukan kolom di `farmasi_target` maupun pemakaian ulang
 * `boleh_tanya` -- "boleh menanyakan stok" dan "boleh mengubah apa yang
 * dikatakan RS kepada pasien" adalah dua wewenang yang beratnya sama sekali
 * berbeda. Uraian lengkapnya di migrations/045_perintah_wa.sql.
 */
export class WaCommandAdmin extends Model<
  InferAttributes<WaCommandAdmin>,
  InferCreationAttributes<WaCommandAdmin>
> {
  declare id: CreationOptional<number>;
  /** Alamat lengkap: `628xxx@c.us` atau `120363xxx@g.us`. */
  declare chatId: string;
  declare label: string;
  declare isActive: CreationOptional<boolean>;
  declare createdBy: string;
  declare createdAt: CreationOptional<Date>;
}

WaCommandAdmin.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    chatId: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'chat_id' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'wa_command_admin', timestamps: false },
);
