# PM Skill — Structured Project Management

Linear + Notion integration for structured project management.
"Design freedom, usage discipline" — only labels/templates/severity defined in `config.yml` are allowed.

## Setup

```bash
# Initialize in project directory (validates keys, creates .env + config.yml)
npx pm-skill init --linear-key <key> --notion-key <key>

# Verify label matching
npx pm-skill setup

# Create missing labels in Linear
npx pm-skill setup --sync
```

## Commands

### setup [--sync]
Verify Linear/Notion connection + label matching. `--sync` creates missing labels.
```bash
npx pm-skill setup
```

### start-feature
Start feature development. Creates Linear issue + Notion PRD + bidirectional links.
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

### relate
Link two issues. (related, similar)
```bash
npx pm-skill relate ENG-10 ENG-11 --type related
```

### block
Set blocking relationship. (ENG-10 must complete before ENG-11)
```bash
npx pm-skill block ENG-10 ENG-11
```

### attach-doc
Attach document URL to issue. Type is validated against config.
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

## Workflow Examples

### Feature Development
```bash
npx pm-skill start-feature "Booking cancellation"
npx pm-skill add-task ENG-10 "API endpoint"
npx pm-skill add-task ENG-10 "Frontend UI"
npx pm-skill add-task ENG-10 "Tests"
npx pm-skill relate ENG-10 ENG-8 --type related
npx pm-skill block ENG-10 ENG-15
```

### Bug Fix
```bash
npx pm-skill report-bug "Payment error" --severity high
npx pm-skill add-task ENG-20 "Root cause analysis"
npx pm-skill add-task ENG-20 "Fix and test"
```

## Config

| Section | Description |
|---------|-------------|
| `labels` | Available labels (description required) |
| `templates` | Command → label/priority/Notion template mappings |
| `priorities` | p0-p3 → Linear priority mapping |
| `severity_mapping` | severity name → priority key |
| `doc_types` | Document types for attach-doc |
| `epics` | Epic definitions |
