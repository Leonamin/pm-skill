# PM Skill — Agent Instructions

This file provides instructions for AI coding assistants (Codex, Claude Code, etc.) to use the pm-skill CLI.

## What is pm-skill?

A structured project management CLI that integrates Linear (issue tracking) and Notion (documentation). It enforces a config-driven workflow where only pre-defined labels, templates, and severity levels are allowed.

## How to Run Commands

```bash
# If installed globally via npm:
pm-skill <command> [args] [flags]

# If running from source:
npx tsx src/workflows.ts <command> [args] [flags]
```

## Available Commands

### setup
Verify Linear/Notion connection and show team/label configuration.
```bash
pm-skill setup
```

### start-feature
Create a Linear issue + Notion PRD page with bidirectional links.
```bash
pm-skill start-feature "<title>"
```

### report-bug
File a bug report with severity-based priority mapping.
```bash
pm-skill report-bug "<title>" --severity <urgent|high|medium|low>
```
Default severity: medium.

### add-task
Add a sub-issue to a parent issue.
```bash
pm-skill add-task <parent-issue-id> "<title>"
```

### relate
Set a relationship between two issues.
```bash
pm-skill relate <issue1> <issue2> --type <related|similar>
```
Default type: related.

### block
Set a blocking dependency (issue1 blocks issue2).
```bash
pm-skill block <blocker-issue> <blocked-issue>
```

### attach-doc
Attach a document URL to an issue with type validation.
```bash
pm-skill attach-doc <issue> --url "<url>" --title "<title>" --type <source-of-truth|issue-tracking|domain-knowledge>
```

### get
Show issue details including children, relations, and attachments.
```bash
pm-skill get <issue-id>
```

## Configuration

- **`.env`** — API keys and IDs. Looked up in: CWD → `~/.pm-skill/` → package root.
- **`config.yml`** — Labels, templates, priorities, severity mappings. Same lookup order.

## Workflow Patterns

### Feature Development
1. `start-feature "Feature Name"` — creates Linear issue + Notion PRD
2. `add-task ENG-XX "Sub-task 1"` — break down into sub-tasks
3. `relate ENG-XX ENG-YY` — link related issues
4. `attach-doc ENG-XX --url "..." --title "..." --type source-of-truth`

### Bug Fix
1. `report-bug "Bug Description" --severity high`
2. `add-task ENG-XX "Root cause analysis"`
3. `add-task ENG-XX "Fix and test"`
