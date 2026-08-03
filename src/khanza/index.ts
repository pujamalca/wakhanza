// Barrel — setiap modul pemicu di sini mendaftarkan query pollernya ke
// planChecks.ts sebagai side-effect saat diimpor. scripts/verify-plans.ts
// mengimpor barrel ini supaya seluruh pemicu ikut diperiksa otomatis.
export * from './antrian';
export * from './penunjang';
export * from './farmasi';
export * from './farmasiStaf';
export * from './billing';
export * from './booking';
export * from './pasienSegment';
export * from './broadcastSchedule';
export * from './jadwalDokter';
