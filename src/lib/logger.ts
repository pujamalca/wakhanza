import path from 'node:path';
import pino from 'pino';

/**
 * N12 / ARCHITECTURE §9.7: log dibaca admin IT dan vendor — pihak yang tidak
 * berhak melihat data pasien. Nomor disamarkan, nama pasien TIDAK PERNAH masuk
 * log (bukan sekadar konvensi — tidak ada satu pun pemanggil di repo ini yang
 * boleh meneruskan nm_pasien ke logger, lihat core/privacy.ts).
 */
export function maskPhone(e164: string | null | undefined): string {
  if (!e164) return '(kosong)';
  if (e164.length <= 7) return '****';
  return `${e164.slice(0, 3)}****${e164.slice(-4)}`;
}

/**
 * §9.7: "yang paling sering bocor: objek kesalahan Sequelize" — menyertakan
 * query beserta nilai parameternya. Selalu pakai ini, jangan `logger.error(err)`.
 */
export function safeError(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code ?? (err as { original?: { code?: string } }).original?.code;
    return { message: err.message, code };
  }
  return { message: String(err) };
}

const level = process.env.LOG_LEVEL ?? 'info';
const isDev = process.env.NODE_ENV !== 'production';
const logDir = process.env.LOG_DIR ?? './logs';

const targets: pino.TransportTargetOptions[] = [
  {
    target: 'pino-roll',
    level,
    options: {
      file: path.join(logDir, 'wakhanza'),
      frequency: 'daily',
      mkdir: true,
      size: '10m',
      extension: '.log',
      limit: { count: 90 }, // ARCHITECTURE §11: log adalah salinan kedua data pribadi, ikut dibatasi umurnya
    },
  },
];

targets.push(
  isDev
    ? { target: 'pino-pretty', level, options: { colorize: true, translateTime: 'SYS:standard' } }
    : { target: 'pino/file', level, options: { destination: 1 } }, // stdout — supaya `pm2 logs` tetap melihat sesuatu
);

export const logger = pino(
  {
    level,
    // Jaring pengaman kedua bila suatu saat ada pemanggil yang keliru meneruskan
    // objek Sequelize mentah — bukan pengganti disiplin safeError() di atas.
    redact: {
      paths: ['*.sql', '*.parameters', '*.original.sql', 'err.sql', 'password', '*.password'],
      censor: '[REDACTED]',
    },
  },
  pino.transport({ targets }),
);
