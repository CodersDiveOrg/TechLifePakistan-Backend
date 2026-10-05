import type { Core } from '@strapi/strapi';

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Middlewares => [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          // Apollo Sandbox (GraphQL playground) assets in development
          'script-src': ["'self'", "'unsafe-inline'", 'https://embeddable-sandbox.cdn.apollographql.com'],
          'frame-src': ["'self'", 'https://sandbox.embed.apollographql.com'],
          'img-src': ["'self'", 'data:', 'blob:', 'https://apollo-server-landing-page.cdn.apollographql.com'],
          'media-src': ["'self'", 'data:', 'blob:'],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  {
    name: 'strapi::cors',
    config: {
      // The storefront mostly calls Strapi server-side; browsers only need this for direct calls.
      origin: env.array('CORS_ORIGINS', ['http://localhost:3000']),
      credentials: true,
    },
  },
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];

export default config;
