import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export class OptOut extends Model<InferAttributes<OptOut>, InferCreationAttributes<OptOut>> {
  declare phoneE164: string;
  declare source: 'reply' | 'manual';
  declare note: string | null;
  declare createdAt: CreationOptional<Date>;
}

OptOut.init(
  {
    phoneE164: { type: DataTypes.STRING(20), primaryKey: true, field: 'phone_e164' },
    source: { type: DataTypes.ENUM('reply', 'manual'), allowNull: false },
    note: { type: DataTypes.STRING(200), allowNull: true },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'opt_out', timestamps: false },
);
