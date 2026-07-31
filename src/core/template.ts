/**
 * Penggantian variabel `{nama}` — satu lintasan, wajib (ARCHITECTURE §9.2).
 *
 * `nm_pasien`/`nm_poli`/`nm_dokter` di sik diisi manusia tanpa batasan format
 * (N9). Pasien bernama literal "{kontak_rs}" tidak boleh membuat nomor telepon
 * rumah sakit muncul di posisi namanya — itu sebabnya String.replace dengan
 * callback (satu pemindaian kiri-ke-kanan) dipakai, BUKAN perulangan sampai
 * tidak ada lagi `{...}` yang cocok. Hasil substitusi tidak pernah diperiksa
 * ulang untuk pola `{...}`.
 */
const VAR_RE = /\{(\w+)\}/g;

export const KNOWN_TEMPLATE_VARIABLES = [
  'nama_pasien',
  'no_rm',
  'nama_rs',
  'alamat_rs',
  'kontak_rs',
  'no_antrian',
  'nama_poli',
  'nama_dokter',
  'tanggal',
  'jam',
  'jenis_layanan',
] as const;

export type TemplateVariable = (typeof KNOWN_TEMPLATE_VARIABLES)[number];

/**
 * BROADCAST tidak terikat satu kunjungan -- {no_antrian}/{nama_poli}/
 * {nama_dokter}/{tanggal}/{jam}/{jenis_layanan} mengacu ke SATU kejadian
 * spesifik yang tidak well-defined untuk segmen pasien merentang banyak
 * kunjungan. Subset ini sengaja lebih sempit dari KNOWN_TEMPLATE_VARIABLES.
 */
export const BROADCAST_TEMPLATE_VARIABLES = ['nama_pasien', 'no_rm', 'nama_rs', 'alamat_rs', 'kontak_rs'] as const;

export function extractVariables(body: string): string[] {
  const names = new Set<string>();
  for (const match of body.matchAll(VAR_RE)) {
    const name = match[1];
    if (name) names.add(name);
  }
  return [...names];
}

/** Dipanggil saat template DISIMPAN, bukan saat dikirim (ARCHITECTURE §5.3). */
export function findUnknownVariables(body: string, allowed: readonly string[] = KNOWN_TEMPLATE_VARIABLES): string[] {
  const known = new Set<string>(allowed);
  return extractVariables(body).filter((v) => !known.has(v));
}

/**
 * Buang karakter kendali dan baris baru, rapikan spasi berlebih, batasi
 * panjang. Nama 40 karakter berisi baris baru bisa dipakai memalsukan
 * struktur pesan supaya tampak seperti pengumuman resmi RS (§9.2).
 */
export function sanitizeValue(value: string, maxLength = 60): string {
  const cleaned = value.replace(/[\x00-\x1F\x7F]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, maxLength);
}

export function renderTemplate(body: string, vars: Partial<Record<TemplateVariable, string>>): string {
  return body.replace(VAR_RE, (_match, key: string) => {
    const value = vars[key as TemplateVariable];
    return value !== undefined ? sanitizeValue(value) : '';
  });
}
