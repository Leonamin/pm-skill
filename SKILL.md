---
name: pm-skill
description: Structured project management CLI — Linear + Notion integration. Trigger on: pm-skill, Linear issue, Notion doc, start-feature, report-bug, push-doc, backlog
---

# PM Skill — Structured Project Management

Linear + Notion integration for structured project management.
"Design freedom, usage discipline" — only labels/templates/severity defined in `config.yml` are allowed.

## Rules

- When the user mentions **pm-skill**, **Linear issue**, **Notion document**, **start-feature**, **report-bug**, **backlog**, or **push-doc**, use this skill.
- If the user writes `/pm-skill <args>`, execute `npx pm-skill <args>` from the project root.
- This skill requires **shell execution** and **network access** (Linear/Notion APIs).
- If `.env` does not exist, run `npx pm-skill init` first.

## Prerequisites

Requires Node.js 18+. If `.env` does not exist in the project, run `init` first.

## Setup

```bash
# Initialize in project directory (validates keys, creates .env + config.yml)
npx pm-skill init --linear-key <key> --notion-key <key>

# Verify label matching
npx pm-skill setup

# Create missing labels in Linear
npx pm-skill setup --sync

# Install as Codex global skill (optional)
npx pm-skill install-codex-skill
```

## Commands

### setup [--sync]
Verify Linear/Notion connection + label matching. `--sync` creates missing labels.
```bash
npx pm-skill setup
```

### select-project / select-page
Switch active Linear project or Notion root page.
```bash
npx pm-skill select-project "Project Name"
npx pm-skill select-page "Page Name"
```

### start-feature
Start feature development. Creates Linear issue with task checklist.
```bash
npx pm-skill start-feature "Feature title"
```

### report-bug
File bug report. Severity maps to Linear priority.
```bash
npx pm-skill report-bug "Bug title" --severity high
# severity: urgent, high, medium (default), low
```

### add-task
Add sub-task to an issue.
```bash
npx pm-skill add-task ENG-10 "Write unit tests"
```

### relate / block
Link or set blocking relationship between issues.
```bash
npx pm-skill relate ENG-10 ENG-11 --type related
npx pm-skill block ENG-10 ENG-11
```

### push-doc
Upload markdown to Notion. Optionally link to a Linear issue.
```bash
# From file
npx pm-skill push-doc ./design.md --title "Design Doc" --issue ENG-10

# From content (AI agent use case)
npx pm-skill push-doc --title "Report" --content "# Results..." --issue ENG-10

# Under a specific parent page
npx pm-skill push-doc ./schema.md --parent <page-id>
```

### update-doc
Replace existing Notion page content with new markdown.
```bash
npx pm-skill update-doc <page-id> ./updated.md
npx pm-skill update-doc <page-id> --content "# Updated..."
```

### create-folder
Create Notion page as a category/folder.
```bash
npx pm-skill create-folder "Schema Docs" --parent <page-id>
```

### attach-doc
Attach a document URL to an issue with type validation.
```bash
npx pm-skill attach-doc ENG-10 \
  --url "https://notion.so/..." \
  --title "Design Doc" \
  --type source-of-truth
# type: source-of-truth, issue-tracking, domain-knowledge
```

### get
Show issue details including sub-issues, relations, and attachments.
```bash
npx pm-skill get ENG-10
```

### delete
Delete issue(s) and linked Notion pages.
```bash
npx pm-skill delete ENG-10
npx pm-skill delete ENG-10 --recursive   # also delete sub-issues
```

## Workflow Examples

### Feature Development
```bash
npx pm-skill start-feature "Booking cancellation"
npx pm-skill add-task ENG-10 "API endpoint"
npx pm-skill add-task ENG-10 "Frontend UI"
npx pm-skill push-doc ./design.md --issue ENG-10
npx pm-skill relate ENG-10 ENG-8 --type related
```

### Bug Fix
```bash
npx pm-skill report-bug "Payment error" --severity high
npx pm-skill add-task ENG-20 "Root cause analysis"
npx pm-skill add-task ENG-20 "Fix and test"
```

### Document Management
```bash
npx pm-skill create-folder "Schema Docs"
npx pm-skill push-doc ./schema.md --parent <folder-id>
npx pm-skill update-doc <page-id> ./schema-v2.md
```
