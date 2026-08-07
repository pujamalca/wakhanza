import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import type { JenisTarget } from '@/core/farmasiTarget';

/**
 * Satu tujuan notifikasi apotek: grup WhatsApp atau nomor petugas.
 *
 * `chat_id` disimpan sudah dalam bentuk JID lengkap untuk KEDUA jenis
 * (`628xxx@c.us` maupun `120363xxx@g.us`), sehingga dispatcher meneruskannya apa
 * adanya tanpa perlu tahu ini grup atau perorangan. Normalisasinya terjadi
 * sekali saat menyimpan (core/farmasiTarget.ts) -- bukan tiap kali mengirim,
 * yang akan membuat nilai tersimpan dan nilai terpakai bisa berbeda.
 */
export class FarmasiTarget extends Model<InferAttributes<FarmasiTarget>, InferCreationAttributes<FarmasiTarget>> {
  declare id: CreationOptional<number>;
  declare jenis: JenisTarget;
  declare chatId: string;
  declare label: string;
  declare isActive: CreationOptional<boolean>;
  /**
   * Boleh MENGAJUKAN pertanyaan stok/harga dari alamat ini (migrations/020).
   *
   * Sengaja terpisah dari `isActive`, karena keduanya menjawab pertanyaan
   * berbeda: `isActive` = ke mana notifikasi resep dikirim, `bolehTanya` =
   * siapa yang boleh bertanya. Sebuah grup sangat wajar cuma menerima
   * pemberitahuan tanpa nomor RS ikut menjawab di dalamnya.
   */
  declare bolehTanya: CreationOptional<boolean>;
  /**
   * Menerima peringatan DARURAT STOK dari alamat ini (migrations/021).
   *
   * Kolom KETIGA, dan sekali lagi terpisah karena menjawab pertanyaan ketiga:
   * `isActive` = ke mana notifikasi resep dikirim, `bolehTanya` = siapa yang
   * boleh bertanya, ini = siapa yang menerima rekap persediaan. Grup shift
   * apotek sangat wajar perlu tahu tiap resep tanpa perlu rekap tiap pagi, dan
   * nomor kepala instalasi sangat wajar justru kebalikannya.
   */
  declare terimaDaruratStok: CreationOptional<boolean>;
  /**
   * Menerima nota PENGADAAN dari alamat ini (migrations/028).
   *
   * Kolom KEEMPAT, dan pemisahannya di sini yang paling tajam dari keempatnya:
   * nota pembelian memuat HARGA BELI dari pemasok, yang punya nilai dagang
   * tersendiri. Grup shift apotek sangat wajar perlu tahu tiap resep masuk tanpa
   * ikut membaca harga yang dibayar RS ke pemasoknya; bagian pengadaan justru
   * kebalikannya.
   */
  declare terimaPengadaan: CreationOptional<boolean>;
  declare createdBy: string;
  declare updatedBy: string | null;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

FarmasiTarget.init(
  {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    jenis: { type: DataTypes.ENUM('grup', 'personal'), allowNull: false },
    chatId: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'chat_id' },
    label: { type: DataTypes.STRING(80), allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' },
    bolehTanya: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false, field: 'boleh_tanya' },
    terimaDaruratStok: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'terima_darurat_stok',
    },
    terimaPengadaan: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'terima_pengadaan',
    },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'farmasi_target', timestamps: false },
);
