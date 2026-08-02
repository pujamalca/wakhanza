/**
 * Uji integrasi -- SENGAJA terpisah dari `jest.config.js`.
 *
 * `npx jest` yang biasa harus tetap bisa dijalankan di mana saja tanpa database
 * dan selesai dalam hitungan detik; begitu ia butuh MariaDB yang hidup, ia
 * berhenti dipakai sebagai pemeriksaan cepat. Berkas di sini bernama
 * `*.int.test.ts` dan hanya jalan lewat `npm run test:int`.
 *
 * Menulis ke database `wakhanza` SUNGGUHAN (bukan database uji terpisah):
 * baris ujinya diberi tanda pada `idempotency_key` dan dibersihkan sendiri di
 * `afterAll`. Alasannya bukan kemalasan -- yang justru perlu dibuktikan adalah
 * perilaku terhadap skema, grant, dan UNIQUE KEY yang benar-benar berlaku di
 * produksi. Database uji hasil `sync()` akan membuktikan hal yang berbeda dari
 * yang dipakai (dan `sequelize.sync()` memang tidak pernah dipanggil di proyek
 * ini -- lihat TECH_STACK.md).
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.int.test.ts'],
  setupFiles: ['<rootDir>/jest.integration.setup.js'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  // Berbagi satu database: uji yang berjalan bersamaan akan saling menimpa
  // app_setting yang sengaja diubah-ubah di dalam uji jam tenang/privasi.
  maxWorkers: 1,
  testTimeout: 30_000,
  clearMocks: true,
};
