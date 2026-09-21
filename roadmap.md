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
- [x] Step 8 — Abuse prevention (DB-backed per-user flood limit: 20 actions/10s, 30s cooldown)
- [x] Overview section: 14-day sales chart, best sellers, admin activity log
- [x] Broadcast section + add stock codes directly from the Stock section
- [ ] Later — flash sales, bulk discounts, notifications/back-in-stock, group announcements,
      withdrawal views in the dashboard, backups, API tokens
- [x] Dashboard: stats, orders, customers (roles, block, balance), shop settings, broadcast

## New requests (Sep 18)
- [x] Telegram admin panel (/panel, /payments, /withdrawals, /credit, /debit, /whois, /ban,
      /unban, /broadcast) with instant customer notifications on every decision
- [x] Referrals: referral code, invite link, automatic commission on referred purchases
- [x] Withdrawal requests: /withdraw holds the amount, admin approves/rejects in bot or dashboard
- [x] Professional storefront: categories, sale prices, single-message navigation, demo catalogue

## New (screenshot-driven bot UX)
- [x] Dashboard sections: Products, Stock levels, Orders, Customers, Referrals, Payouts, Bot status, Settings
- [x] Product list buttons: "Name | $price (stock)" + Prev / page / End + Refresh + Back
- [x] Product detail: Price per code, Stock, Sold, description + delivery instructions blocks, Buy Now / Back to Store
- [x] Quantity select screen (1,2,3,5,10,15,20,25 + custom amount)
- [x] Order summary screen (qty, price each, total) -> Choose payment method
- [x] Payment method screen: methods configurable from dashboard, per-method instructions screen with Back / Cancel Order
- [x] Bot command menu: /start /menu /help via setMyCommands
- [x] Dashboard: edit category, sale price, delivery note, sort order, payment methods
- [x] Full command menu (setMyCommands): /start /menu /help /admin /products /addproduct /setprice /flashsale /flashsales /stopflashsale /setactive /setdesc /setemoji /addstock /stock /clearstock /delproduct /payments /approve_pay /redeliver_pay /reject_pay /withdrawals /approve_wd /reject_wd /whois /credit /debit /ban /unban /broadcast /backup
- [x] New admin commands: /admin help, /products, /flashsale (timed sale price), /flashsales, /stopflashsale, /redeliver_pay, /backup

## Sep 18 (live)
- [x] Restore live Telegram replies and verify /start plus menu buttons end-to-end
- [ ] Publish app and register Telegram webhook so real orders/payments/referrals reach the dashboard
- [ ] New welcome screen layout (Shop / My Profile / Deposit / Developer API / Support / Refer & Earn) per screenshot
- [ ] Replace demo catalogue with real products + real stock (admin supplies payloads)
- [x] Add clearly labelled random testing stock and confirm every product has a description
- [x] Remove the Telegram category chooser; Shop now opens the complete paginated product list
- [x] Match the product-list controls with pagination, Refresh, Back and Menu inline buttons
- [x] Match reference colors and density: blue product/navigation buttons, green Refresh, 15 products per page

- [x] Remove category selection from every live bot and website shop entry point

- [x] Enable Telegram’s permanent chat Menu button and re-sync bot commands

- [x] Show only /start, /menu, /help to customers and scope admin commands to current Telegram admins

## Security hardening (done 2026-09-17)
- Removed self-service admin bootstrap; roles only granted by an existing admin.
- Shared `src/lib/security.server.ts`: DB-backed admin check, per-account + per-action rate limits, audit log, safe error wrapper.
- Rate limits on product save/delete, stock add/delete/clear, order update, customer update, settings, broadcast, payout decisions, bot sync.
- Audit log entries for product/stock/customer changes and denied admin attempts.
- Raw database errors no longer returned to the browser.
- Security headers (CSP, HSTS, nosniff, frame, referrer, permissions) on every response.
- DB: unique `telegram_updates.update_id` (replay/duplicate protection), check constraints on prices, quantities, balances, payout amounts and statuses.

Still outside app control: external pen-testing, provider-level DDoS/WAF, Telegram account security (2FA on the bot owner account).
