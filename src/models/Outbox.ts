import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';
import { OUTBOX_STATUSES, type OutboxStatus } from '@/core/outboxStatus';

export type { OutboxStatus };

export class Outbox extends Model<InferAttributes<Outbox>, InferCreationAttributes<Outbox>> {
  declare id: CreationOptional<number>;
  declare idempotencyKey: string;
  declare triggerCode: string;
  declare campaignId: number | null;
  declare noRkmMedis: string | null;
  declare phoneE164: string | null;
  /**
   * Alamat tujuan lengkap (`628xxx@c.us` / `120363xxx@g.us`) untuk pesan yang
   * TIDAK berangkat dari nomor seorang pasien -- sejauh ini hanya notifikasi
   * farmasi ke grup/petugas apotek.
   *
   * NULL = perilaku sembilan pemicu lain, persis seperti sebelumnya: tujuannya
   * dirakit dispatcher dari `phone_e164` + '@c.us'. Dipisah dari `phone_e164`
   * karena kolom itu dipakai mencari daftar tolak dan memeriksa pendaftaran
   * nomor -- keduanya tidak berlaku untuk grup. Lihat migrations/016.
   */
  declare chatId: string | null;
  declare body: string;
  /**
   * Lintasan berkas lampiran RELATIF terhadap direktori media (lihat
   * lib/mediaStorage.ts) -- bukan lintasan absolut, supaya memindahkan
   * pemasangan atau direktori datanya tidak membatalkan baris lama.
   */
  declare mediaPath: string | null;
  declare mediaMime: string | null;
  /** Nama asli unggahan, HANYA untuk ditampilkan ke staf dan sebagai nama berkas di WhatsApp. */
  declare mediaName: string | null;
  declare status: CreationOptional<OutboxStatus>;
  declare attempts: CreationOptional<number>;
  declare eventAt: Date;
  declare scheduledAt: Date;
  declare sentAt: Date | null;
  /**
   * Konfirmasi terkirim (migrations/035) -- DIMENSI KEDUA di samping `status`,
   * bukan kelanjutannya. Sebuah baris tetap `sent` sementara ketiga kolom di
   * bawah bergerak dari server -> HP penerima -> dibaca.
   *
   * `waMessageId` satu-satunya penghubung ke event `message_ack` yang datang
   * belakangan; `ackLevel` artinya ada di core/waAck.ts.
   *
   * KOSONG TIDAK berarti tidak sampai: ack cuma tiba selama sesi yang
   * mengirimnya masih hidup. Bukti POSITIF, bukan bukti negatif.
   */
  declare waMessageId: CreationOptional<string | null>;
  declare ackLevel: CreationOptional<number | null>;
  declare ackAt: CreationOptional<Date | null>;
  declare lastError: string | null;
  declare createdAt: CreationOptional<Date>;
}

Outbox.init(
  {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    idempotencyKey: { type: DataTypes.STRING(64), allowNull: false, unique: true, field: 'idempotency_key' },
    triggerCode: { type: DataTypes.STRING(32), allowNull: false, field: 'trigger_code' },
    campaignId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true, field: 'campaign_id' },
    noRkmMedis: { type: DataTypes.STRING(15), allowNull: true, field: 'no_rkm_medis' },
    phoneE164: { type: DataTypes.STRING(20), allowNull: true, field: 'phone_e164' },
    chatId: { type: DataTypes.STRING(64), allowNull: true, field: 'chat_id' },
    body: { type: DataTypes.TEXT, allowNull: false },
    mediaPath: { type: DataTypes.STRING(255), allowNull: true, field: 'media_path' },
    mediaMime: { type: DataTypes.STRING(100), allowNull: true, field: 'media_mime' },
    mediaName: { type: DataTypes.STRING(255), allowNull: true, field: 'media_name' },
    // Daftar nilainya diambil dari core/outboxStatus.ts, bukan diketik ulang di
    // sini: ENUM yang tertinggal satu nilai dari daftar pusat akan ditolak
    // MariaDB saat insert -- kegagalan yang baru muncul di produksi.
    status: {
      type: DataTypes.ENUM(...OUTBOX_STATUSES),
      allowNull: false,
      defaultValue: 'pending',
    },
    attempts: { type: DataTypes.TINYINT.UNSIGNED, allowNull: false, defaultValue: 0 },
    eventAt: { type: DataTypes.DATE, allowNull: false, field: 'event_at' },
    scheduledAt: { type: DataTypes.DATE, allowNull: false, field: 'scheduled_at' },
    sentAt: { type: DataTypes.DATE, allowNull: true, field: 'sent_at' },
    waMessageId: { type: DataTypes.STRING(64), allowNull: true, field: 'wa_message_id' },
    ackLevel: { type: DataTypes.TINYINT, allowNull: true, field: 'ack_level' },
    ackAt: { type: DataTypes.DATE, allowNull: true, field: 'ack_at' },
    lastError: { type: DataTypes.TEXT, allowNull: true, field: 'last_error' },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
  },
  { sequelize: db, tableName: 'outbox', timestamps: false },
);
