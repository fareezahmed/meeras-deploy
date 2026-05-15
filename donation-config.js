/**
 * Meeras — Stripe donation settings (edit this file; do not put secrets here).
 *
 * This file sets window.MEERAS_DONATION, which the app merges into DONATION_CONFIG.
 * Use Stripe Payment Links only (https://buy.stripe.com/...). No API keys.
 *
 * Create links (~5 min):
 *   1. https://dashboard.stripe.com/payment-links → "+ New"
 *   2. Product: e.g. "Meeras donation — A$5" (repeat for 15 / 50; optional "Other")
 *   3. Pricing: "Standard pricing" with fixed AUD, or "Customer chooses price" for Other
 *   4. Collect customer addresses → No (keeps checkout simple)
 *   5. After payment → send users back to your site (optional)
 *   6. Copy each link URL into the matching field below. Leave '' for amounts you skip.
 *
 * The donation step appears when at least one link is a valid https Stripe URL,
 * unless enabled is false.
 */
(function () {
  var origin = '';
  try {
    if (typeof window !== 'undefined' && window.location && window.location.origin) {
      origin = window.location.origin;
    }
  } catch (e) {}

  window.MEERAS_DONATION = {
    enabled: true,
    currency: 'AUD',
    links: {
      amount5: 'https://buy.stripe.com/cNiaEXekMf6v1ZN3Hkg7e08',
      amount15: 'https://buy.stripe.com/5kQ5kDgsUbUj33R6Twg7e0a',
      amount50: 'https://buy.stripe.com/3cIaEXb8Agaz47V4Log7e0b',
      custom: 'https://buy.stripe.com/eVq6oH5OgaQfawj1zcg7e0c',
    },
    successUrl: origin,
  };
})();
