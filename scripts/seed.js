'use strict';

/**
 * Seeds the store with the client's catalogue, media, banners, store settings, FAQs and policies.
 *
 *   pnpm seed            # only seeds an empty database
 *   pnpm seed --force    # wipes catalogue content (not orders/users) and re-seeds
 *
 * Source data: data/seed-data.json + data/files/* (generated from the storefront's mock data).
 */
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const { compileStrapi, createStrapi } = require('@strapi/strapi');

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/seed-data.json'), 'utf8'));
const FILES = path.join(__dirname, '../data/files');
const FORCE = process.argv.includes('--force');

const CATALOGUE = [
  'api::product.product',
  'api::category.category',
  'api::brand.brand',
  'api::banner.banner',
  'api::faq.faq',
  'api::policy.policy',
];

/** "/products/x.webp" or "/manuals/x.pdf" → upload once, reuse afterwards. */
const uploaded = new Map();
async function upload(strapi, publicUrl, alternativeText) {
  const name = path.basename(publicUrl);
  if (uploaded.has(name)) return uploaded.get(name);
  const existing = await strapi.db.query('plugin::upload.file').findOne({ where: { name } });
  if (existing) {
    uploaded.set(name, existing.id);
    return existing.id;
  }
  const filepath = path.join(FILES, name);
  const [file] = await strapi
    .plugin('upload')
    .service('upload')
    .upload({
      data: { fileInfo: { name, alternativeText: alternativeText ?? null, caption: null } },
      files: { filepath, originalFilename: name, mimetype: mime.lookup(name) || 'application/octet-stream', size: fs.statSync(filepath).size },
    });
  uploaded.set(name, file.id);
  return file.id;
}

const ICON = (s) => s.replace(/-/g, '_');

async function seed(strapi) {
  const docs = (uid) => strapi.documents(uid);

  if (FORCE) {
    for (const uid of CATALOGUE) {
      for (const d of await docs(uid).findMany({ status: 'draft', limit: 1000, fields: ['documentId'] })) {
        await docs(uid).delete({ documentId: d.documentId });
      }
    }
    console.log('• cleared catalogue content');
  } else if ((await docs('api::product.product').count({})) > 0) {
    console.log('Database already has products — nothing to do (use --force to re-seed).');
    return;
  }

  // Brands
  const brandIds = {};
  for (const b of DATA.brands) {
    const doc = await docs('api::brand.brand').create({ data: { name: b.name, slug: b.slug }, status: 'published' });
    brandIds[b.slug] = doc.documentId;
  }
  console.log(`• ${DATA.brands.length} brands`);

  // Categories
  const categoryIds = {};
  for (const [i, c] of DATA.categories.entries()) {
    const doc = await docs('api::category.category').create({
      data: {
        name: c.name,
        slug: c.slug,
        description: c.description,
        icon: ICON(c.icon),
        sortOrder: i,
        image: c.image ? await upload(strapi, c.image.url, c.image.alternativeText) : null,
      },
      status: 'published',
    });
    categoryIds[c.slug] = doc.documentId;
  }
  console.log(`• ${DATA.categories.length} categories`);

  // Products
  for (const p of DATA.products) {
    const images = [];
    for (const img of p.images) images.push(await upload(strapi, img.url, img.alternativeText));
    const downloads = [];
    for (const d of p.downloads ?? []) downloads.push({ label: d.label, file: await upload(strapi, d.url, d.label) });

    await docs('api::product.product').create({
      data: {
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        model: p.model ?? null,
        shortDescription: p.shortDescription,
        description: p.description,
        price: p.price,
        compareAtPrice: p.compareAtPrice ?? null,
        stock: p.stock,
        lowStockThreshold: 3,
        images,
        category: categoryIds[p.category.slug],
        brand: p.brand ? brandIds[p.brand.slug] : null,
        specs: p.specs.map((s) => ({ label: s.label, value: s.value })),
        highlights: (p.highlights ?? []).map((text) => ({ text })),
        downloads,
        warranty: p.warranty ?? null,
        isFeatured: p.tags?.includes('featured') ?? false,
        isNew: p.tags?.includes('new') ?? false,
        isBestseller: p.tags?.includes('bestseller') ?? false,
        isFlashSale: p.tags?.includes('flash-sale') ?? false,
      },
      status: 'published',
    });
  }
  console.log(`• ${DATA.products.length} products`);

  // Banners
  const banners = [
    ...DATA.heroBanners.map((b, i) => ({ ...b, placement: 'hero', sortOrder: i })),
    ...DATA.promoBanners.map((b, i) => ({ ...b, placement: 'promo', sortOrder: i })),
  ];
  for (const b of banners) {
    await docs('api::banner.banner').create({
      data: {
        placement: b.placement,
        eyebrow: b.eyebrow ?? null,
        title: b.title,
        subtitle: b.subtitle ?? null,
        ctaLabel: b.cta.label,
        ctaHref: b.cta.href,
        image: await upload(strapi, b.image.url, b.image.alternativeText),
        theme: b.theme ?? 'primary',
        sortOrder: b.sortOrder,
      },
      status: 'published',
    });
  }
  console.log(`• ${banners.length} banners`);

  // FAQs
  let n = 0;
  for (const group of DATA.faqs) {
    for (const [question, answer] of group.items) {
      await docs('api::faq.faq').create({ data: { question, answer, group: group.group, sortOrder: n++ }, status: 'published' });
    }
  }
  console.log(`• ${n} FAQs`);

  // Policy pages (stored as markdown bullet lists)
  for (const [slug, policy] of Object.entries(DATA.policies)) {
    await docs('api::policy.policy').create({
      data: { title: policy.title, slug, body: policy.body.map((line) => `- ${line}`).join('\n') },
      status: 'published',
    });
  }
  console.log(`• ${Object.keys(DATA.policies).length} policy pages`);

  // Store settings (single type) — only created when missing so admin edits are never overwritten.
  const site = DATA.site;
  if (!(await docs('api::global.global').findFirst())) {
    await docs('api::global.global').create({
      data: {
        storeName: site.name,
        tagline: site.tagline,
        description: site.description,
        announcements: site.announcements.map((text) => ({ text })),
        contact: {
          phones: site.contact.phones.map((text) => ({ text })),
          email: site.contact.email,
          whatsapp: site.contact.whatsapp,
          address: site.contact.address,
          hours: site.contact.hours,
        },
        shipping: {
          freeThreshold: site.shipping.freeThreshold,
          flatRate: site.shipping.flatRate,
          restrictedRegions: site.shipping.restrictedRegions.map((text) => ({ text })),
        },
        socials: site.socials,
        trustBadges: site.trustBadges.map((b) => ({ icon: ICON(b.icon), title: b.title, text: b.text })),
      },
    });
    console.log('• store settings');
  }

  await seedShipping(strapi);

  // A sample coupon so the cart flow can be tested.
  if (!(await strapi.db.query('api::coupon.coupon').findOne({ where: { code: 'WELCOME10' } }))) {
    await docs('api::coupon.coupon').create({
      data: { code: 'WELCOME10', discountType: 'percent', value: 10, maxDiscount: 2000, minSubtotal: 0, active: true, usedCount: 0 },
    });
    console.log('• coupon WELCOME10 (10% off, max Rs. 2,000)');
  }
}

/** Default shipping zones mirroring the published delivery policy (only when none exist). */
async function seedShipping(strapi) {
  if ((await strapi.documents('api::shipping-zone.shipping-zone').count({})) > 0) return;
  const t = (list) => list.map((text) => ({ text }));
  const zones = [
    { name: 'Major cities', priority: 10, cities: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi'], provinces: [], estimate: '2–3 working days' },
    { name: 'Rest of Pakistan', priority: 0, cities: [], provinces: ['Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Islamabad Capital Territory', 'Gilgit-Baltistan'], estimate: '3–5 working days' },
  ];
  for (const z of zones) {
    const zone = await strapi.documents('api::shipping-zone.shipping-zone').create({ data: { name: z.name, priority: z.priority, cities: t(z.cities), provinces: t(z.provinces), active: true } });
    await strapi.documents('api::shipping-method.shipping-method').create({
      data: { name: 'Standard delivery', estimate: z.estimate, rate: 250, freeOver: 5000, codFee: 0, active: true, sortOrder: 0, zone: zone.documentId },
    });
  }
  console.log('• shipping zones (major cities 2–3 days, rest of Pakistan 3–5 days; Rs. 250, free over Rs. 5,000)');
}

async function main() {
  const appContext = await compileStrapi();
  const app = await createStrapi(appContext).load();
  app.log.level = 'error';
  try {
    await seed(app);
    console.log('Seeding complete.');
  } catch (error) {
    console.error('Seeding failed:', error);
    process.exitCode = 1;
  } finally {
    await app.destroy();
  }
}

main();
