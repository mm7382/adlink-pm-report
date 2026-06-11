# ADLink PM Report

Secure web uploader for ADLink PM Excel reports.

## Local start

```bash
npm ci
WEB_ADMIN_USERNAME=Michael.Chuang WEB_ADMIN_PASSWORD=Michael.Chuang npm run start:web
```

Open http://localhost:3000/login.

## Render deployment

This app needs a Node.js backend for Excel upload and report generation, so it cannot run on GitHub Pages.

Use `render.yaml` as the Render Blueprint:

```text
https://render.com/deploy?repo=https://github.com/mm7382/adlink-pm-report
```

Required environment variable:

```bash
WEB_ADMIN_PASSWORD=your-strong-password
```

The default admin username is:

```bash
Michael.Chuang
```

Render will provide a permanent HTTPS URL such as:

```text
https://adlink-pm-report.onrender.com
```

## Data notes

Uploaded files and generated reports are temporary and are cleaned after the configured retention period.
User accounts created through the UI are stored in `data/web-users.json` on local installs. On free cloud services with ephemeral filesystems, use environment variables for the admin account or add a persistent datastore before relying on UI-created users across redeploys.

## Telegram notifications

The Node.js web server can notify your ADLink PM Telegram bot when users log in, log out, create users, or generate reports.

Set these environment variables:

```bash
TELEGRAM_BOT_TOKEN=your-bot-token
TELEGRAM_NOTIFY_CHAT_ID=your-chat-id
```

Do not put the Telegram bot token in the GitHub Pages static app. Static frontend code is public and cannot safely protect secrets.
