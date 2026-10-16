/** @type {import('next').NextConfig} */
const cspHeader = `
    default-src 'self';
    script-src 'self' 'unsafe-eval' 'unsafe-inline';
    style-src 'self' 'unsafe-inline';
    img-src 'self' blob: data: https://raw.githubusercontent.com https://assets.coingecko.com;
    font-src 'self';
    connect-src 'self'
      https://*.alchemy.com wss://*.alchemy.com
      https://*.infura.io wss://*.infura.io
      https://*.publicnode.com
      https://api.0x.org https://sepolia.api.0x.org
      https://li.quest
      https://api.gopluslabs.io
      https://api.coingecko.com
      wss://stream.binance.com:9443
      https://*.walletconnect.com wss://*.walletconnect.com
      https://*.walletconnect.org wss://*.walletconnect.org;
    frame-src 'self' https://global-stg.transak.com https://global.transak.com;
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
`.replace(/\n/g, "");

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: cspHeader },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" }
        ],
      },
    ];
  },
};

export default nextConfig;
