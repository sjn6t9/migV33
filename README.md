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

## Daily Lucky Draw (two draws a day)
- Draws open at **12:00 PM and 12:00 AM (Asia/Dhaka)**. Each 12-hour window gives every user **one spin**; a missed window cannot be reclaimed. Level-up bonus spins still work any time.
- Slices (coins are a random number inside the slice range): 500–550, 750–825, 1k–1.1k, 1250–1375, 1.5k–1.65k, 2k–2.2k, 3k–3.3k, 5k–5.5k, 10k–11k, 20k–22k.
- The chance of each slice is weighted (`PRIZES[].w` in `server.js`) so small prizes are much more common. Edit the weights/ranges there.

## Announcements
Admin Panel → **Announcements** (staff only). The newest active announcement pops up once for each user when they open the app, and instantly for users who are online. "Remove" stops it showing for new users.

## Room Edit
Chat room "⋯" menu → **Room Edit** (room admin, super moderators, staff/admin): description, moderators (add/remove) and **minimum level to enter** (0 = everyone; room staff are always allowed in).

## Chat rooms keep no history
Messages are only seen while you are inside (or have the room open as a tab). When the last person leaves a room, all its texts, photos and voice notes are deleted (also once at server start). Re-entering a room shows nothing from before. Private chats (DMs) are not affected.

## Daily XP rules (rolling 24 h)
| Activity | XP each | Max/day |
|---|---|---|
| Post | 100 | 5 (=500) |
| Follow a verified ID | 100 | 5 (=500) |
| Comment on a post | 50 | 5 (=250) |
| Share a post | 50 | 5 (=250) |
| React to a post | 50 | 5 (=250) |
| Play a game (bet/entry) | 5 | 100 (=500) |
| Online time | 5 per full hour | 24 h (=120) |
Own posts don't earn react/comment/share XP. Users with presence "offline" don't earn online XP.

## Security
Settings → MPIN (4–6 digits) and Security question. Login token is kept in localStorage (365 days) so minimising the app never logs out; only the Log out button does.

## Profile (avatar / photo)
- Joined date (users.joined; old users backfilled from first message).
- Create Avatar (emoji + colour, rendered to PNG, stored as users.avatar_art), Avatar/Photo switch (users.avatar_mode), uploaded photo gallery (user_photos, max 12 per user; Use / delete).
- API: GET /api/me/photos, POST /api/me/avatar-mode, POST /api/me/photos/:id/use, DELETE /api/me/photos/:id.

## Roles & limits
- New role `vip` (VIP User, teal "VIP" badge; staff set it via Admin → role). Head Mentor badge = gold "HMT" (`public/badges/hmt.png`, `vip.png`).
- Coin transfer and room creation need Level 20 (staff/admin exempt). Transfer has optional remarks (60 chars).
- If a game bot says "not loaded on the server", the matching `.cjs` engine file is missing next to `server.js`.

## Flat GitHub folder
`server.js` loads game engines as `name.cjs` **or** `name.js`, and serves `index.html` and badge images (`mentor.png`, `Head-Mentor-HMT.png`, `VIP.png` …) from the folder next to it when `public/` does not have them.

## Game tables (LowCard · Cricket · Dice · Royale Battle)
Each game bot now has its own navy-glass table panel in the room (like Teen Patti): LowCard = card seats, Dice = dice faces + totals, Cricket = scoreboard + 6-round bar, Royale = Red vs Blue + chips + special bets. The server pushes `{t:'gp',room,view}` (on join, every second when something changed, and `view:null` when the bot is stopped). Buttons just send the normal `!j`, `!d`, `!start`, `!bet …` commands.
Upload together: server.js, index.html, lowcard.cjs, dice.cjs, cricket-bot.cjs, royale-battle.cjs.
Also: repeated "entered" lines fixed (same-socket re-join no longer announces; 30 s ping keepalive; 90 s reconnect grace).
Join-countdown: glass-break warning sound at 5 s left (WebAudio, plays after the first tap on the page). Cricket ball icons are inline SVG (1/2/3, FOUR, SIX, dot, Caught, LBW, Run out).
Chat commands now answer in the mig33 style: own command echoed, plain/green/red 'Only you' feedback, brown/pink ** action ** lines, coloured gift lines, 'Administration:' notes. /sing uses original verses.
Mail: menu item between Home and Chat Rooms; tables mails/mail_files; endpoints /api/mail*, upload kind=mail (JPG/PNG/PDF, 3 files, 5 MB each); 30 mails/hour.

## Support mail (Admin Panel → 📧 Support Mail)
Staff-only inbox/sent/compose for support@migv33.com. Run `npm install` (adds imapflow + mailparser), then set in the service environment:
`SUPPORT_PASS` (the mailbox password; required). Optional: `SUPPORT_USER` (default support@migv33.com), `SUPPORT_SMTP_HOST`/`SUPPORT_SMTP_PORT` (smtp.hostinger.com/465), `SUPPORT_IMAP_HOST`/`SUPPORT_IMAP_PORT` (imap.hostinger.com/993).
Inbox is checked every 2 minutes and with the Refresh button. Without the packages, sending still works; receiving shows a hint.

## Gift XP
Sending or receiving a gift gives XP by price tier (table GIFT_XP in server.js), kept as exact fractions per user (table gift_xp).

## Emoticons
Built-in original emoticon set (shortcodes like :) :D ;)). Staff can add more under Admin Panel -> Manage emoticons (picture + name + optional shortcode); they work in chat, posts, comments and as post reactions.
