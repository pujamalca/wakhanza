/**
 * ARCHITECTURE §4.8: rencana query diperlakukan sebagai uji regresi. Tiap
 * modul di src/khanza/ mendaftarkan query poller-nya di sini lewat
 * registerPlanCheck() — bukan ditulis terpisah dari query yang benar-benar
 * dipakai, supaya tidak ada risiko keduanya diam-diam berbeda.
 */
export interface PlanCheck {
  /** Nama pemicu, mis. 'QUEUE_REG'. Dipakai sebagai label di output verify:plans. */
  name: string;
  sql: string;
  replacements: Record<string, unknown>;
  /** Hanya true untuk booking_registrasi — satu-satunya full scan yang disengaja (§4.4). */
  allowFullScan?: boolean;
  /** Ambang rows dari EXPLAIN sebelum dianggap gagal. Default 500. */
  maxRows?: number;
}

const registry: PlanCheck[] = [];

export function registerPlanCheck(check: PlanCheck): void {
  registry.push(check);
}

export function allPlanChecks(): readonly PlanCheck[] {
  return registry;
}
