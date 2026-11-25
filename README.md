# Dreamers FA — club website & player management

Official website for **Dreamers Football Association (Dreamers FA)**, with online player registration and an admin panel to manage players, locations and monthly fees.

## Features

**Public website** (`/`)
- Home page with hero, club stats, news, fixtures & results, age-group teams, training centres with fees, about section
- Standalone **player registration form** (`/register`), a page on its own to share with parents: parents choose a training centre and fill in name, birth date (age and age group are calculated automatically), standard (class), blood group and playing position (**Fresher** for new players). These are required, along with guardian details for under-18s

**Club admin** (`/admin`)
- **Download app**: the site can be installed on phones and computers as an app (crest icon, opens full screen). *Download app* buttons install it on Android/Chrome/Edge and show the steps on iPhone (Share → Add to Home Screen)
- **WhatsApp group**: paste the group invite link in Admin → Settings. Parents then get a *Join our WhatsApp group* button right after registering, and *Registrations → Group link* sends it to a parent with a welcome message
- **Notifications** (push, like any phone app): parents and players tap *🔔 Get notifications* on the website/app and choose their child's training centre.
  - **Practice today**: each family gets the reminder for their own centre, e.g. "Practice today @ 5 – 7 PM (U8–U12) at Bhakshala", built from that centre's training timings for today (India time). Send it from Admin → Notifications, or turn on *Send automatically every morning at 7:30 AM* (needs `CRON_SECRET`, see below)
  - **Announcements**: write a title and message (or start from *Latest news*, *Next match*, *Training cancelled*, *Registrations open*), choose which page opens when tapped, and send to everyone
  - **Admin alerts**: in Admin → Notifications, *Turn on alerts* on your phone to be notified of every new registration
  - On iPhone, notifications work once the app is added to the Home Screen (iOS 16.4+)
- **Registrations**: every form parents submit appears here automatically, with all details in one table (submitted date, player, birth date and age, standard, blood group, position, centre, parent and mobile, medical notes). Each row has **Approve**, **Edit** and **Delete**. Use *Copy form link* / *Share form* to send the form to parents on WhatsApp, and *Export* to get a spreadsheet
- **Dashboard**: active / pending players, paid vs unpaid for any month, money collected and outstanding, breakdown by location and age group
- **Find any player**: the search box above every admin page finds anyone (new, active or ex-player) by name, phone or parent's name
- **Ex-players** (kept for records): *🗂 Make ex-player* on any player, new registration or player page, or tick several on the Players page and *Make ex-players*. Records the date and reason; details and payments are kept, they stay searchable and exportable, and *↩ Re-join* brings them back
- **Tick and act**: rows have no buttons; on Players, Registrations and Ex-players, tick one or more players and use the bar at the bottom: *Approve* (new registrations), *Group link* (Registrations, one player), *Add to Ex-players* (or *Re-join*), *Edit* (one player: full form; several: change centre, status, position or standard together) and *Delete*. Clicking a player's name opens their page
- **Players**: search and filter by location, age group (U8–U18, Senior), status and fee status; add, edit, approve and delete players; export to CSV (opens in Excel)
- **Fees**: pick a month and mark each player **paid / unpaid** with one click; full payment history per player (amount, date, Cash/UPI/Bank…); per-player fee override for discounts or scholarships
- **WhatsApp fee reminders**: a *Remind* button next to every unpaid player and a *Remind unpaid* list for the whole month. WhatsApp (app or WhatsApp Web) opens with a personalised message, already addressed to the guardian for under-18s and to the player for adults; you press send. Each reminder is logged ("Reminded 2× · 21 Nov"). Edit the message and the default country code in Admin → Settings. It uses free click-to-chat links, so no WhatsApp Business account is needed
- **Locations**: training centres with address, a Google Maps link (paste the exact pin from Google Maps → Share; without one, the site links to a Google Maps search) and **training timings**: one row per session with days, start/end time, age group and an optional note. Centres without timings show "To be announced" on the website. A monthly fee can be stored but is never shown publicly
- **News** and **Fixtures/Results**: edit what appears on the website
- **Settings**: change admin password

## Run it

Requires **Node.js 22**. Locally the data is kept in a SQLite file in `./data`, so there is nothing else to install.

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
| `DATA_DIR` | Folder for the local database file (default `./data`) |
| `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` | Use a Turso database instead of the local file (required on Vercel) |
| `ADMIN_USER` / `ADMIN_PASSWORD` | First admin account (only used on the first start) |
| `NO_SAMPLE_DATA=1` | Don't create the example locations, news and fixtures |

## Customising

- Club story, contact details and footer: `public/index.html` (and the footer in `public/register.html`)
- Colours: CSS variables at the top of `public/css/style.css`
- Crest/logo: `public/img/logo.webp` (full size) and `public/img/logo-sm.webp` (header)
- Currency symbol: `public/js/common.js` (`CLUB.currency`)

## Deploying to Vercel

Vercel doesn't keep files between requests, so the live site stores its data in **Turso**, a hosted SQLite database with a free plan.

1. **Create the database.** Sign up at [turso.tech](https://turso.tech), then *Create Database* (pick the region closest to India, e.g. Mumbai `aws-ap-south-1`).
   On the database page copy the **URL** (`libsql://…turso.io`), and under *Create Token* create a token and copy it.
2. **Import the project.** Sign up at [vercel.com](https://vercel.com) with GitHub, then *Add New → Project* and import this repository.
   Leave *Framework Preset* as **Other** and the build settings empty (`vercel.json` already configures everything).
3. **Add environment variables** (Project → Settings → Environment Variables, or on the import screen):

   | Name | Value |
   | --- | --- |
   | `TURSO_DATABASE_URL` | the `libsql://…` URL from step 1 |
   | `TURSO_AUTH_TOKEN` | the token from step 1 |
   | `ADMIN_USER` | your admin username, e.g. `admin` |
   | `ADMIN_PASSWORD` | a strong password; this is your admin login |
   | `CRON_SECRET` | optional: any long random text. Needed only for the automatic 7:30 AM practice reminders (Vercel Cron uses it) |

4. **Deploy.** The tables, the three centres and the admin account are created automatically on the first visit.
   Open `https://<your-project>.vercel.app/admin` and log in.

Notes:
- Vercel deploys the repository's **production branch** (usually `main`). Merge your changes into it, or change the branch under Project → Settings → Git.
- After changing an environment variable, redeploy (Deployments → ⋯ → Redeploy).
- `ADMIN_PASSWORD` is only used to create the first admin account. Change the password later in Admin → Settings.
- Back up your data from the Turso dashboard, or export players as CSV from the admin panel.
- To use your own domain (e.g. `dreamersfa.in`), add it under Project → Settings → Domains.

Other Node hosts (Render, Railway, a VPS) also work: either set the Turso variables, or give the app a persistent disk for `DATA_DIR`.

## Project layout

```
src/server.js     Express server + API (exports the app; `npm start` runs it locally)
src/db.js         Database (local SQLite file or Turso), schema, first-run setup
api/index.js      Vercel entry point
vercel.json       Vercel settings (static pages from public/, /api/* to the Express app)
public/           Website, registration page and admin panel (plain HTML/CSS/JS)
```
