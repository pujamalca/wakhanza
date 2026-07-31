import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from 'sequelize';
import { db } from '@/db/wakhanza';

export class AppSetting extends Model<InferAttributes<AppSetting>, InferCreationAttributes<AppSetting>> {
  declare k: string;
  declare v: string;
}

AppSetting.init(
  {
    k: { type: DataTypes.STRING(64), primaryKey: true },
    v: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize: db, tableName: 'app_setting', timestamps: false },
);

const cache = new Map<string, { value: string; at: number }>();
const CACHE_TTL_MS = 5000;

/** Baca satu setting dengan cache singkat — dipanggil tiap siklus poller/dispatcher. */
export async function getSetting(key: string, fallback?: string): Promise<string | undefined> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  const row = await AppSetting.findByPk(key);
  const value = row?.v ?? fallback;
  if (value !== undefined) cache.set(key, { value, at: Date.now() });
  return value;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key, String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function getSettingJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await getSetting(key);
  if (raw === undefined) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await AppSetting.upsert({ k: key, v: value });
  cache.delete(key);
}
