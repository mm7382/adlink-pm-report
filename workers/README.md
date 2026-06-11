# ADLINK PM Telegram Notify Worker

This Cloudflare Worker lets the GitHub Pages app keep its existing public URL
while sending login and report activity notifications to Telegram.

The public app URL stays:

```text
https://mm7382.github.io/adlink-pm-report/
```

## Deploy

Install or run Wrangler:

```bash
npx wrangler deploy workers/telegram-notify-worker.js --name adlink-pm-notify
```

Set secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN --name adlink-pm-notify
npx wrangler secret put TELEGRAM_NOTIFY_CHAT_ID --name adlink-pm-notify
npx wrangler secret put ALLOWED_ORIGIN --name adlink-pm-notify
```

Use this value for `ALLOWED_ORIGIN`:

```text
https://mm7382.github.io
```

After deployment, copy the Worker URL, for example:

```text
https://adlink-pm-notify.<your-subdomain>.workers.dev
```

Then set `NOTIFY_ENDPOINT` in `docs/index.html` to:

```text
https://adlink-pm-notify.<your-subdomain>.workers.dev
```

## Telegram Chat ID

Send this to the ADLink_PM Telegram bot:

```text
/chatid
```

Use the returned number as `TELEGRAM_NOTIFY_CHAT_ID`.

## Notifications Sent

- `login`
- `login_failed`
- `logout`
- `analyze_started`
- `analyze_failed`
- `report_generated`
- `download_report`
