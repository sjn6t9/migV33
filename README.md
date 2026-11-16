# MAM & MAM Overseas Ltd. — Recruiting Portal

Recruiting licence **RL 1217** · Destinations: Saudi Arabia, Malaysia, Fiji

React 19 front end (icons from `react-icons`, all inline SVG, no PNG icons) and a Node.js back end built only on Node's built-in modules.

## What's inside

| Area | Features |
|---|---|
| Languages & theme | Whole site in English (default), বাংলা, العربية (right-to-left), हिन्दी and Vosa Vakaviti; picker and Day/Night switch in the top bar. Translations live in `i18n/<code>.tsv` (`index|text`, `P<index>` for patterns) against `i18n/keys.json`; `npm run build` turns them into `dist/i18n/<code>.json`. Text typed in by users stays as written. |
| Public site | Job share photocards (1080×1350 PNG) with Facebook/WhatsApp link previews at `/job/<id>`; home with search, job board with filters, job details, services, track status (passport + mobile), about, blog, contact, chat assistant, WhatsApp button |
| Job seeker | Registration with email verification code, profile + photo + passport + CV uploads, 3-step application (job → profile → apply), BMET clearance with document uploads, clearance card download, saved jobs, job alerts |
| Employer | Company profile and verification, post / edit / pause / close jobs (reviewed by the agency), applicants with status changes, CV download, packages |
| Agent | Profile with photo, NID and trade licence, workers, BMET clearance with documents, job applications for workers, air ticket requests, account statement and payment reporting, clearance card download |
| Admin / staff | Overview, accounts, job moderation, applications, BMET clearance (Pending → Received → Send to BMET → Section → AD → DD → Director → ADG → Final Approval → Approved, then upload clearance card + fee), air tickets, agent ledger, packages, website content (testimonials, team, gallery), blog, SEO, site + email settings, messages, staff accounts with permissions |

> The code lives on the `mam-overseas` branch of `sjn6t9/migV33`, separate from the Migv33 app on `main`.

## How it runs

- `server/server.js` serves the site and the API on `127.0.0.1:PORT` (default 3100) behind nginx or Caddy.
- Data: `DATA_DIR/db.json` (saved atomically after every change, daily backups kept for 14 days in `DATA_DIR/backups`) and uploaded files in `DATA_DIR/files`.
- Every change goes through `POST /api/act`; the server checks the signed-in account's role and permissions. Files are served only to people allowed to see them.
- Passwords are hashed with scrypt; sessions are HttpOnly cookies.
- Verification emails are sent through the SMTP mailbox set in **Admin › Site settings › Email sending** (needs the `nodemailer` package, installed by `npm install`).

## Install on the VPS (Ubuntu, as root)

```bash
curl -fsSL https://raw.githubusercontent.com/sjn6t9/migV33/mam-overseas/deploy/install.sh | bash -s -- mam.migv33.tech
```

The installer prints a one-time link (`https://mam.migv33.tech/#setup-…`) to create the admin account. It runs again safely to repair or update. After that the server checks GitHub every 2 minutes and updates itself.

Useful commands on the server:

```bash
systemctl status mam-overseas          # is it running?
journalctl -u mam-overseas -n 100      # recent log
cat /etc/mam-overseas.env              # port, data folder, setup code
ls /var/lib/mam-overseas/backups       # daily database backups
```

## Change the code

```bash
npm install            # once
npm run build          # writes dist/index.html
npm start              # http://127.0.0.1:3100
```

Commit `dist/index.html` together with the source; the server uses the built file.

Settings in `.env` or `/etc/mam-overseas.env`: `PORT`, `HOST`, `DATA_DIR`, `SETUP_TOKEN`, optional `ADMIN_EMAIL` + `ADMIN_PASSWORD` (creates the first admin at start), optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Never commit `.env`.

Countries are listed in `src/constants.js` (`COUNTRIES`).
