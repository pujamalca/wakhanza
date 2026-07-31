import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export class Template extends Model<InferAttributes<Template>, InferCreationAttributes<Template>> {
  declare triggerCode: string;
  declare label: string;
  declare body: string;
  declare isActive: CreationOptional<boolean>;
  declare updatedAt: CreationOptional<Date>;
  declare updatedBy: string | null;
}

Template.init(
  {
    triggerCode: { type: DataTypes.STRING(32), primaryKey: true, field: 'trigger_code' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
  },
  { sequelize: db, tableName: 'template', timestamps: false },
);
