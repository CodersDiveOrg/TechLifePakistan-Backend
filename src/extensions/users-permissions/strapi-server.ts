/**
 * Extends the users-permissions User with store-customer fields.
 * Private fields are never exposed by the API; the storefront reads/writes them only through the
 * custom GraphQL operations in src/graphql/customer.ts.
 */
export default (plugin: { contentTypes: Record<string, any> }) => {
  const ct = plugin.contentTypes.user;
  const schema = ct.schema ?? ct;
  Object.assign(schema.attributes, {
    fullName: { type: 'string' },
    phone: { type: 'string' },
    addresses: { type: 'relation', relation: 'oneToMany', target: 'api::address.address', mappedBy: 'user' },
    savedCart: { type: 'json', private: true },
    wishlist: { type: 'json', private: true },
    otpHash: { type: 'string', private: true, searchable: false },
    otpExpires: { type: 'datetime', private: true },
    otpAttempts: { type: 'integer', private: true, default: 0 },
    // Personal refer-a-friend code (generated on first use — see src/lib/referrals.ts).
    referralCode: { type: 'string', unique: true },
  });
  return plugin;
};
