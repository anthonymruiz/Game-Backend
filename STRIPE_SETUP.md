# Stripe point-package checkout

Configure these backend environment variables before enabling point-package checkout:

- `STRIPE_SECRET_KEY`: a Stripe secret key (`sk_test_...` in development).
- `STRIPE_WEBHOOK_SECRET`: the signing secret for the webhook endpoint.
- `FRONTEND_URL`: the public frontend origin (for example, `https://game.example.com`).

Create a Stripe webhook endpoint at `POST /api/store/stripe/webhook` and subscribe to:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`

For local development, forward Stripe CLI events to `http://localhost:3000/api/store/stripe/webhook` and set `STRIPE_WEBHOOK_SECRET` to the signing secret reported by `stripe listen`.

Point packages use their configured USD amount and points from the database. `StripePriceUrl` stores an optional Stripe Price ID (`price_...`); when blank, Checkout creates an inline one-time USD price from the package. If a Price ID is configured, the backend verifies that it is active, one-time, USD-denominated, and has the same amount as the package before creating Checkout.

Points are granted only after the backend verifies Stripe's signed webhook or retrieves the Checkout Session and validates that it is paid, belongs to the authenticated user, and matches the saved package, amount, and currency. Payment/session IDs are stored and crediting is transactional and idempotent.
