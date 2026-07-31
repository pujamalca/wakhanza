/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // whatsapp-web.js dan puppeteer-core hanya dipakai di worker/, bukan di Next.js,
  // tapi tetap dikecualikan dari bundling server Next.js untuk berjaga-jaga bila
  // ada import tidak sengaja dari kode dashboard.
  serverExternalPackages: ['whatsapp-web.js', 'puppeteer-core', 'puppeteer', 'sequelize', 'bcrypt'],
};

module.exports = nextConfig;
