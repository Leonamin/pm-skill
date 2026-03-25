# pm-skill

Structured project management CLI that integrates **Linear** and **Notion**. Designed to work with AI coding assistants — Claude Code, Codex, and any tool that can run shell commands.

> "Design freedom, usage discipline" — only labels, templates, and severity levels defined in `config.yml` are allowed.

## Features

- **start-feature** — Create Linear issue + Notion PRD page, auto-linked
- **report-bug** — File bug with severity-based priority mapping
- **add-task** — Add sub-issues to a parent
- **relate / block** — Set issue relationships and dependencies
- **attach-doc** — Attach documents with type validation
- **get** — View issue details with children, relations, and attachments
- **setup** — Verify connections and discover team/label IDs

## Installation

### Option A: npm (recommended)

```bash
npm install -g @anthropic-tools/pm-skill
pm-skill help
```

### Option B: npx (no install)

```bash
npx @anthropic-tools/pm-skill help
```

### Option C: Clone as Claude Code skill

```bash
git clone https://github.com/lsm/pm-skill.git ~/.claude/skills/pm-skill
cd ~/.claude/skills/pm-skill && npm install
```

### Option D: Clone for Codex

```bash
git clone https://github.com/lsm/pm-skill.git ~/pm-skill
cd ~/pm-skill && npm install
# Codex will read AGENTS.md for instructions
```

## Setup

### 1. Create `.env`

Place `.env` in any of these locations (checked in order):
1. Current working directory
2. `~/.pm-skill/`
3. Package root

```bash
# Copy the template
cp .env.example ~/.pm-skill/.env
# Edit with your API keys
```

```env
LINEAR_API_KEY=lin_api_xxxxxxxx
LINEAR_DEFAULT_TEAM_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
NOTION_API_KEY=secret_xxxxxxxx
NOTION_ROOT_PAGE_ID=xxxxxxxx
```

### 2. Run setup

```bash
pm-skill setup
```

This shows your Linear teams, workflow states, and labels — and verifies that `config.yml` labels match your Linear workspace.

### 3. Customize `config.yml`

Copy `config.yml` to `~/.pm-skill/config.yml` and edit labels, templates, priorities, and severity mappings to match your project.

**Rule: every label and template must have a `description` field.**

## Usage

```bash
# Start a feature
pm-skill start-feature "Booking cancellation"

# Report a bug
pm-skill report-bug "Payment amount error" --severity high

# Add sub-tasks
pm-skill add-task ENG-10 "Write unit tests"
pm-skill add-task ENG-10 "Frontend UI"

# Link issues
pm-skill relate ENG-10 ENG-8 --type related
pm-skill block ENG-10 ENG-15

# Attach documents
pm-skill attach-doc ENG-10 --url "https://notion.so/..." --title "Design Doc" --type source-of-truth

# View issue details
pm-skill get ENG-10
```

## Using with AI Assistants

### Claude Code

If installed as a skill in `~/.claude/skills/pm-skill/`, Claude Code auto-discovers it via `SKILL.md`. You can invoke commands through natural language:

> "Create a feature issue for booking cancellation"

### Codex

Clone the repo and Codex reads `AGENTS.md` for command instructions. Run commands via:

```bash
npx tsx src/workflows.ts start-feature "Booking cancellation"
```

### Any AI Assistant

Any assistant that can execute shell commands can use pm-skill:

```bash
pm-skill start-feature "My Feature"
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

## License

MIT
