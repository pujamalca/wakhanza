import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export type StatusEntry = 'baru' | 'diproses' | 'selesai' | 'batal';

/** Satu pasang pertanyaan-jawaban, sebagaimana DIBEKUKAN saat pasien menjawabnya. */
export interface JawabanTersimpan {
  pertanyaan: string;
  jawaban: string;
}

/**
 * Satu formulir yang sudah selesai diisi.
 *
 * `formNama` dan isi `jawabanJson` keduanya DIBEKUKAN: formulir boleh disunting
 * atau dihapus staf sesudah pasien mengisinya, dan jawaban yang ditampilkan di
 * bawah pertanyaan yang tidak pernah diajukan adalah catatan yang terbaca masuk
 * akal sambil salah. Uraiannya di (2) migrations/051_formulir.sql.
 */
export class WaFormEntry extends Model<InferAttributes<WaFormEntry>, InferCreationAttributes<WaFormEntry>> {
  declare id: CreationOptional<number>;
  declare formId: number;
  declare formNama: string;
  declare chatId: string;
  declare pengirimId: string;
  declare phoneE164: string | null;
  /** Hanya terisi bila nomornya menunjuk TEPAT SATU pasien di `patient_contact`. */
  declare noRkmMedis: string | null;
  /** `JawabanTersimpan[]`. Selalu lewat parseJawaban(), jangan JSON.parse langsung. */
  declare jawabanJson: string;
  declare status: CreationOptional<StatusEntry>;
  declare catatan: string | null;
  declare ditanganiOleh: string | null;
  declare ditanganiAt: Date | null;
  declare createdAt: CreationOptional<Date>;
}

WaFormEntry.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    formId: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, field: 'form_id' },
    formNama: { type: DataTypes.STRING(80), allowNull: false, field: 'form_nama' },
    chatId: { type: DataTypes.STRING(64), allowNull: false, field: 'chat_id' },
    pengirimId: { type: DataTypes.STRING(64), allowNull: false, field: 'pengirim_id' },
    phoneE164: { type: DataTypes.STRING(20), allowNull: true, field: 'phone_e164' },
    noRkmMedis: { type: DataTypes.STRING(15), allowNull: true, field: 'no_rkm_medis' },
    jawabanJson: { type: DataTypes.TEXT, allowNull: false, field: 'jawaban_json' },
    status: {
      type: DataTypes.ENUM('baru', 'diproses', 'selesai', 'batal'),
      allowNull: false,
      defaultValue: 'baru',
    },
    catatan: { type: DataTypes.TEXT, allowNull: true },
    ditanganiOleh: { type: DataTypes.STRING(64), allowNull: true, field: 'ditangani_oleh' },
    ditanganiAt: { type: DataTypes.DATE, allowNull: true, field: 'ditangani_at' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'wa_form_entry', timestamps: false },
);

/**
 * JSON rusak mengembalikan larik kosong, bukan melempar -- pola yang sama dengan
 * `parseKeywords()`. Satu baris yang rusak tampil kosong di layar; ia tidak
 * menjatuhkan seluruh halaman daftar masuk.
 */
export function parseJawaban(json: string): JawabanTersimpan[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is JawabanTersimpan =>
        typeof v === 'object' &&
        v !== null &&
        typeof (v as JawabanTersimpan).pertanyaan === 'string' &&
        typeof (v as JawabanTersimpan).jawaban === 'string',
    );
  } catch {
    return [];
  }
}
