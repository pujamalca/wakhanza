/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // `*.int.test.ts` dikecualikan: uji integrasi butuh MariaDB hidup dan punya
  // config sendiri (`npm run test:int`). Suite ini harus tetap bisa dijalankan
  // di mana saja tanpa database -- begitu tidak bisa, ia berhenti dipakai.
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['\\.int\\.test\\.ts$'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
  },
  clearMocks: true,
};
