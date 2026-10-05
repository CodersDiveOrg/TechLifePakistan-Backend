import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';

const { ValidationError, NotFoundError } = errors;
const USER = 'plugin::users-permissions.user';
const ADDRESS = 'api::address.address';
const PHONE_RE = /^(\+92|0)3\d{2}-?\d{7}$/;

type Ctx = { state: { user?: { id: number } } };
type CartLine = { productId: string; variantSku?: string | null; quantity: number };

const ME = { auth: { scope: ['plugin::users-permissions.user.me'] } };

function cleanCart(lines: unknown): CartLine[] {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((l): l is CartLine => !!l && typeof (l as CartLine).productId === 'string')
    .slice(0, 100)
    .map((l) => ({ productId: l.productId, variantSku: l.variantSku || null, quantity: Math.max(1, Math.min(99, Math.round(Number(l.quantity) || 1))) }));
}

/** Signed-in customer: profile, address book, cart + wishlist that follow them across devices. */
export function customerExtension(strapi: Core.Strapi) {
  const userId = (ctx: Ctx) => {
    const id = ctx.state.user?.id;
    if (!id) throw new ValidationError('Please sign in.');
    return id;
  };

  const addresses = (id: number) =>
    strapi.db.query(ADDRESS).findMany({ where: { user: { id } }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });

  const profile = async (id: number) => {
    const user = await strapi.db.query(USER).findOne({ where: { id }, select: ['email', 'fullName', 'phone', 'savedCart', 'wishlist'] });
    return {
      email: user.email,
      fullName: user.fullName ?? '',
      phone: user.phone ?? '',
      addresses: await addresses(id),
      savedCart: cleanCart(user.savedCart),
      wishlist: Array.isArray(user.wishlist) ? user.wishlist.filter((x: unknown) => typeof x === 'string').slice(0, 200) : [],
    };
  };

  return {
    typeDefs: /* GraphQL */ `
      type CustomerAddress {
        id: ID!
        label: String
        fullName: String!
        phone: String!
        province: String!
        city: String!
        address: String!
        isDefault: Boolean!
      }
      type CartLine {
        productId: ID!
        variantSku: String
        quantity: Int!
      }
      type CustomerProfile {
        email: String!
        fullName: String!
        phone: String!
        addresses: [CustomerAddress!]!
        savedCart: [CartLine!]!
        wishlist: [ID!]!
      }
      input AddressInput {
        id: ID
        label: String
        fullName: String!
        phone: String!
        province: String!
        city: String!
        address: String!
        isDefault: Boolean
      }
      input CartLineInput {
        productId: ID!
        variantSku: String
        quantity: Int!
      }
      extend type Query {
        "The signed-in customer's profile, addresses, saved cart and wishlist."
        myProfile: CustomerProfile!
      }
      extend type Mutation {
        updateMyProfile(fullName: String!, phone: String): CustomerProfile!
        saveAddress(input: AddressInput!): [CustomerAddress!]!
        deleteAddress(id: ID!): [CustomerAddress!]!
        "Replace the saved cart, or merge (merge: true) the browser cart into it at sign-in."
        saveCart(items: [CartLineInput!]!, merge: Boolean): [CartLine!]!
        saveWishlist(productIds: [ID!]!, merge: Boolean): [ID!]!
      }
    `,
    resolvers: {
      Query: {
        myProfile: (_: unknown, __: unknown, ctx: Ctx) => profile(userId(ctx)),
      },
      Mutation: {
        updateMyProfile: async (_: unknown, args: { fullName: string; phone?: string }, ctx: Ctx) => {
          const id = userId(ctx);
          const fullName = args.fullName.trim().slice(0, 80);
          if (fullName.length < 2) throw new ValidationError('Please enter your name.');
          const phone = args.phone?.replace(/\s/g, '') ?? '';
          if (phone && !PHONE_RE.test(phone)) throw new ValidationError('Enter a valid mobile number, e.g. 03001234567.');
          await strapi.db.query(USER).update({ where: { id }, data: { fullName, phone: phone || null } });
          return profile(id);
        },

        saveAddress: async (_: unknown, { input }: { input: Record<string, any> }, ctx: Ctx) => {
          const id = userId(ctx);
          const data = {
            label: String(input.label ?? 'Home').trim().slice(0, 40) || 'Home',
            fullName: String(input.fullName).trim().slice(0, 80),
            phone: String(input.phone).replace(/\s/g, ''),
            province: String(input.province).trim(),
            city: String(input.city).trim().slice(0, 60),
            address: String(input.address).trim().slice(0, 300),
          };
          if (data.fullName.length < 2 || data.city.length < 2 || data.address.length < 10) throw new ValidationError('Please complete the address.');
          if (!PHONE_RE.test(data.phone)) throw new ValidationError('Enter a valid mobile number, e.g. 03001234567.');

          const existing = await addresses(id);
          if (existing.length >= 10 && !input.id) throw new ValidationError('You can save up to 10 addresses.');
          const makeDefault = !!input.isDefault || existing.length === 0;
          if (makeDefault) await strapi.db.query(ADDRESS).updateMany({ where: { user: { id } }, data: { isDefault: false } });

          if (input.id) {
            const own = existing.find((a: { id: number }) => String(a.id) === String(input.id));
            if (!own) throw new NotFoundError('Address not found');
            await strapi.db.query(ADDRESS).update({ where: { id: own.id }, data: { ...data, ...(makeDefault ? { isDefault: true } : {}) } });
          } else {
            await strapi.db.query(ADDRESS).create({ data: { ...data, isDefault: makeDefault, user: id } });
          }
          return addresses(id);
        },

        deleteAddress: async (_: unknown, args: { id: string }, ctx: Ctx) => {
          const id = userId(ctx);
          const own = (await addresses(id)).find((a: { id: number }) => String(a.id) === String(args.id));
          if (!own) throw new NotFoundError('Address not found');
          await strapi.db.query(ADDRESS).delete({ where: { id: own.id } });
          // Keep one default address when possible.
          const left = await addresses(id);
          if (left.length && !left.some((a: { isDefault: boolean }) => a.isDefault)) {
            await strapi.db.query(ADDRESS).update({ where: { id: left[0].id }, data: { isDefault: true } });
          }
          return addresses(id);
        },

        saveCart: async (_: unknown, args: { items: CartLine[]; merge?: boolean }, ctx: Ctx) => {
          const id = userId(ctx);
          let lines = cleanCart(args.items);
          if (args.merge) {
            const saved = cleanCart((await strapi.db.query(USER).findOne({ where: { id }, select: ['savedCart'] }))?.savedCart);
            const map = new Map(saved.map((l) => [`${l.productId}::${l.variantSku ?? ''}`, l]));
            for (const l of lines) {
              const key = `${l.productId}::${l.variantSku ?? ''}`;
              const prev = map.get(key);
              map.set(key, prev ? { ...l, quantity: Math.min(99, Math.max(prev.quantity, l.quantity)) } : l);
            }
            lines = [...map.values()].slice(0, 100);
          }
          await strapi.db.query(USER).update({ where: { id }, data: { savedCart: lines } });
          return lines;
        },

        saveWishlist: async (_: unknown, args: { productIds: string[]; merge?: boolean }, ctx: Ctx) => {
          const id = userId(ctx);
          let ids = [...new Set(args.productIds.filter((x) => typeof x === 'string'))];
          if (args.merge) {
            const saved = (await strapi.db.query(USER).findOne({ where: { id }, select: ['wishlist'] }))?.wishlist;
            ids = [...new Set([...ids, ...(Array.isArray(saved) ? saved : [])])];
          }
          ids = ids.slice(0, 200);
          await strapi.db.query(USER).update({ where: { id }, data: { wishlist: ids } });
          return ids;
        },
      },
    },
    resolversConfig: {
      'Query.myProfile': ME,
      'Mutation.updateMyProfile': ME,
      'Mutation.saveAddress': ME,
      'Mutation.deleteAddress': ME,
      'Mutation.saveCart': ME,
      'Mutation.saveWishlist': ME,
    },
  };
}
