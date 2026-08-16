import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { TipeField } from '@/core/waFormulir';

/**
 * Satu pertanyaan di dalam sebuah formulir.
 *
 * `label` adalah pertanyaannya sebagaimana dibaca pasien DAN label yang
 * dibekukan ke dalam jawabannya. Satu tulisan untuk dua guna, sengaja: dua kolom
 * terpisah adalah dua yang bisa menyimpang, dan yang menyimpang menghasilkan
 * catatan yang terbaca masuk akal sambil salah.
 */
export class WaFormField extends Model<InferAttributes<WaFormField>, InferCreationAttributes<WaFormField>> {
  declare id: CreationOptional<number>;
  declare formId: number;
  declare urutan: number;
  declare label: string;
  declare tipe: CreationOptional<TipeField>;
  /** Larik JSON untuk tipe `pilihan`; diabaikan untuk tipe lain. */
  declare pilihanJson: string | null;
  declare wajib: CreationOptional<boolean>;
  /** 0 = pakai batas bawaan `core/waFormulir.ts`. */
  declare maksPanjang: CreationOptional<number>;
}

WaFormField.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    formId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'form_id' },
    urutan: { type: DataTypes.INTEGER, allowNull: false },
    label: { type: DataTypes.STRING(200), allowNull: false },
    tipe: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'teks' },
    pilihanJson: { type: DataTypes.TEXT, allowNull: true, field: 'pilihan_json' },
    wajib: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    maksPanjang: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'maks_panjang' },
  },
  { sequelize: db, tableName: 'wa_form_field', timestamps: false },
);
