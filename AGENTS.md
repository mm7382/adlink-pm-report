# Agent Instructions: ADLink PM Bot

This project is a local ADLink PM assistant using Telegram, Excel/Numbers inputs, email/report generation, and persistent memory.

## Safety

- Do not read, print, upload, or summarize `.env`.
- Treat source spreadsheets, generated reports, backups, and memory JSON files as private business data.
- Use `.safe-scan-ignore` before running code graph or security scanning tools.
- Do not commit `.env`, memory files, source spreadsheets, generated reports, or backups.

## Local Tools

- Use `agentmemory` for cross-session memory, report preferences, and project context. The local service is `com.agentmemory.service` on `http://localhost:3111`.
- Use CodeGraph for code structure questions. This project has `.codegraph/`; prefer `codegraph context --path "/Users/michaelchuang/AD/ADLink_PM_bot" <task>` before reading many files.
- Use Understand-Anything for broad project/document understanding on safe shadow copies only.
- Use cybersecurity skills for `.env`, token, spreadsheet/report privacy, `.gitignore`, and scan-safety checks. Never output secret values.
- Use mattpocock skills for review, diagnose, TDD, refactor planning, triage, and engineering workflow tasks.

## Important Areas

- `bot.js`, `local.js`: bot and offline entry points.
- `core/`: router, config, AI, PM agent, Excel rules.
- `agents/`: specialized agent logic.
- `tools/`: Excel scanning, HTML report generation, file/memory tools.
- `memory/`: private persistent memory.
- `output/`: generated reports.

## Verification

```bash
npm start
```

Safe scan:

```bash
rm -rf /tmp/adlink-pm-bot-safe-scan
mkdir -p /tmp/adlink-pm-bot-safe-scan
rsync -a --exclude-from=.safe-scan-ignore ./ /tmp/adlink-pm-bot-safe-scan/
```
