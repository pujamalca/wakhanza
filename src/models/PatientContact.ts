import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export type ContactSource = 'auto' | 'manual';
export type ContactRejectReason = 'empty' | 'too_short' | 'not_mobile' | 'unparseable';

export class PatientContact extends Model<InferAttributes<PatientContact>, InferCreationAttributes<PatientContact>> {
  declare noRkmMedis: string;
  declare rawValue: string | null;
  declare phoneE164: string | null;
  declare source: CreationOptional<ContactSource>;
  declare reason: string | null;
  declare checkedAt: Date;
  declare updatedBy: string | null;
}

PatientContact.init(
  {
    noRkmMedis: { type: DataTypes.STRING(15), primaryKey: true, field: 'no_rkm_medis' },
    rawValue: { type: DataTypes.STRING(40), allowNull: true, field: 'raw_value' },
    phoneE164: { type: DataTypes.STRING(20), allowNull: true, field: 'phone_e164' },
    source: { type: DataTypes.ENUM('auto', 'manual'), allowNull: false, defaultValue: 'auto' },
    reason: { type: DataTypes.STRING(64), allowNull: true },
    checkedAt: { type: DataTypes.DATE, allowNull: false, field: 'checked_at' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
  },
  { sequelize: db, tableName: 'patient_contact', timestamps: false },
);
