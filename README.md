# pm-skill

Structured project management CLI that integrates **Linear** and **Notion**. Designed to work with AI coding assistants — Claude Code, Codex, and any tool that can run shell commands.

> "Design freedom, usage discipline" — only labels, templates, and severity levels defined in `config.yml` are allowed.

## Features

- **init** — Validate API keys, create `.env`, `config.yml`, `SKILL.md`, `AGENTS.md` in your project
- **setup** — Verify connections, label matching, Notion status (`--sync` creates missing labels)
- **start-feature** — Create Linear issue + Notion PRD page, auto-linked
- **report-bug** — File bug with severity-based priority mapping
- **add-task** — Add sub-issues to a parent
- **relate / block** — Set issue relationships and dependencies
- **attach-doc** — Attach documents with type validation
- **get** — View issue details with children, relations, and attachments

## Quick Start

```bash
cd your-project

# Initialize (validates keys, creates config files)
npx pm-skill init --linear-key lin_api_xxx --notion-key secret_xxx

# Verify label matching
npx pm-skill setup

# Create missing labels in Linear
npx pm-skill setup --sync
```

This creates the following in your project:

```
your-project/
├── .env                                    # API keys + project settings
├── config.yml                              # Labels, templates, priorities
├── .claude/skills/pm-skill/SKILL.md        # Claude Code auto-discovers this
├── AGENTS.md                               # Codex auto-discovers this
└── ...
```

## Setup Details

### API Keys

- **Linear**: Settings > API > Personal API Keys
- **Notion**: https://www.notion.so/my-integrations > New integration

### init options

```bash
npx pm-skill init --linear-key <key> [options]
  --notion-key    Notion API key (optional)
  --team-id       Linear team ID (auto-detected if omitted)
  --project-id    Linear project ID (optional)
  --notion-page   Notion root page ID (optional)
```

### Customize `config.yml`

Edit `config.yml` in your project root to match your labels, templates, priorities, and severity mappings.

**Rule: every label and template must have a `description` field.**

## Usage

```bash
# Start a feature
npx pm-skill start-feature "Booking cancellation"

# Report a bug
npx pm-skill report-bug "Payment amount error" --severity high

# Add sub-tasks
npx pm-skill add-task ENG-10 "Write unit tests"
npx pm-skill add-task ENG-10 "Frontend UI"

# Link issues
npx pm-skill relate ENG-10 ENG-8 --type related
npx pm-skill block ENG-10 ENG-15

# Attach documents
npx pm-skill attach-doc ENG-10 --url "https://notion.so/..." --title "Design Doc" --type source-of-truth

# View issue details
npx pm-skill get ENG-10

# Check version
npx pm-skill --version
```

## Using with AI Assistants

### Claude Code

After `npx pm-skill init`, Claude Code auto-discovers the skill via `.claude/skills/pm-skill/SKILL.md`. You can invoke commands through natural language:

> "Create a feature issue for booking cancellation"

### Codex

After `npx pm-skill init`, Codex reads `AGENTS.md` at the project root for command instructions.

### Any AI Assistant

Any assistant that can execute shell commands can use pm-skill:

```bash
npx pm-skill start-feature "My Feature"
```

## Config Structure

| Section | Description |
|---------|-------------|
| `labels` | Available labels (description required) |
| `templates` | Command-to-label/priority/Notion-template mappings |
| `priorities` | Priority key (p0-p3) to Linear priority number mapping |
| `severity_mapping` | Severity name to priority key mapping |
| `doc_types` | Document types for attach-doc validation |
| `epics` | Epic definitions (project-specific) |

## Per-Project Model

All config is per-project. Each project gets its own `.env`, `config.yml`, and instruction files. Run `npx pm-skill init` in each project directory.

## License

MIT
