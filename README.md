# Migv33

Chat rooms, gifts, UNO, friends, feed, coins (for fun only, no real money).

Files: `server.js`, `package.json`, `public/index.html`, `connect-repo.sh`.
Run: `npm install && JWT_SECRET=change-me PORT=3000 node server.js`
The account with username `migv33` is Staff (with the verified badge). Set STAFF_EMAIL in .env to the owner email so only that email can register it. Staff can set any role and moderate; Admins can kick, ban and silence users in public rooms.

## Teen Patti Gold (Legendary room)
Fun-only card game with virtual coins (no cash value, no purchases or cash-outs). Files: `teen-patti.cjs` (engine) + `server.js` (wallet/room wiring). The `legendary` room is created automatically; the table opens when someone taps Start (`!start`). Boot defaults to 10 coins (`TP_BOOT` env), no house fee.

## Cricket Bot (cricket room)
`cricket-bot.cjs` (engine) is wired into `server.js` for the `cricket` room (created automatically). Commands: `!start`, `!start <amount>`, `!j`, `!d`. Entry fee is charged when the game starts; winner gets 90% of the pot. Fees count as game spending for Merchant points and trail commission.

## LowCard Bot (lowcard room)
`lowcard.cjs` (engine) + `server.js` wiring for the `lowcard` room (auto-created). Commands: `!start [amount]`, `!j`, `!d`, `!bal`, `!top`; staff/admin: `/bot lowcard [entry]`, `/bot stop`. Lowest card is OUT, ties get tie-break rounds, winner takes the pot minus 10% rake. Entries are journaled in `lc_pending`; after a crash they are refunded at the next start.

## Royale Battle (royale room)
`royale-battle.cjs` (engine, unchanged) + `server.js` wiring (coins and pending bets live in SQLite: table `rb_pending`, refunded at the next start after a crash). Room `royale`: the bot is added automatically on the first `!` command; staff/admin type `!start`. Player: `!bet red 500`, `!bet double run 1k`, `!bal`, `!top`. Staff: `/bot royalebattle`, `/bot stop`.

## Game bots in any room, room roles, auto-leave
- `/bot cricket|lowcard|dice` (room admin, moderators, super moderators, staff/admin) and `/bot teenpatti|royalebattle` (staff/admin) turn a game on in the current room; `/bot stop` turns it off. One game per room. Game rooms (legendary, cricket, lowcard, royale) start with their game.
- Dice Bot: `dice.cjs`. `!start [amount]`, `!j`, `!d` (two dice, highest total wins, ties roll again).
- `/smod` and `/dsmod`: Super Moderator = everything the room admin can do except changing the admin.
- Staff: Admin Panel → Manage rooms (rename, user limit). Normal users leave a room automatically 30 minutes after joining; admin/moderators/staff stay.
