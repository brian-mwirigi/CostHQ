# Future Checkout Details

*Drop your Polar API / Checkout details and notes here.*

## Polar API Key
**Key:** `polar_oat_aEHat4bwamGtScVBb7qXmTmi2I9kX8BexIaHp11ZW1L`
*(Store this securely in your `.env.local` file when you start building the backend. Do not commit it to version control.)*

## Recommended API Key Scopes
When creating your Polar API key for a standard checkout/SaaS integration, you **do not** need to check every single box. For security (Principle of Least Privilege), I recommend selecting only the following scopes:

- `checkouts:read` & `checkouts:write` (To generate checkout sessions for users)
- `customers:read` & `customers:write` (To create/manage customers in Polar)
- `orders:read` (To verify successful payments)
- `subscriptions:read` (To check if a user has an active Pro subscription)
- `webhooks:read` (Optional, if you want to manage webhook endpoints via API)

**Expiration:** 
Set this to "Never" (if available for production) or the maximum allowed, unless you have a secret rotation system built. 

Name it something like `costhq-prod-checkout`.

## Recommended Webhook Events
When we are ready to build the backend, you will need to create a webhook so Polar can tell your server when someone pays. 

**Wait to create this** until we actually build the API route (because Polar requires a valid `URL` like `https://brianmunene.me/api/webhooks/polar` to save it).

When we do create it, these are the essential events to check:
- `order.created` & `order.paid` (To grant access for lifetime/one-off purchases)
- `subscription.created` & `subscription.active` (To upgrade a user to Pro)
- `subscription.canceled` & `subscription.revoked` (To downgrade a user when they stop paying)
- `refund.created` (To revoke access if they refund)
