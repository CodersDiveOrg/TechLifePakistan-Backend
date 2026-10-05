import type { Schema, Struct } from '@strapi/strapi';

export interface OrderCustomer extends Struct.ComponentSchema {
  collectionName: 'components_order_customers';
  info: {
    description: 'Who placed the order';
    displayName: 'Customer';
    icon: 'user';
  };
  attributes: {
    email: Schema.Attribute.Email;
    fullName: Schema.Attribute.String & Schema.Attribute.Required;
    phone: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface OrderItem extends Struct.ComponentSchema {
  collectionName: 'components_order_items';
  info: {
    description: 'A product line in an order (name and price are snapshotted at checkout)';
    displayName: 'Order item';
    icon: 'shoppingCart';
  };
  attributes: {
    imageUrl: Schema.Attribute.String;
    lineTotal: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    product: Schema.Attribute.Relation<'oneToOne', 'api::product.product'>;
    productName: Schema.Attribute.String & Schema.Attribute.Required;
    quantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 1;
        },
        number
      >;
    sku: Schema.Attribute.String;
    unitPrice: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    variantSku: Schema.Attribute.String;
    variantTitle: Schema.Attribute.String;
  };
}

export interface OrderShippingAddress extends Struct.ComponentSchema {
  collectionName: 'components_order_shipping_addresses';
  info: {
    description: 'Where the order is delivered';
    displayName: 'Shipping address';
    icon: 'pinMap';
  };
  attributes: {
    address: Schema.Attribute.Text & Schema.Attribute.Required;
    city: Schema.Attribute.String & Schema.Attribute.Required;
    province: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ProductOption extends Struct.ComponentSchema {
  collectionName: 'components_product_options';
  info: {
    description: 'An option customers choose, e.g. Voltage or Current (max 3 per product)';
    displayName: 'Option';
    icon: 'bulletList';
  };
  attributes: {
    name: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface ProductVariant extends Struct.ComponentSchema {
  collectionName: 'components_product_variants';
  info: {
    description: 'A buyable version of the product \u2014 option values, price, SKU and its own stock';
    displayName: 'Variant';
    icon: 'layer';
  };
  attributes: {
    compareAtPrice: Schema.Attribute.Decimal &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    image: Schema.Attribute.Media<'images'>;
    option1: Schema.Attribute.String;
    option2: Schema.Attribute.String;
    option3: Schema.Attribute.String;
    price: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      >;
    sku: Schema.Attribute.String & Schema.Attribute.Required;
    stock: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedDownload extends Struct.ComponentSchema {
  collectionName: 'components_shared_downloads';
  info: {
    description: 'A downloadable file such as a user manual';
    displayName: 'Download';
    icon: 'file';
  };
  attributes: {
    file: Schema.Attribute.Media<'files'> & Schema.Attribute.Required;
    label: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'User manual (PDF)'>;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: 'Search engine title, description and share image';
    displayName: 'SEO';
    icon: 'search';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 170;
      }>;
    metaTitle: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 70;
      }>;
    shareImage: Schema.Attribute.Media<'images'>;
  };
}

export interface SharedSpec extends Struct.ComponentSchema {
  collectionName: 'components_shared_specs';
  info: {
    description: 'One row of the product specifications table';
    displayName: 'Spec';
    icon: 'bulletList';
  };
  attributes: {
    label: Schema.Attribute.String & Schema.Attribute.Required;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedTextItem extends Struct.ComponentSchema {
  collectionName: 'components_shared_text_items';
  info: {
    description: 'A single line of text (highlights, announcements, regions)';
    displayName: 'Text item';
    icon: 'check';
  };
  attributes: {
    text: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SiteContact extends Struct.ComponentSchema {
  collectionName: 'components_site_contacts';
  info: {
    description: 'Phones, email, WhatsApp, address and opening hours';
    displayName: 'Contact details';
    icon: 'phone';
  };
  attributes: {
    address: Schema.Attribute.Text;
    email: Schema.Attribute.Email;
    hours: Schema.Attribute.String;
    phones: Schema.Attribute.Component<'shared.text-item', true>;
    whatsapp: Schema.Attribute.String;
  };
}

export interface SitePaymentAccount extends Struct.ComponentSchema {
  collectionName: 'components_site_payment_accounts';
  info: {
    description: 'Bank / JazzCash / Easypaisa details shown to customers who pay in advance';
    displayName: 'Payment account';
    icon: 'priceTag';
  };
  attributes: {
    accountNumber: Schema.Attribute.String & Schema.Attribute.Required;
    accountTitle: Schema.Attribute.String & Schema.Attribute.Required;
    active: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    iban: Schema.Attribute.String;
    instructions: Schema.Attribute.Text;
    method: Schema.Attribute.Enumeration<['bank', 'wallet']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'bank'>;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SiteShipping extends Struct.ComponentSchema {
  collectionName: 'components_site_shippings';
  info: {
    description: 'Delivery fee rules used at checkout';
    displayName: 'Shipping rules';
    icon: 'car';
  };
  attributes: {
    flatRate: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<250>;
    freeThreshold: Schema.Attribute.Decimal &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<5000>;
    restrictedRegions: Schema.Attribute.Component<'shared.text-item', true>;
  };
}

export interface SiteSocials extends Struct.ComponentSchema {
  collectionName: 'components_site_socials';
  info: {
    displayName: 'Social links';
    icon: 'earth';
  };
  attributes: {
    facebook: Schema.Attribute.String;
    instagram: Schema.Attribute.String;
    tiktok: Schema.Attribute.String;
    youtube: Schema.Attribute.String;
  };
}

export interface SiteTrustBadge extends Struct.ComponentSchema {
  collectionName: 'components_site_trust_badges';
  info: {
    description: 'Badge shown under the hero (icon: shield-check, truck, rotate-ccw, headset)';
    displayName: 'Trust badge';
    icon: 'shield';
  };
  attributes: {
    icon: Schema.Attribute.Enumeration<
      [
        'shield_check',
        'truck',
        'rotate_ccw',
        'headset',
        'battery_charging',
        'sun',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'shield_check'>;
    text: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export namespace Public {
    export interface ComponentSchemas {
      'order.customer': OrderCustomer;
      'order.item': OrderItem;
      'order.shipping-address': OrderShippingAddress;
      'product.option': ProductOption;
      'product.variant': ProductVariant;
      'shared.download': SharedDownload;
      'shared.seo': SharedSeo;
      'shared.spec': SharedSpec;
      'shared.text-item': SharedTextItem;
      'site.contact': SiteContact;
      'site.payment-account': SitePaymentAccount;
      'site.shipping': SiteShipping;
      'site.socials': SiteSocials;
      'site.trust-badge': SiteTrustBadge;
    }
  }
}
