# OpenClaw Rules for Clear Point Senior Advisors

## Default Mode

Read-only first.

Before any task:
1. Confirm current folder.
2. Confirm it is:
 C:\Users\senti\.openclaw\workspace\clearpoint-deploy
3. Read PROJECT_CONTEXT.md.
4. Read OPENCLAW_RULES.md.
5. Report what will be inspected or changed.
6. Wait for approval if editing or deployment is involved.

## Absolute Rules

Do not edit unless explicitly instructed.

Do not deploy unless the user explicitly says:

"I approve production deploy."

Do not change:
- website layout
- text
- chatbot
- forms
- footer
- disclaimers
- carrier logos
- images
- GHL/API
- Vercel settings
- DNS
- environment variables
- dependencies

unless the user explicitly requests that exact change.

## Backup Rule

Before editing any file:

1. Create a timestamped backup folder.
2. Copy every file that will be modified into the backup folder.
3. If backup fails, stop.

No backup = no edit.

## Folder Safety

Only work from:

C:\Users\senti\.openclaw\workspace\clearpoint-deploy

Do not use:
- _clearpoint_final
- app/Telegram
- Downloads projects
- old ZIP extractions
- backup folders
- any other folder

unless the user explicitly approves.

## Command Discipline

Do not run commands the user did not request.

Do not install packages unless explicitly approved.

Do not run npm audit fix unless explicitly approved.

Do not run global scans or searches.

Do not browse the web unless the task requires it.

## Stop Rule

If unsure, stop and ask.

If a task seems risky, stop and report.

If you cannot determine the source of truth, stop and verify.

Never guess.
Never improvise.
Never touch anything outside the approved task.
