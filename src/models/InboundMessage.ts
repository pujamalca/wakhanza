import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export type JenisChat = 'perorangan' | 'grup';

/**
 * Arah pesan dalam satu percakapan.
 *
 * `keluar` HANYA untuk pesan yang diketik manusia dari ponsel nomor rumah
 * sakit -- pesan buatan sistem tinggal di `outbox` dan tidak pernah digandakan
 * ke sini. Lihat migrations/052 untuk kenapa keduanya berbagi satu tabel.
 */
export type ArahChat = 'masuk' | 'keluar';

/**
 * Satu baris per pesan MASUK yang diterima nomor rumah sakit.
 *
 * Ditulis SEKALI dan tidak pernah diperbarui -- `wakhanza_rw` sengaja tidak
 * diberi `UPDATE` pada tabel ini, sama seperti `auto_reply_log`. Itulah alasan
 * `dibalas` diisi saat insert (pencatatan terjadi SESUDAH balasan otomatis
 * memutuskan) alih-alih ditambal belakangan.
 *
 * Lihat migrations/017 untuk kenapa `auto_reply_log` tidak bisa dipakai
 * menjawab pertanyaan yang sama.
 */
export class InboundMessage extends Model<InferAttributes<InboundMessage>, InferCreationAttributes<InboundMessage>> {
  declare id: CreationOptional<number>;
  declare waMessageId: string;
  /** Percakapannya. Untuk grup ini GRUPNYA, bukan pengirimnya. */
  declare chatId: string;
  declare jenis: JenisChat;
  /**
   * SETIAP pembacaan yang berarti "pesan masuk" wajib menyaringnya ke `'masuk'`.
   * Bawaannya sengaja `'masuk'` supaya baris lama tidak berubah arti -- tapi itu
   * juga berarti kueri yang LUPA menyaring akan diam-diam menghitung balasan
   * kita sendiri sebagai pertanyaan pasien.
   */
  declare arah: CreationOptional<ArahChat>;
  /** "id user" yang dicari orang di halaman ini. Sama dengan chatId untuk perorangan. */
  declare pengirimId: string | null;
  declare phoneE164: string | null;
  declare namaKontak: string | null;
  declare namaChat: string | null;
  declare tipe: string;
  declare teks: string | null;
  /** Selalu terisi, bahkan saat teksnya tidak disimpan. */
  declare panjangTeks: CreationOptional<number>;
  declare dibalas: CreationOptional<boolean>;
  declare createdAt: CreationOptional<Date>;
}

InboundMessage.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    waMessageId: { type: DataTypes.STRING(160), allowNull: false, unique: true, field: 'wa_message_id' },
    chatId: { type: DataTypes.STRING(64), allowNull: false, field: 'chat_id' },
    jenis: { type: DataTypes.ENUM('perorangan', 'grup'), allowNull: false },
    arah: { type: DataTypes.ENUM('masuk', 'keluar'), allowNull: false, defaultValue: 'masuk' },
    pengirimId: { type: DataTypes.STRING(64), allowNull: true, field: 'pengirim_id' },
    phoneE164: { type: DataTypes.STRING(20), allowNull: true, field: 'phone_e164' },
    namaKontak: { type: DataTypes.STRING(120), allowNull: true, field: 'nama_kontak' },
    namaChat: { type: DataTypes.STRING(160), allowNull: true, field: 'nama_chat' },
    tipe: { type: DataTypes.STRING(24), allowNull: false },
    teks: { type: DataTypes.TEXT, allowNull: true },
    panjangTeks: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0, field: 'panjang_teks' },
    dibalas: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'inbound_message', timestamps: false },
);
