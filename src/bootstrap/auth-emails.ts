import type { Core } from '@strapi/strapi';

/**
 * Points the users-permissions "forgot password" email at the storefront's /reset-password page and
 * brands the email. Runs once (marker in the core store) so later edits in
 * Settings → Users & Permissions → Email templates / Advanced settings are kept.
 */
export async function configureAuthEmails(strapi: Core.Strapi) {
  const marker = strapi.store({ type: 'app', name: 'techlifepakistan' });
  const VERSION = 1;
  const storefront = (process.env.STOREFRONT_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const up = strapi.store({ type: 'plugin', name: 'users-permissions' });

  if ((await marker.get({ key: 'auth-emails-version' })) === VERSION) {
    // Already set up — only follow a changed STOREFRONT_URL (e.g. a local database restored in production).
    if ((await marker.get({ key: 'auth-emails-storefront' })) !== storefront) {
      const advanced = ((await up.get({ key: 'advanced' })) ?? {}) as Record<string, unknown>;
      await up.set({ key: 'advanced', value: { ...advanced, email_reset_password: `${storefront}/reset-password` } });
      await marker.set({ key: 'auth-emails-storefront', value: storefront });
      strapi.log.info(`[setup] password reset emails → ${storefront}/reset-password`);
    }
    return;
  }

  const fromHeader = process.env.EMAIL_FROM ?? 'Tech Life Pakistan <orders@techlifepakistan.pk>';
  const match = fromHeader.match(/^(.*)<(.+)>$/);
  const from = { name: (match?.[1] ?? 'Tech Life Pakistan').trim(), email: (match?.[2] ?? fromHeader).trim() };

  const advanced = ((await up.get({ key: 'advanced' })) ?? {}) as Record<string, unknown>;
  await up.set({ key: 'advanced', value: { ...advanced, email_reset_password: `${storefront}/reset-password` } });

  const emails = ((await up.get({ key: 'email' })) ?? {}) as Record<string, any>;
  if (emails.reset_password) {
    emails.reset_password.options = {
      ...emails.reset_password.options,
      from,
      response_email: process.env.EMAIL_REPLY_TO ?? '',
      object: 'Reset your password',
      message: `<p>Hi,</p>
<p>We received a request to reset the password for your account. Click the link below to choose a new one:</p>
<p><a href="<%= URL %>?code=<%= TOKEN %>">Reset my password</a></p>
<p>If you didn’t ask for this, you can safely ignore this email — your password won’t change.</p>`,
    };
  }
  if (emails.email_confirmation) emails.email_confirmation.options = { ...emails.email_confirmation.options, from };
  await up.set({ key: 'email', value: emails });

  await marker.set({ key: 'auth-emails-version', value: VERSION });
  await marker.set({ key: 'auth-emails-storefront', value: storefront });
  strapi.log.info(`[setup] password reset emails → ${storefront}/reset-password`);
}
