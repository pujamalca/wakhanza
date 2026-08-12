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
  /**
   * Menerima nota HIBAH dari alamat ini (migrations/031).
   *
   * SENGAJA tanpa nomor urut. Penomorannya di tabel ini sudah terlanjur
   * menyimpang (`terimaPengadaan` "KEEMPAT" langsung diikuti `terimaPemesanan`
   * "KEENAM"), dan tiap kolom baru menambah satu tempat lagi yang bisa salah
   * hitung tanpa ada yang menyadarinya. Yang mengikat adalah daftar
   * pertanyaannya, bukan urutannya:
   *
   *   is_active            ke mana notifikasi resep dikirim
   *   boleh_tanya          siapa yang boleh membuat nomor RS menjawab
   *   terima_darurat_stok  siapa yang menerima rekap persediaan
   *   terima_pengadaan     siapa yang menerima nota pembelian
   *   terima_pemesanan     siapa yang menerima nota pesanan ke pemasok
   *   terima_hibah         siapa yang menerima nota barang pemberian
   *
   * Terpisah dari `terimaPengadaan` karena batas kerahasiaannya
   * berbeda, bukan demi keseragaman: harga beli pemasok punya nilai dagang dan
   * wajar dibatasi ke bagian pengadaan, sementara nilai barang PEMBERIAN justru
   * sering perlu dilihat lebih luas -- kepala instalasi, akuntansi, sampai
   * bagian yang menyusun ucapan terima kasih ke pemberinya.
   */
  declare terimaHibah: CreationOptional<boolean>;
  /**
   * Menerima nota SURAT PEMESANAN dari alamat ini (migrations/030).
   *
   * Kolom KEENAM. Terpisah dari `terimaPengadaan` walau keduanya memuat harga
   * pemasok, dan pemisahannya soal WAKTU bukan kerahasiaan: nota pesanan berguna
   * bagi yang perlu tahu sesuatu sedang DALAM PERJALANAN -- gudang yang
   * menyiapkan tempat, bagian yang menagih pemasok yang terlambat -- sementara
   * nota pembelian berguna bagi yang mencocokkan barang yang SUDAH datang.
   * Menggabungkannya memaksa siapa pun yang ingin memantau pesanan ikut menerima
   * setiap nota penerimaan.
   */
  declare terimaPemesanan: CreationOptional<boolean>;
  /**
   * Menerima nota PENJUALAN dari alamat ini (migrations/040).
   *
   * Sengaja TANPA nomor urut -- penomoran di tabel ini sudah terlanjur menyimpang
   * (028 menyebut dirinya "KEEMPAT", 030 "KEENAM"), dan yang mengikat memang
   * daftar PERTANYAANNYA, bukan urutannya.
   *
   * Terpisah dari `terimaPengadaan` dan `terimaPemesanan` karena arah barangnya
   * BERLAWANAN: keduanya menjawab "apa yang kita BELI dan berapa harganya dari
   * pemasok", sementara ini menjawab "apa yang kita JUAL dan berapa yang masuk".
   * Bagian pengadaan yang mencocokkan tagihan pemasok tidak punya urusan dengan
   * omzet loket, dan kasir yang perlu tahu tiap nota tidak punya urusan dengan
   * harga beli.
   *
   * Perlu diketahui sebelum mencentangnya: lajunya jauh lebih tinggi daripada
   * ketiga nota barang lain -- 16-46 nota per hari, berbanding 2,21 faktur
   * pengadaan per hari.
   */
  declare terimaPenjualan: CreationOptional<boolean>;
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
    terimaHibah: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'terima_hibah',
    },
    terimaPemesanan: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'terima_pemesanan',
    },
    terimaPenjualan: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      field: 'terima_penjualan',
    },
    createdBy: { type: DataTypes.STRING(64), allowNull: false, field: 'created_by' },
    updatedBy: { type: DataTypes.STRING(64), allowNull: true, field: 'updated_by' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
  },
  { sequelize: db, tableName: 'farmasi_target', timestamps: false },
);
