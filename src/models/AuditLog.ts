import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Transaction,
} from 'sequelize';
import { db } from '@/db/wakhanza';

/**
 * append-only ditegakkan di tingkat MariaDB (ARCHITECTURE §9.5) — wakhanza_rw
 * tidak pernah diberi UPDATE/DELETE pada tabel ini di level mana pun. Model ini
 * sengaja tidak dipakai untuk update()/destroy(), hanya create()/findAll().
 */
export class AuditLog extends Model<InferAttributes<AuditLog>, InferCreationAttributes<AuditLog>> {
  declare id: CreationOptional<number>;
  declare actor: string;
  declare action: string;
  declare target: string | null;
  declare detail: string | null;
  declare createdAt: CreationOptional<Date>;
}

AuditLog.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    actor: { type: DataTypes.STRING(64), allowNull: false },
    action: { type: DataTypes.STRING(64), allowNull: false },
    target: { type: DataTypes.STRING(120), allowNull: true },
    detail: { type: DataTypes.TEXT, allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'audit_log', timestamps: false },
);

/**
 * `transaction` dipakai oleh tindakan yang MENGHAPUS barisnya sendiri
 * (`hapusPengguna`): di sana baris audit adalah satu-satunya yang tertinggal,
 * jadi ia harus jadi atau batal bersama penghapusannya, bukan menyusul.
 * Rollback bukan perintah DELETE, jadi ini tidak melanggar append-only.
 */
export async function logAudit(
  actor: string,
  action: string,
  target?: string,
  detail?: string,
  options?: { transaction?: Transaction },
): Promise<void> {
  await AuditLog.create({ actor, action, target: target ?? null, detail: detail ?? null }, options);
}
