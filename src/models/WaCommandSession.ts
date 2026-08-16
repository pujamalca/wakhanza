import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

/**
 * Keadaan satu percakapan wizard yang sedang berjalan -- ingatan pertama yang
 * dipunyai jalur pesan masuk di sistem ini.
 *
 * Kunci logisnya (chat_id, pengirim_id), bukan chat_id saja: di grup, hanya
 * peserta yang MEMULAI wizard yang jawabannya dipakai. Tanpa itu, kalimat siapa
 * pun yang kebetulan mengetik di grup yang sama menjadi nama aturan atau isi
 * balasan, tanpa satu pun galat. Untuk obrolan perorangan `pengirimId` diisi
 * `chatId` itu sendiri sehingga bentuk kuncinya seragam.
 *
 * Lihat migrations/045_perintah_wa.sql untuk ketiga jebakan yang membentuk
 * tabel ini (penyerahan ulang, sesi yang tak pernah habis, dua orang di satu
 * grup).
 *
 * Sejak migrations/051 ia menampung DUA macam percakapan, dibedakan `jenis`.
 * Bukan penghematan: keunikan (chat_id, pengirim_id) memaksakan satu hal yang
 * memang benar -- satu orang hanya bisa berada di satu percakapan. Dengan dua
 * tabel, seseorang bisa punya wizard perintah DAN formulir hidup sekaligus, dan
 * penangan pesan masuk harus memilih salah satunya untuk memiliki pesan
 * berikutnya; pilihan apa pun salah separuh waktu, dan yang kalah menelan
 * jawaban yang dimaksudkan untuk yang menang tanpa satu pun galat.
 *
 * Yang WAJIB menyertainya: tiap penangan MENYARING jenisnya sendiri. Tanpa itu
 * `commandReply.ts` membuang sesi formulir sebagai "langkah tidak dikenal"
 * (`isLangkah()`), dan hanya untuk alamat yang kebetulan juga berwenang -- jadi
 * kerusakannya muncul sesekali dan tidak pernah pada pasien.
 */
export type JenisSesi = 'perintah' | 'formulir';

export class WaCommandSession extends Model<
  InferAttributes<WaCommandSession>,
  InferCreationAttributes<WaCommandSession>
> {
  declare id: CreationOptional<number>;
  declare chatId: string;
  declare pengirimId: string;
  /** Percakapan macam apa yang sedang berjalan di baris ini. */
  declare jenis: CreationOptional<JenisSesi>;
  /** Langkah wizard, mis. `tambah:kata_kunci`. Bentuknya milik core/waCommand.ts. */
  declare langkah: string;
  /** Jawaban yang sudah terkumpul + daftar id aturan yang sedang dibekukan sebagai pilihan. */
  declare dataJson: string;
  /** Pesan terakhir yang sudah memajukan sesi ini -- penjaga penyerahan ulang lapis kedua. */
  declare lastWaId: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

WaCommandSession.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    chatId: { type: DataTypes.STRING(64), allowNull: false, field: 'chat_id' },
    pengirimId: { type: DataTypes.STRING(64), allowNull: false, field: 'pengirim_id' },
    jenis: { type: DataTypes.STRING(16), allowNull: false, defaultValue: 'perintah' },
    langkah: { type: DataTypes.STRING(32), allowNull: false },
    dataJson: { type: DataTypes.TEXT, allowNull: false, field: 'data_json' },
    lastWaId: { type: DataTypes.STRING(128), allowNull: true, field: 'last_wa_id' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'wa_command_session', timestamps: false },
);
