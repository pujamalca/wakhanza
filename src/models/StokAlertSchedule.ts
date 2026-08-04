import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { RepeatKindPeriodik } from '@/core/schedule';

/**
 * Satu jadwal peringatan DARURAT STOK -- worker (bukan dashboard) yang
 * mengeksekusi saat `next_run_at` jatuh tempo, lihat
 * worker/stokDaruratRunner.ts.
 *
 * Berbeda dari `broadcast_schedule` yang menyimpan segmen pasien, di sini yang
 * disimpan hanya "barang jenis apa" dan "berapa baris" -- daftarnya sendiri
 * dihitung ULANG dari `sik` tiap kali jalan. Membekukannya tidak masuk akal:
 * yang ditanyakan justru keadaan persediaan SEKARANG.
 *
 * Tujuannya tidak disimpan di sini melainkan di `farmasi_target`
 * (`terima_darurat_stok`). Konsekuensi yang disengaja: semua jadwal mengirim ke
 * himpunan tujuan yang sama. Menaruh tujuan per jadwal akan membuat "grup ini
 * menerima apa saja" harus dijawab dengan membaca tiap baris jadwal satu per
 * satu -- padahal itu justru pertanyaan yang paling sering muncul saat ada yang
 * mengeluh kebanjiran pesan.
 */
export class StokAlertSchedule extends Model<
  InferAttributes<StokAlertSchedule>,
  InferCreationAttributes<StokAlertSchedule>
> {
  declare id: CreationOptional<number>;
  declare nama: string;
  declare repeatKind: RepeatKindPeriodik;
  declare intervalDays: number | null;
  declare timeOfDay: string;
  declare dayOfWeek: number | null;
  declare dayOfMonth: number | null;
  /** `jenis.kdjns` di sik. Null/kosong = seluruh jenis barang. */
  declare kdJenis: string | null;
  declare maxBaris: CreationOptional<number>;
  declare isActive: CreationOptional<boolean>;
  declare nextRunAt: Date | null;
  declare lastRunAt: Date | null;
  declare lastJumlah: number | null;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

StokAlertSchedule.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    nama: { type: DataTypes.STRING(80), allowNull: false },
    repeatKind: {
      type: DataTypes.ENUM('daily', 'every_n_days', 'weekly', 'monthly'),
      allowNull: false,
      field: 'repeat_kind',
    },
    intervalDays: { type: DataTypes.TINYINT.UNSIGNED, allowNull: true, field: 'interval_days' },
    timeOfDay: { type: DataTypes.STRING(5), allowNull: false, field: 'time_of_day' },
    dayOfWeek: { type: DataTypes.TINYINT, allowNull: true, field: 'day_of_week' },
    dayOfMonth: { type: DataTypes.TINYINT, allowNull: true, field: 'day_of_month' },
    kdJenis: { type: DataTypes.STRING(4), allowNull: true, field: 'kd_jenis' },
    maxBaris: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: false, defaultValue: 30, field: 'max_baris' },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    nextRunAt: { type: DataTypes.DATE, allowNull: true, field: 'next_run_at' },
    lastRunAt: { type: DataTypes.DATE, allowNull: true, field: 'last_run_at' },
    lastJumlah: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, field: 'last_jumlah' },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    /**
     * `defaultValue: DataTypes.NOW` alih-alih membiarkan
     * `DEFAULT CURRENT_TIMESTAMP` milik MariaDB mengisinya -- itulah yang
     * menjaga tulis dan baca tetap sepasang di bawah `timezone: '+00:00'`
     * milik Sequelize (lihat catatan UTC di CLAUDE.md).
     */
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'stok_alert_schedule', timestamps: false },
);
