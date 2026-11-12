# Meeras Support: Stripe product images, descriptions and thank-you messages

Everything here is for the **Meeras Support** products in the Stripe dashboard
(account "wizinsights"). It follows the Al Mawarith Donate product: a square
branded image, a short description that says what the money pays for and that
it is not tax-deductible, and a thank-you message after payment.

Nothing in this folder is deployed to the website.

The amounts are the ones on the Support Meeras page: A$5, A$15, A$50 and a
customer-chosen amount.

## 1. Images

1600 x 1600 JPEG, about 320 KB each (Stripe accepts JPEG, PNG or WEBP under 2 MB).

| Stripe product | Price | Image file |
|---|---|---|
| Meeras Support | Customer chooses | `meeras-support.jpg` (heart) |
| Meeras Support - 5 | A$5 | `meeras-support-5-coffee.jpg` |
| Meeras Support - 15 | A$15 | `meeras-support-15-domain.jpg` |
| Meeras Support - 50 | A$50 | `meeras-support-50-hosting.jpg` |

To use one image on every product, as Al Mawarith Donate does, use
`meeras-support.jpg` for all of them.

**Where:** Stripe dashboard → Product catalogue → open the product →
Edit product → Image → Upload.

To change a headline or icon, edit `card.html` and run `./render.sh` (macOS).

## 2. Product descriptions

**Where:** the same Edit product screen → Description.

**Meeras Support** (customer chooses the amount)

> A one-off contribution towards hosting, the domain and upkeep, so the Islamic Will generator for Muslim families in Australia stays free, with no ads and no sign-up. Meeras is not a registered charity, so contributions are not tax-deductible.

**Meeras Support - 5**

> A coffee for the developer. A one-off contribution towards the evenings of fixes and replies that keep Meeras, the free Islamic Will generator for Australia, accurate and up to date. Meeras is not a registered charity, so contributions are not tax-deductible.

**Meeras Support - 15**

> A one-off contribution towards renewing meeras.com.au for a year, so the free Islamic Will generator stays at the same trusted address for every family who looks for it. Meeras is not a registered charity, so contributions are not tax-deductible.

**Meeras Support - 50**

> A one-off contribution towards about three months of hosting and upkeep, so Meeras stays online and free, with no ads and no sign-up, for every Muslim family in Australia who needs an Islamic Will. Meeras is not a registered charity, so contributions are not tax-deductible.

## 3. Thank-you messages

**Where:** Stripe dashboard → Payment Links → open the link → Edit →
After payment → "Show confirmation page" → tick "Replace default with custom
message" → paste. Stripe allows up to 500 characters; each message below is
under 400.

**Meeras Support** (customer chooses the amount)

> Jazākum Allāhu khayran. Thank you for supporting Meeras. Your contribution helps keep Islamic Wills free for every Muslim family in Australia who needs one. Stripe will email you a receipt from wizinsights, the company that runs Meeras; Meeras receives no card details. Meeras is not a registered charity, and contributions are not tax-deductible.

**Meeras Support - 5**

> Jazākum Allāhu khayran. Thank you for the coffee. It goes towards the evenings of fixes and replies that keep Meeras accurate and free for every family who needs it. Stripe will email you a receipt from wizinsights, the company that runs Meeras; Meeras receives no card details. Meeras is not a registered charity, and contributions are not tax-deductible.

**Meeras Support - 15**

> Jazākum Allāhu khayran. Thank you for helping keep meeras.com.au at its address, so every family who looks for a free Islamic Will can find it. Stripe will email you a receipt from wizinsights, the company that runs Meeras; Meeras receives no card details. Meeras is not a registered charity, and contributions are not tax-deductible.

**Meeras Support - 50**

> Jazākum Allāhu khayran. Thank you for helping keep Meeras online. Your contribution goes towards the hosting that keeps Islamic Wills free for every Muslim family in Australia. Stripe will email you a receipt from wizinsights, the company that runs Meeras; Meeras receives no card details. Meeras is not a registered charity, and contributions are not tax-deductible.

Optional closing line for any of them, as on the Support Meeras page:

> جَزَاكَ اللَّهُ خَيْرًا · May Allah reward you with goodness.

Note: Stripe emails a receipt only when "Successful payments" is on under
Settings → Business → Customer emails. If it is off, remove the receipt
sentence from the messages.
