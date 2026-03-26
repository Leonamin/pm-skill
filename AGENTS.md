# PM Skill — Agent Instructions

This file provides instructions for AI coding assistants (Codex, Claude Code, etc.) to use the pm-skill CLI.

## What is pm-skill?

A structured project management CLI that integrates Linear (issue tracking) and Notion (documentation). It enforces a config-driven workflow where only pre-defined labels, templates, and severity levels are allowed.

## Rules

- If the user writes `/pm-skill <args>`, execute `npx pm-skill <args>` from the project root.
- When the user mentions pm-skill, Linear issues, or Notion documents, prefer using pm-skill commands.
- This tool requires shell execution and network access (Linear/Notion APIs).

## Prerequisites

- Node.js 18 or higher (`node --version` to check)
- Linear API key (get from: Linear > Settings > API > Personal API Keys)
- Notion API key (optional, get from: https://www.notion.so/my-integrations)

## First-Time Setup

If `.env` does not exist in the project root, run initialization first:

```bash
# Step 1: Initialize (validates keys, creates .env, config.yml, SKILL.md, AGENTS.md)
npx pm-skill init --linear-key <LINEAR_API_KEY> --notion-key <NOTION_API_KEY>

# Step 2: Verify setup and label matching
npx pm-skill setup

# Step 3 (optional): Create missing labels in Linear
npx pm-skill setup --sync
```

If init fails:
- **"Linear API key validation failed"** — check the key at Linear > Settings > API
- **"No pages shared"** — share a Notion page with the integration first (page menu > Connections)
- **Network error** — check internet connection and retry

## How to Run Commands

```bash
npx pm-skill <command> [args] [flags]
```

## Available Commands

### setup
Verify Linear/Notion connection and show team/label configuration.
```bash
npx pm-skill setup
npx pm-skill setup --sync   # create missing labels in Linear
```

### select-project
List or switch the active Linear project.
```bash
npx pm-skill select-project                    # list projects
npx pm-skill select-project "Project Name"     # switch
```

### select-page
List or switch the active Notion root page.
```bash
npx pm-skill select-page                       # list pages
npx pm-skill select-page "Page Name"           # switch
```

### start-feature
Create a Linear issue with a task checklist.
```bash
npx pm-skill start-feature "<title>"
```

### report-bug
File a bug report with severity-based priority mapping.
```bash
npx pm-skill report-bug "<title>" --severity <urgent|high|medium|low>
```
Default severity: medium.

### add-task
Add a sub-issue to a parent issue.
```bash
npx pm-skill add-task <parent-issue-id> "<title>"
```

### relate
Set a relationship between two issues.
```bash
npx pm-skill relate <issue1> <issue2> --type <related|similar>
```

### block
Set a blocking dependency (issue1 blocks issue2).
```bash
npx pm-skill block <blocker-issue> <blocked-issue>
```

### push-doc
Upload markdown to Notion. Optionally link to a Linear issue.
```bash
# From file
npx pm-skill push-doc ./doc.md --title "Title" --parent <page-id> --issue <issue-id>

# From content (AI agent use case)
npx pm-skill push-doc --title "Title" --content "# Markdown..." --issue <issue-id>
```

### update-doc
Replace existing Notion page content with new markdown.
```bash
npx pm-skill update-doc <page-id> ./updated.md
npx pm-skill update-doc <page-id> --content "# Updated..."
```

### create-folder
Create an empty Notion page as a category/folder.
```bash
npx pm-skill create-folder "Folder Name" --parent <page-id>
# Returns page ID — use with push-doc --parent
```

### attach-doc
Attach a document URL to an issue with type validation.
```bash
npx pm-skill attach-doc <issue> --url "<url>" --title "<title>" --type <source-of-truth|issue-tracking|domain-knowledge>
```

### get
Show issue details including children, relations, and attachments.
```bash
npx pm-skill get <issue-id>
```

### delete
Delete issue(s) and their linked Notion pages.
```bash
npx pm-skill delete <issue-id>
npx pm-skill delete <issue-id> --recursive    # also delete sub-issues
```

## Configuration

All config is per-project (CWD):
- **`.env`** — API keys and IDs (never commit this file)
- **`config.yml`** — Labels, templates, priorities, severity mappings

## Workflow Patterns

### Feature Development
1. `npx pm-skill start-feature "Feature Name"` — creates Linear issue with checklist
2. `npx pm-skill add-task ENG-XX "Sub-task 1"` — break down into sub-tasks
3. `npx pm-skill push-doc ./design.md --issue ENG-XX` — upload docs when ready
4. `npx pm-skill relate ENG-XX ENG-YY` — link related issues

### Bug Fix
1. `npx pm-skill report-bug "Bug Description" --severity high`
2. `npx pm-skill add-task ENG-XX "Root cause analysis"`
3. `npx pm-skill add-task ENG-XX "Fix and test"`

### Document Management
1. `npx pm-skill create-folder "Schema Docs"` — create category
2. `npx pm-skill push-doc ./schema.md --parent <folder-id>` — upload under category
3. `npx pm-skill update-doc <page-id> ./schema-v2.md` — update later
