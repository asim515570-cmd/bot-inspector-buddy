# Telegram storefront bot — roadmap

Reference: uploaded blueprint (dodi-store-bot-blueprint.md) — used as an idea only.
Goal: build the whole system A to Z and make it better than the reference.
Do not copy the original project's source or exact wording.

- [x] Step 1 — Secure webhook foundation (secret-token check, connector gateway, update log)
- [x] Step 2 — Data model: bot_users, products, stock_items, orders
- [x] Step 3 — Telegram product browsing + admin product/stock commands
- [x] Step 7 (brought forward) — Web admin dashboard: sign-in + product & stock CRUD
- [x] Step 4 — Checkout: atomic stock reservation, pay-from-balance, order lifecycle
- [~] Step 5 — Payments: manual review queue done (mark paid / deliver / cancel / refund);
      exchange auto-verification + duplicate-txid protection still pending
- [~] Step 6 — Wallet balance + ledger done (admin top-up, refunds, spend at checkout);
      referrals and withdrawal requests still pending
- [ ] Step 8 — Abuse prevention: per-user rate limiting, banned users, private-chat enforcement
- [ ] Later — flash sales, bulk discounts, notifications/back-in-stock, group announcements,
      withdrawal views in the dashboard, backups, API tokens
- [x] Dashboard: stats, orders, customers (roles, block, balance), shop settings, broadcast

## New requests (Sep 18)
- [ ] Telegram admin panel: orders / balance / payments review inside the bot, with
      instant customer notification when an admin confirms, delivers, cancels or refunds
- [ ] Referrals: referral code + invite link, commission on referred purchases
- [ ] Withdrawal requests: customer requests payout, admin approves/rejects from dashboard
- [x] Professional storefront: categories, sale prices, single-message navigation, demo catalogue
