import type { Core } from '@strapi/strapi';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedTypes = [
  'image/svg+xml',
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => ({
  'users-permissions': {
    config: {
      // The Next.js server stores the customer JWT in its own httpOnly cookie,
      // so plain (non-refresh) JWTs are the simplest secure option here.
      jwtManagement: 'legacy-support',
      jwt: { expiresIn: '7d' },
      ratelimit: { interval: 60_000, max: 10 },
    },
  },
  graphql: {
    config: {
      endpoint: '/graphql',
      shadowCRUD: true,
      depthLimit: 10,
      defaultLimit: 25,
      maxLimit: 100,
      landingPage: env('NODE_ENV') !== 'production',
      apolloServer: {
        introspection: env('NODE_ENV') !== 'production',
      },
    },
  },
  // Transactional email (orders, password reset). Locally: Mailpit (docker compose) on :1025, inbox at http://localhost:8025.
  // Production: any SMTP account (Hostinger mail, Gmail app password, Brevo…).
  email: {
    config: {
      provider: 'nodemailer',
      providerOptions: {
        host: env('SMTP_HOST', '127.0.0.1'),
        port: env.int('SMTP_PORT', 1025),
        secure: env.bool('SMTP_SECURE', false),
        ...(env('SMTP_USERNAME') ? { auth: { user: env('SMTP_USERNAME'), pass: env('SMTP_PASSWORD') } } : {}),
      },
      settings: {
        defaultFrom: env('EMAIL_FROM', 'Tech Life Pakistan <orders@techlifepakistan.pk>'),
        defaultReplyTo: env('EMAIL_REPLY_TO', 'sales@techlifepakistan.pk'),
      },
    },
  },
  // Abuse protection for /api/* and /graphql.
  'strapi-plugin-rate-limit': {
    enabled: true,
    config: {
      defaults: { limit: env.int('RATE_LIMIT_PER_MINUTE', 120), interval: '1m' },
      rules: [
        // Login / register / password reset over REST
        { path: '/api/auth/**', limit: 10, interval: '15m', blockDuration: 300 },
        // Storefront GraphQL (checkout, coupons, reviews, tracking, auth mutations)
        { path: '/graphql', limit: env.int('RATE_LIMIT_GRAPHQL_PER_MINUTE', 60), interval: '1m', blockDuration: 60 },
      ],
      // The storefront sends each shopper's IP in CF-Connecting-IP. In production, Nginx in front of
      // Strapi must overwrite this header with $remote_addr so it can't be spoofed (see README).
      cloudflare: true,
      // Requests without that header from the storefront server itself (catalogue reads, builds).
      allowlist: { ips: env.array('RATE_LIMIT_ALLOW_IPS', ['127.0.0.1', '::1', '::ffff:127.0.0.1']) },
      thresholdWarning: 0.8,
    },
  },
  upload: {
    config: {
      security: {
        allowedTypes: allowedMediaTypes,
        deniedTypes,
      },
    },
  },
});

export default config;
