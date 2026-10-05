import type { Knex } from 'knex';

/**
 * Stock for product variants lives in the `product.variant` component rows. With draft & publish each
 * product has a draft and a published row, each with its own copy of the components — stock changes
 * are applied to both copies (matched by SKU) so publishing later never resurrects old stock.
 */

const VARIANTS = 'components_product_variants';
const LINKS = 'products_cmps';
const PRODUCTS = 'products';

/** Locks and returns the published variant row (FOR UPDATE) — call inside a transaction. */
export async function lockPublishedVariant(trx: Knex.Transaction, productDocumentId: string, sku: string) {
  const row = await trx(VARIANTS)
    .select(`${VARIANTS}.id`, `${VARIANTS}.stock`, `${VARIANTS}.sku`)
    .join(LINKS, function () {
      this.on(`${LINKS}.cmp_id`, '=', `${VARIANTS}.id`).andOn(`${LINKS}.component_type`, '=', trx.raw('?', ['product.variant']));
    })
    .join(PRODUCTS, `${PRODUCTS}.id`, `${LINKS}.entity_id`)
    .where(`${PRODUCTS}.document_id`, productDocumentId)
    .whereNotNull(`${PRODUCTS}.published_at`)
    .where(`${LINKS}.field`, 'variants')
    .where(`${VARIANTS}.sku`, sku)
    .forUpdate()
    .first();
  return row as { id: number; stock: number; sku: string } | undefined;
}

/** Adds `delta` (negative to decrement) to a variant's stock on every row of the product (draft + published). */
export async function adjustVariantStock(db: Knex | Knex.Transaction, productDocumentId: string, sku: string, delta: number) {
  const ids = db(LINKS)
    .select(`${LINKS}.cmp_id`)
    .join(PRODUCTS, `${PRODUCTS}.id`, `${LINKS}.entity_id`)
    .where(`${PRODUCTS}.document_id`, productDocumentId)
    .where(`${LINKS}.field`, 'variants')
    .where(`${LINKS}.component_type`, 'product.variant');
  const q = db(VARIANTS).whereIn('id', ids).where('sku', sku);
  return delta >= 0 ? q.increment('stock', delta) : q.decrement('stock', -delta);
}
