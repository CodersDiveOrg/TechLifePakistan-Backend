import type { Core } from '@strapi/strapi';
import { errors } from '@strapi/utils';
import { claimReferral, describeReward, getReferralProgram, referralSummary } from '../lib/referrals';

const { ValidationError } = errors;

type Ctx = { state: { user?: { id: number } } };

const ME = { auth: { scope: ['plugin::users-permissions.user.me'] } };

/** Refer-a-friend: public program info, the customer's referral dashboard and claiming an invite. */
export function referralExtension(strapi: Core.Strapi) {
  const userId = (ctx: Ctx) => {
    const id = ctx.state.user?.id;
    if (!id) throw new ValidationError('Please sign in.');
    return id;
  };

  return {
    typeDefs: /* GraphQL */ `
      type ReferralProgramInfo {
        enabled: Boolean!
        referralsRequired: Int!
        "first_delivered_order | signup"
        qualifyOn: String!
        rewardText: String!
        terms: String
      }
      type ReferralFriend {
        "First name or masked email of the invited friend"
        name: String!
        "pending | qualified | rejected"
        status: String!
        joinedAt: String!
      }
      type ReferralReward {
        code: String!
        description: String!
        endsAt: String
        used: Boolean!
        expired: Boolean!
      }
      type ReferralSummary {
        enabled: Boolean!
        code: String!
        referralsRequired: Int!
        qualifyOn: String!
        rewardText: String!
        rewardValidDays: Int
        repeatable: Boolean!
        terms: String
        qualifiedCount: Int!
        pendingCount: Int!
        "Qualified referrals counted towards the next reward"
        progress: Int!
        "Qualified referrals still needed for the next reward (0 when no more can be earned)"
        remaining: Int!
        referrals: [ReferralFriend!]!
        rewards: [ReferralReward!]!
      }
      type ClaimReferralResult {
        ok: Boolean!
        message: String!
      }
      extend type Query {
        "Refer-a-friend settings shown on the storefront."
        referralProgram: ReferralProgramInfo!
        "The signed-in customer's referral link code, progress and earned reward coupons."
        myReferrals: ReferralSummary!
      }
      extend type Mutation {
        "Link the signed-in (newly created) account to the friend who invited them."
        claimReferral(code: String!): ClaimReferralResult!
      }
    `,
    resolvers: {
      Query: {
        referralProgram: async () => {
          const p = await getReferralProgram(strapi);
          return { enabled: p.enabled, referralsRequired: p.referralsRequired, qualifyOn: p.qualifyOn, rewardText: describeReward(p), terms: p.terms };
        },
        myReferrals: (_: unknown, __: unknown, ctx: Ctx) => referralSummary(strapi, userId(ctx)),
      },
      Mutation: {
        claimReferral: (_: unknown, args: { code: string }, ctx: Ctx) => claimReferral(strapi, userId(ctx), args.code),
      },
    },
    resolversConfig: {
      'Query.referralProgram': { auth: false },
      'Query.myReferrals': ME,
      'Mutation.claimReferral': ME,
    },
  };
}
