import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { sendLoginCodeEmail } from '../lib/emails';

const { ValidationError } = errors;
const USER = 'plugin::users-permissions.user';
const TTL_MINUTES = 10;
const RESEND_AFTER_MS = 60_000;
const MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Codes are stored as an HMAC (keyed with the app secret), never in plain text. */
const hash = (email: string, code: string) =>
  createHmac('sha256', String(process.env.JWT_SECRET ?? process.env.APP_KEYS ?? 'otp')).update(`${email}:${code}`).digest('hex');

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Passwordless sign-in: email a 6-digit code, verify it, issue the normal users-permissions JWT.
 * New emails get an account automatically (when sign-ups are enabled in Users & Permissions → Advanced settings).
 */
export function otpExtension(strapi: Core.Strapi) {
  const normalise = (email: string) => {
    const e = email.trim().toLowerCase();
    if (!EMAIL_RE.test(e) || e.length > 254) throw new ValidationError('Enter a valid email address.');
    return e;
  };

  const signUpsAllowed = async () => {
    const advanced = (await strapi.store({ type: 'plugin', name: 'users-permissions' }).get({ key: 'advanced' })) as { allow_register?: boolean } | null;
    return advanced?.allow_register !== false;
  };

  return {
    typeDefs: /* GraphQL */ `
      type LoginCodeResult {
        ok: Boolean!
        message: String!
      }
      extend type Mutation {
        "Emails a one-time 6-digit sign-in code."
        requestLoginCode(email: String!): LoginCodeResult!
        "Exchanges the emailed code for a session (creates the account for new customers)."
        verifyLoginCode(email: String!, code: String!): UsersPermissionsLoginPayload!
      }
    `,
    resolvers: {
      Mutation: {
        requestLoginCode: async (_: unknown, args: { email: string }) => {
          const email = normalise(args.email);
          const generic = { ok: true, message: `If ${email} can sign in, a code is on its way. It expires in ${TTL_MINUTES} minutes.` };
          const user = await strapi.db.query(USER).findOne({ where: { email }, select: ['id', 'blocked', 'otpExpires'] });
          if (user?.blocked) return generic;
          if (!user && !(await signUpsAllowed())) return generic;

          // Throttle resends per address.
          if (user?.otpExpires && new Date(user.otpExpires).getTime() - TTL_MINUTES * 60_000 + RESEND_AFTER_MS > Date.now()) {
            throw new ValidationError('A code was just sent — please wait a minute before requesting another.');
          }

          const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
          const data = { otpHash: hash(email, code), otpExpires: new Date(Date.now() + TTL_MINUTES * 60_000), otpAttempts: 0 };
          if (user) {
            await strapi.db.query(USER).update({ where: { id: user.id }, data });
          } else {
            const role = await strapi.db.query('plugin::users-permissions.role').findOne({ where: { type: 'authenticated' } });
            await strapi.plugin('users-permissions').service('user').add({
              username: email,
              email,
              provider: 'local',
              // Random password the customer never sees; they can set one later via "forgot password".
              password: randomBytes(24).toString('base64url'),
              confirmed: false,
              blocked: false,
              role: role.id,
              ...data,
            });
          }
          await sendLoginCodeEmail(strapi, email, code, TTL_MINUTES);
          return generic;
        },

        verifyLoginCode: async (_: unknown, args: { email: string; code: string }) => {
          const email = normalise(args.email);
          const code = args.code.replace(/\D/g, '');
          const invalid = new ValidationError('That code is incorrect or has expired. Please request a new one.');
          const user = await strapi.db.query(USER).findOne({ where: { email }, populate: ['role'] });
          if (!user || user.blocked || !user.otpHash || !user.otpExpires) throw invalid;

          if (new Date(user.otpExpires).getTime() < Date.now() || (user.otpAttempts ?? 0) >= MAX_ATTEMPTS) {
            await strapi.db.query(USER).update({ where: { id: user.id }, data: { otpHash: null, otpAttempts: 0 } });
            throw invalid;
          }
          if (code.length !== 6 || !sameHash(user.otpHash, hash(email, code))) {
            await strapi.db.query(USER).update({ where: { id: user.id }, data: { otpAttempts: (user.otpAttempts ?? 0) + 1 } });
            throw invalid;
          }

          // Single use; a successful code also proves the email address.
          const fresh = await strapi.db.query(USER).update({
            where: { id: user.id },
            data: { otpHash: null, otpExpires: null, otpAttempts: 0, confirmed: true },
            populate: ['role'],
          });
          const jwt = strapi.plugin('users-permissions').service('jwt').issue({ id: fresh.id });
          return {
            jwt,
            user: { id: fresh.id, documentId: fresh.documentId, username: fresh.username, email: fresh.email, confirmed: true, blocked: false, role: fresh.role },
          };
        },
      },
    },
    resolversConfig: {
      'Mutation.requestLoginCode': { auth: false },
      'Mutation.verifyLoginCode': { auth: false },
    },
  };
}
