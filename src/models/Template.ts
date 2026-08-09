import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { ModeTujuan } from '@/core/tujuanPemicu';

/**
 * Ke mana pesan sebuah pemicu dikirim (migrations/018).
 *
 * `pasien` adalah default dan berarti persis perilaku sebelum tujuan tambahan
 * ada -- satu kejadian, satu pasien, satu nomor dari `sik`. Dua nilai lainnya
 * baru berlaku bila pemicunya punya baris `template_target` yang aktif.
 *
 * Union-nya DIAMBIL dari `core/tujuanPemicu.ts`, bukan dideklarasikan lagi di
 * sini: aturan penyebarannya (siapa dapat apa, kunci idempoten mana yang
 * tertulis) tinggal di sana dan diuji unit, jadi dua deklarasi yang bisa
 * menyimpang adalah persis yang tidak boleh ada. Arah impornya aman -- `core/`
 * tidak pernah mengimpor `models/`.
 */
export type TujuanMode = ModeTujuan;

export class Template extends Model<InferAttributes<Template>, InferCreationAttributes<Template>> {
  declare triggerCode: string;
  declare label: string;
  declare body: string;
  declare isActive: CreationOptional<boolean>;
  declare tujuanMode: CreationOptional<TujuanMode>;
  /**
   * Batas berapa PASIEN yang boleh menerima pemicu ini dalam sehari
   * (migrations/036). **0 = tanpa batas**, dan itu bawaan seluruh baris lama --
   * menafsirkannya sebagai "nol pesan" akan mematikan setiap pemicu yang sedang
   * berjalan. Penafsirannya dipegang `bolehKirimKePasien()` di
   * core/ujiTerbatas.ts, bukan diulang di tiap pembacanya.
   */
  declare batasPasienHarian: CreationOptional<number>;
  declare updatedAt: CreationOptional<Date>;
  declare updatedBy: string | null;
}

Template.init(
  {
    triggerCode: { type: DataTypes.STRING(32), primaryKey: true, field: 'trigger_code' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    body: { type: DataTypes.TEXT, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    tujuanMode: {
      type: DataTypes.ENUM('pasien', 'pasien_dan_tujuan', 'tujuan'),
      allowNull: false,
      defaultValue: 'pasien',
      field: 'tujuan_mode',
    },
    batasPasienHarian: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'batas_pasien_harian',
    },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
  },
  { sequelize: db, tableName: 'template', timestamps: false },
);
