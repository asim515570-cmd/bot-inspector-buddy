# Telegram storefront bot — roadmap

Reference: uploaded blueprint (dodi-store-bot-blueprint.md) — used as an idea only.
Goal: build the whole system A to Z and make it better than the reference.
Do not copy the original project's source or exact wording.

- [x] Step 1 — Secure webhook foundation (secret-token check, connector gateway, update log)
- [x] Step 2 — Data model: bot_users, products, stock_items, orders
- [x] Step 3 — Telegram product browsing + admin product/stock commands
- [ ] Step 7 (brought forward) — Web admin dashboard: sign-in + product & stock CRUD  ← in progress
- [ ] Step 4 — Checkout: quantity, checkout sessions with expiry, atomic stock reservation
- [ ] Step 5 — Payments: provider verification, duplicate-txid protection, manual review queue
- [ ] Step 6 — Wallet balance + transaction ledger, referrals, withdrawal requests
- [ ] Step 8 — Abuse prevention: per-user rate limiting, banned users, private-chat enforcement
- [ ] Later — flash sales, bulk discounts, notifications/back-in-stock, group announcements,
      order/user/payment/withdrawal views in the dashboard, backups, API tokens
