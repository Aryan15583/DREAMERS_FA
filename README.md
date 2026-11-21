# Dreamers FA — club website & player management

Official website for **Dreamers FA** (blue & white), with online player registration and an admin panel to manage players, locations and monthly fees.

## Features

**Public website** (`/`)
- Home page with hero, club stats, news, fixtures & results, age-group teams, training centres with fees, about section
- Online **player registration** (`/register`): player chooses a training centre (location); age group is worked out from date of birth

**Club admin** (`/admin`)
- **Dashboard**: active / pending players, paid vs unpaid for any month, money collected and outstanding, breakdown by location and age group
- **Players**: search and filter by location, age group (U8–U18, Senior), status and fee status; add, edit, approve and delete players; export to CSV (opens in Excel)
- **Fees**: pick a month and mark each player **paid / unpaid** with one click; full payment history per player (amount, date, Cash/UPI/Bank…); per-player fee override for discounts or scholarships
- **WhatsApp fee reminders**: a *Remind* button next to every unpaid player and a *Remind unpaid* list for the whole month. WhatsApp (app or WhatsApp Web) opens with a personalised message, already addressed to the guardian for under-18s and to the player for adults; you press send. Each reminder is logged ("Reminded 2× · 21 Nov"). Edit the message and the default country code in Admin → Settings. It uses free click-to-chat links, so no WhatsApp Business account is needed
- **Locations**: training centres with address, schedule and monthly fee
- **News** and **Fixtures/Results**: edit what appears on the website
- **Settings**: change admin password

## Run it

Requires **Node.js 22.13+** (uses the built-in SQLite, so there is no database to install).

```bash
npm install
npm start          # http://localhost:3000
```

On first start an admin account is created: username `admin`, password `dreamers123`.
**Change it right away** in Admin → Settings, or set it before the first start:

```bash
ADMIN_USER=coach ADMIN_PASSWORD='a-strong-password' npm start
```

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Folder for the SQLite database (default `./data`) — back this up |
| `ADMIN_USER` / `ADMIN_PASSWORD` | First admin account (only used on the first start) |
| `NO_SAMPLE_DATA=1` | Don't create the example locations, news and fixtures |

## Customising

- Club story, contact details and footer: `public/index.html` (and the footer in `public/register.html`)
- Colours: CSS variables at the top of `public/css/style.css`
- Crest/logo: `public/img/logo.webp` (full size) and `public/img/logo-sm.webp` (header)
- Currency symbol: `public/js/common.js` (`CLUB.currency`)

## Deploying

Any host that runs Node works (Render, Railway, a VPS). The database is a single file in `DATA_DIR`, so give it a **persistent disk** and serve the site over HTTPS.

## Project layout

```
src/server.js     Express server + API
src/db.js         SQLite schema, first-run setup
public/           Website, registration page and admin panel (plain HTML/CSS/JS)
```
