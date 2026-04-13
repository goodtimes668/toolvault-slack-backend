# 🔧 ToolVault Pro — Slack App

Tool tracking and rental management — directly inside Slack.

---

## What It Does

| Command | Action |
|---|---|
| `/tv-status` | Dashboard with live stats + overdue alerts |
| `/tv-tools` | Full tool inventory list |
| `/tv-tools available` | Only available tools |
| `/tv-tools damaged` | Flagged / damaged tools |
| `/tv-tools [name]` | Search by tool name |
| `/tv-checkout` | Opens checkout form (modal popup) |
| `/tv-checkin` | Opens check-in form (modal popup) |
| `/tv-rentals` | All active rentals |
| `/tv-overdue` | Overdue rentals only |
| `/tv-help` | List all commands |

---

## Setup — Step by Step

### STEP 1 — Deploy the Backend

You need a public URL for Slack to send events to. Vercel is the easiest free option.

**Option A — Vercel (recommended, free)**

1. Create a free account at https://vercel.com
2. Install the Vercel CLI:
   ```
   npm install -g vercel
   ```
3. In this project folder, run:
   ```
   vercel
   ```
4. Follow the prompts. Vercel gives you a URL like `https://toolvault-abc123.vercel.app`
5. Save that URL — you'll need it in Step 2

**Option B — Railway (also free)**
1. Go to https://railway.app
2. Connect your GitHub repo
3. Railway auto-deploys and gives you a URL

---

### STEP 2 — Create the Slack App

1. Go to **https://api.slack.com/apps**
2. Click **"Create New App"**
3. Choose **"From an app manifest"**
4. Select your workspace, click **Next**
5. Switch to the **JSON tab**
6. Open `slack-app-manifest.json` from this folder and paste the contents
7. **Replace `YOUR-DOMAIN.com`** in the manifest with your actual Vercel URL
8. Click **Next → Create**

---

### STEP 3 — Get Your Credentials

After creating the app:

1. In your app's sidebar, go to **Basic Information**
2. Scroll to **App Credentials**
3. Copy your **Signing Secret** → you'll need this as `SLACK_SIGNING_SECRET`

4. Go to **OAuth & Permissions** in the sidebar
5. Click **"Install to Workspace"** → Allow
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`) → this is `SLACK_BOT_TOKEN`

---

### STEP 4 — Get Your Manager Channel ID

This is the Slack channel where overdue and damage alerts will be posted (e.g. `#tools-alerts`).

1. In Slack, right-click the channel you want alerts posted to
2. Click **"View channel details"**
3. Scroll to the bottom — copy the **Channel ID** (looks like `C0XXXXXXXXX`)

---

### STEP 5 — Set Environment Variables

**If using Vercel:**
```
vercel env add SLACK_SIGNING_SECRET
vercel env add SLACK_BOT_TOKEN
vercel env add SLACK_MANAGER_CHANNEL_ID
```

Or set them in the Vercel dashboard under your project → Settings → Environment Variables.

**If running locally:**
```
cp .env.example .env
```
Then open `.env` and fill in:
```
SLACK_SIGNING_SECRET=your_signing_secret
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_MANAGER_CHANNEL_ID=C0XXXXXXXXX
```

---

### STEP 6 — Update the Manifest Slash Command URLs

After deploying and getting your URL:

1. Go back to your app at https://api.slack.com/apps
2. Click **"Slash Commands"** in the sidebar
3. For each command (`/tv-status`, `/tv-checkout`, etc.), edit it and set the **Request URL** to:
   ```
   https://YOUR-VERCEL-URL.vercel.app/slack/commands
   ```
4. Go to **Interactivity & Shortcuts**
5. Make sure it's **On**
6. Set the **Request URL** to:
   ```
   https://YOUR-VERCEL-URL.vercel.app/slack/interactions
   ```
7. Click **Save Changes**

---

### STEP 7 — Invite the Bot to Your Channel

In Slack, go to your alerts channel and type:
```
/invite @ToolVault Pro
```

---

### STEP 8 — Test It

Type `/tv-help` in any Slack channel. You should see the command list appear.
Then try `/tv-status` for your dashboard.

---

## Running Locally (for development)

```bash
# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env

# Start dev server with auto-reload
npm run dev
```

To test locally with Slack, use **ngrok** to expose your local server:
```bash
npx ngrok http 3000
```
Use the ngrok URL as your Slack request URL during development.

---

## Project Structure

```
toolvault-slack-backend/
├── src/
│   ├── server.js              # Express app entry point
│   ├── db/
│   │   └── store.js           # JSON file database (swap for Postgres later)
│   ├── slack/
│   │   ├── api.js             # Slack Web API calls
│   │   ├── blocks.js          # Block Kit message/modal builders
│   │   └── verify.js          # Request signature verification
│   ├── routes/
│   │   ├── commands.js        # Slash command handlers
│   │   └── interactions.js    # Modal submit + button click handlers
│   └── jobs/
│       └── overdueChecker.js  # Hourly overdue rental alerts
├── slack-app-manifest.json    # Paste into api.slack.com to create the app
├── vercel.json                # Vercel deployment config
├── .env.example               # Environment variable template
└── package.json
```

---

## Upgrading the Database

The default store uses a local JSON file — great for getting started, easy to replace.

**Upgrade to PostgreSQL:**
Replace `src/db/store.js` with a `pg` client. All function signatures stay the same — nothing else in the app needs to change.

**Upgrade to MongoDB:**
Same approach using the `mongodb` driver or Mongoose.

---

## Alerts

| Alert Type | Trigger | Where it Posts |
|---|---|---|
| ⚠️ Overdue | Checked every hour, fires once per rental | Manager channel |
| 🚩 Damage | Immediately on check-in when flagged | Manager channel + user DM |

Set `SLACK_MANAGER_CHANNEL_ID` in your environment variables to enable alerts.

---

## Need Help?

1. Check the **Health endpoint**: `https://your-url.vercel.app/health`
2. Check **Vercel logs** for error details
3. Make sure your Signing Secret and Bot Token are correct
4. Ensure the bot is invited to the channel with `/invite @ToolVault Pro`
