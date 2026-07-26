# Deployment guide

## What this app needs (the short answer)

Soapbox is a **long-running Node.js application**. It needs:

| Requirement | Details |
| --- | --- |
| Runtime | Node.js **22.13 or newer** (Node **24 LTS recommended**) |
| Process | One persistent Node process (systemd, Passenger, or a PaaS) |
| Disk | **Persistent** storage for the `data/` directory (SQLite + uploads). A few hundred MB is plenty for years of use. |
| RAM | Modest — runs comfortably in **512 MB**; 1 GB gives headroom |
| CPU | Any. One shared vCPU is fine for hundreds of guests per event. |
| Network | Outbound HTTPS to `api.smtp2go.com` (email); inbound HTTP(S) |
| Database | None to install — SQLite is built into Node |

**Can it run on shared web hosting?**

- ❌ **Classic PHP-only shared hosting (the $3/mo kind): no.** Those plans
  can't keep a Node process running.
- ⚠️ **Shared hosting with Node.js support** (cPanel "Setup Node.js App",
  which uses Passenger — offered by Namecheap, A2, Hostinger, etc.):
  **usually yes.** You need Node ≥ 22.13 selectable in their panel (many
  hosts lag behind — check first), and their storage is persistent, which is
  what SQLite needs. Set the environment variables in the panel instead of
  `.env` if you prefer.
- ✅ **A small VPS: the recommended home.** A $4–6/month instance
  (Hetzner CX22, DigitalOcean 1 GB, Vultr, Linode, Oracle's free tier) is
  more than enough and gives you full control. Full walkthrough below.
- ⚠️ **PaaS (Railway, Fly.io, Render):** works well **only with a persistent
  volume attached** for `data/`. On ephemeral filesystems (Render's free
  tier, Heroku) you would lose all data on every deploy — do not run it
  there without a volume.
- ✅ **A machine you already own** (home server, Raspberry Pi 4/5, office
  NAS with Docker/Node): fine, if you can reach it from the internet
  (or you only send links to people on your network/VPN).

---

## VPS setup, start to finish

Assumes a fresh Ubuntu 24.04 VPS with a domain (we'll use
`invites.example.org`) pointed at its IP via an `A` record.

### 1. System prep

```bash
apt update && apt upgrade -y
adduser --disabled-password --gecos "" app
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

### 2. Install Node 24

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs git
node --version   # should print v24.x
```

### 3. Install the app

```bash
su - app
git clone https://github.com/mydataismydata/soapbox-events.git soapbox
cd soapbox
npm install
npm run build
cp .env.example .env
```

Edit `.env`:

```
BASE_URL=https://invites.example.org
NODE_ENV=production
TRUST_PROXY=1
SMTP2GO_API_KEY=api-XXXXXXXX        # or configure per-org in the UI later
```

Create your first organization (repeat per organization — each gets fully
separate logins, contacts, and events):

```bash
node scripts/create-org.mjs --slug sjc --name "St. James Community" \
  --admin-email you@example.org --admin-name "Your Name"
```

### 4. Run it as a service

As root, create `/etc/systemd/system/soapbox.service`:

```ini
[Unit]
Description=Soapbox event invitations
After=network.target

[Service]
User=app
WorkingDirectory=/home/app/soapbox
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now soapbox
systemctl status soapbox     # should be active (running)
```

### 5. HTTPS reverse proxy (Caddy — automatic certificates)

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install caddy
```

`/etc/caddy/Caddyfile`:

```
invites.example.org {
    reverse_proxy localhost:3000
}
```

```bash
systemctl reload caddy
```

Caddy obtains and renews the TLS certificate automatically. (Prefer nginx?
Any reverse proxy that forwards to `localhost:3000` works — keep
`TRUST_PROXY=1` so rate limiting sees real client IPs.)

Visit `https://invites.example.org/app/` and sign in.

### 6. Backups (do this)

The `data/` directory **is** the application state — databases, uploads,
secrets. Copying it while the app runs is safe for practical purposes
(SQLite WAL); for extra caution schedule it at a quiet hour.

```bash
crontab -e -u app
# nightly at 03:10
10 3 * * * /home/app/soapbox/scripts/backup.sh >> /home/app/backup.log 2>&1
```

Copy `backups/` somewhere off the server (rclone to any cloud storage, or
plain `scp`). To restore: stop the service, unpack the tarball over `data/`,
start the service.

### 7. Updating

Whenever there are new changes on GitHub, redeploy in one step with the
bundled script:

```bash
cd ~/soapbox
./update.sh
```

It pulls the latest code, installs dependencies, rebuilds the admin app,
restarts the service, and waits for the health check to pass. Database
migrations run automatically at startup, so there's nothing else to do.

(First time only — to fetch the script itself — run `git pull` once, then
`./update.sh` from then on.)

Installed before the project was renamed, with the unit called
`sjc-vite.service`? Nothing to do — `update.sh` restarts whichever unit is
actually installed. Set `SOAPBOX_SERVICE=<name>` if yours is called something
else again.

---

## SMTP2GO setup (email delivery)

1. Create an account at smtp2go.com. The free tier (roughly 1,000 emails per
   month — check their current terms) is enough for many community
   organizations; paid tiers scale from there.
2. **Verify a sender domain** (Settings → Sender domains). Add the CNAME/DKIM
   records they show you at your DNS host. This is the single most important
   step for emails landing in inboxes instead of spam.
3. Create an API key (Settings → API Keys) and either:
   - put it in `.env` as `SMTP2GO_API_KEY` (used by all organizations), or
   - paste it into **Settings → Email sending** inside the app for one
     organization (overrides the server-wide key for that organization).
4. In the app's Settings, set the **sender name** and a **sender email on the
   verified domain** (e.g. `invites@example.org`), then use **“Send test
   email”** in the event wizard's review step to confirm delivery.

The dashboard and Settings page show the SMTP2GO cycle usage (used /
remaining / cycle end date) plus a local count of emails sent this month.
Note the SMTP2GO quota is account-wide: if several organizations share one
key, they share the allowance.

No key configured? The app stays in **simulation mode** — every send is
rendered and logged, viewable in each event's email log, nothing delivered.

---

## Scaling notes

This is a deliberately single-node design: one process, SQLite per tenant,
an in-process email queue. For its intended audience — several organizations,
hundreds to low thousands of guests per event — a 1 GB VPS is overkill.
If you ever outgrow it, the seams are clean (the database layer is one
module; the queue is one module), but you are unlikely to.

Uptime tip: `GET /api/health` returns `{"ok":true}` — point any uptime
monitor at it.
