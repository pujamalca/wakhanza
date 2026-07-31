import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export type AppUserRole = 'admin' | 'operator';

export class AppUser extends Model<InferAttributes<AppUser>, InferCreationAttributes<AppUser>> {
  declare id: CreationOptional<number>;
  declare username: string;
  declare name: string;
  declare passwordHash: string;
  declare failedAttempts: CreationOptional<number>;
  declare lockedUntil: Date | null;
  declare role: CreationOptional<AppUserRole>;
  declare isActive: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
}

AppUser.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true },
    name: { type: DataTypes.STRING(80), allowNull: false },
    passwordHash: { type: DataTypes.STRING(255), allowNull: false, field: 'password_hash' },
    failedAttempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0, field: 'failed_attempts' },
    lockedUntil: { type: DataTypes.DATE, allowNull: true, field: 'locked_until' },
    role: { type: DataTypes.ENUM('admin', 'operator'), allowNull: false, defaultValue: 'operator' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'app_user', timestamps: false },
);
