#!/usr/bin/env node

import minimist from "minimist";
import { type LinearClient as LinearClientType } from "@linear/sdk";
import { type Client as NotionClientType } from "@notionhq/client";

import { validateEnv, loadEnvFiles, writeEnvFile, resolveFile, GLOBAL_DIR, type ValidatedEnv } from "./env.js";
import {
  loadConfig,
  getTemplate,
  resolvePriority,
  resolveSeverity,
  validateDocType,
  validateLabel,
  type PmConfig,
} from "./config.js";
import {
  getLinearClient,
  validateLinearKey,
  createIssue,
  getIssue,
  getIssueDetail,
  createRelation,
  createAttachment,
  createLabel,
  getTeams,
  getTeamStates,
  getTeamLabels,
  resolveLabels,
} from "./linear.js";
import {
  getNotionClient,
  createTemplatedPage,
  createDatabaseEntry,
  validateNotionKey,
} from "./notion.js";

// ── CommandContext ──

interface CommandContext {
  config: PmConfig;
  linear: LinearClientType;
  notion: NotionClientType | null;
  env: ValidatedEnv;
}

type CommandFn = (
  ctx: CommandContext,
  args: minimist.ParsedArgs
) => Promise<void>;

// ── Init (runs before context — no env/config validation needed) ──

import { existsSync, copyFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

function copyDefaultConfig(targetDir: string): void {
  const targetConfig = resolve(targetDir, "config.yml");
  if (existsSync(targetConfig)) {
    console.log(`  config.yml already exists at ${targetConfig} — skipped`);
    return;
  }
  const src = resolve(PKG_ROOT, "config.yml");
  if (!existsSync(src)) {
    console.log("  Warning: bundled config.yml not found — skipping copy");
    return;
  }
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(src, targetConfig);
  console.log(`  config.yml copied to ${targetConfig}`);
}

async function init(args: minimist.ParsedArgs): Promise<void> {
  const linearKey = args["linear-key"] as string | undefined;
  const notionKey = args["notion-key"] as string | undefined;
  const isGlobal = !!args.global;
  const teamId = args["team-id"] as string | undefined;
  const projectId = args["project-id"] as string | undefined;
  const notionPage = args["notion-page"] as string | undefined;

  if (!linearKey) {
    throw new Error(
      "Usage: pm-skill init --linear-key <key> [--notion-key <key>] [--global]\n" +
        "  --linear-key    Linear API key (required)\n" +
        "  --notion-key    Notion API key (optional)\n" +
        "  --global        Save to ~/.pm-skill/ instead of CWD\n" +
        "  --team-id       Linear team ID (auto-detected if omitted)\n" +
        "  --project-id    Linear project ID (optional)\n" +
        "  --notion-page   Notion root page ID (optional)"
    );
  }

  const targetDir = isGlobal ? GLOBAL_DIR : process.cwd();
  const targetLabel = isGlobal ? `~/.pm-skill/` : "CWD";

  console.log(`=== pm-skill init (${targetLabel}) ===\n`);

  // 1. Validate Linear key
  console.log("[Linear] Validating API key...");
  const linearUser = await validateLinearKey(linearKey);
  console.log(`  Authenticated as: ${linearUser.name} (${linearUser.email})`);

  // 2. Discover teams + auto-select
  const client = getLinearClient(linearKey);
  const teams = await getTeams(client);
  let selectedTeamId = teamId;

  if (!selectedTeamId) {
    if (teams.length === 1) {
      selectedTeamId = teams[0].id;
      console.log(`  Auto-selected team: ${teams[0].key} (${teams[0].name})`);
    } else {
      console.log("\n  Available teams:");
      for (const team of teams) {
        console.log(`    ${team.key} | ${team.name} | ${team.id}`);
      }
      selectedTeamId = teams[0].id;
      console.log(`  Using first team: ${teams[0].key}. Override with --team-id <id>`);
    }
  } else {
    const match = teams.find((t) => t.id === teamId || t.key === teamId);
    if (match) {
      selectedTeamId = match.id;
      console.log(`  Team: ${match.key} (${match.name})`);
    } else {
      throw new Error(`Team '${teamId}' not found. Run 'pm-skill init --linear-key <key>' to see available teams.`);
    }
  }

  // 3. Validate Notion key (optional)
  if (notionKey) {
    console.log("\n[Notion] Validating API key...");
    const notionUser = await validateNotionKey(notionKey);
    console.log(`  Authenticated as: ${notionUser.name}`);
  }

  // 4. Write .env
  console.log(`\n[Config] Writing .env to ${targetLabel}...`);
  const envEntries: Record<string, string> = {
    LINEAR_API_KEY: linearKey,
    LINEAR_DEFAULT_TEAM_ID: selectedTeamId,
  };
  if (projectId) envEntries.LINEAR_DEFAULT_PROJECT_ID = projectId;
  if (notionKey) envEntries.NOTION_API_KEY = notionKey;
  if (notionPage) envEntries.NOTION_ROOT_PAGE_ID = notionPage;

  const envPath = writeEnvFile(targetDir, envEntries);
  console.log(`  Written: ${envPath}`);

  // 5. Copy config.yml if missing
  console.log(`\n[Config] Checking config.yml...`);
  copyDefaultConfig(targetDir);

  // 6. Summary
  console.log(`\n=== Init complete ===`);
  console.log(`  .env:        ${envPath}`);
  console.log(`  config.yml:  ${resolve(targetDir, "config.yml")}`);
  console.log(`  Linear user: ${linearUser.name}`);
  console.log(`  Team:        ${selectedTeamId}`);
  if (notionKey) console.log(`  Notion:      connected`);
  console.log(`\nNext steps:`);
  if (isGlobal) {
    console.log(`  - Per-project overrides: create .env in your project directory`);
  }
  console.log(`  - Customize config.yml labels/templates for your project`);
  console.log(`  - Run 'pm-skill setup' to verify label matching`);
}

// ── Commands ──

async function setup(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const sync = !!args.sync;

  console.log(`=== PM Skill Setup${sync ? " (--sync)" : ""} ===\n`);

  // 1. Teams
  const teams = await getTeams(ctx.linear);
  console.log("📋 Linear teams:");
  for (const team of teams) {
    const marker =
      team.id === ctx.env.LINEAR_DEFAULT_TEAM_ID ? " ← current" : "";
    console.log(`  ${team.key} | ${team.name} | ${team.id}${marker}`);
  }

  // 2. States
  const teamId = ctx.env.LINEAR_DEFAULT_TEAM_ID;
  console.log(`\n📊 Workflow states (${teamId}):`);
  const states = await getTeamStates(ctx.linear, teamId);
  for (const state of states) {
    console.log(`  ${state.name} (${state.type}) | ${state.id}`);
  }

  // 3. Labels + matching
  console.log("\n🏷️  Linear labels:");
  let teamLabels = await getTeamLabels(ctx.linear, teamId);
  for (const label of teamLabels) {
    console.log(`  ${label.name} | ${label.id}`);
  }

  // 4. Config label matching + sync
  console.log("\n🔗 Config ↔ Linear label matching:");
  const linearLabelMap = new Map(
    teamLabels.map((l) => [l.name.toLowerCase(), l])
  );

  const missingLabels = [];
  for (const configLabel of ctx.config.labels) {
    const match = linearLabelMap.get(configLabel.name.toLowerCase());
    if (match) {
      console.log(`  ✅ ${configLabel.id} (${configLabel.name}) → ${match.id}`);
    } else {
      missingLabels.push(configLabel);
      console.log(
        `  ⚠️  ${configLabel.id} (${configLabel.name}) → not found in Linear`
      );
    }
  }

  // 5. Sync missing labels
  if (missingLabels.length > 0 && sync) {
    console.log(`\n🔄 Creating ${missingLabels.length} missing label(s) in Linear...`);
    for (const configLabel of missingLabels) {
      const created = await createLabel(ctx.linear, teamId, configLabel.name, {
        description: configLabel.description,
        color: configLabel.color,
      });
      console.log(`  ✅ Created: ${configLabel.name} → ${created.id}`);
    }
    console.log("\nLabels synced successfully.");
  } else if (missingLabels.length > 0) {
    console.log(`\n💡 ${missingLabels.length} label(s) missing. Run 'pm-skill setup --sync' to create them.`);
  } else {
    console.log("\n✅ All config labels matched.");
  }

  // 6. .env guide
  console.log("\n📝 .env reference:");
  console.log(`  LINEAR_API_KEY=<your key>`);
  console.log(`  LINEAR_DEFAULT_TEAM_ID=${teamId}`);
  if (ctx.env.LINEAR_DEFAULT_PROJECT_ID) {
    console.log(
      `  LINEAR_DEFAULT_PROJECT_ID=${ctx.env.LINEAR_DEFAULT_PROJECT_ID}`
    );
  } else {
    console.log(
      "  LINEAR_DEFAULT_PROJECT_ID=<optional>"
    );
  }
  if (!ctx.env.NOTION_API_KEY) {
    console.log("  NOTION_API_KEY=<get from https://www.notion.so/my-integrations>");
  }
}

async function startFeature(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const title = args._[0];
  if (!title) {
    throw new Error("사용법: start-feature <제목>");
  }

  const tmpl = getTemplate(ctx.config, "feature");
  const teamLabels = await getTeamLabels(
    ctx.linear,
    ctx.env.LINEAR_DEFAULT_TEAM_ID
  );
  const configLabels = tmpl.linear_labels.map(
    (lid) => validateLabel(ctx.config, lid).name
  );
  const labelIds = resolveLabels(configLabels, teamLabels);
  const priority = tmpl.linear_priority
    ? resolvePriority(ctx.config, tmpl.linear_priority)
    : undefined;

  // 1. Linear issue
  const issue = await createIssue(ctx.linear, {
    teamId: ctx.env.LINEAR_DEFAULT_TEAM_ID,
    title,
    priority,
    labelIds,
    projectId: ctx.env.LINEAR_DEFAULT_PROJECT_ID,
  });
  const issueId = issue.identifier;
  const issueUrl = issue.url;
  console.log(`[Linear] 이슈 생성: ${issueId} — ${issueUrl}`);

  // 2. Notion page
  if (!ctx.notion || !ctx.env.NOTION_ROOT_PAGE_ID) {
    console.log("[Notion] Notion 설정 없음 — 페이지 생성 생략");
    return;
  }

  const page = await createTemplatedPage(
    ctx.notion,
    ctx.env.NOTION_ROOT_PAGE_ID,
    tmpl.notion_template,
    title,
    issueUrl
  );
  console.log(`[Notion] 페이지 생성: ${page.url}`);

  // 3. Link Linear → Notion
  await createAttachment(ctx.linear, issue.id, page.url, `${title} — PRD`);
  console.log(`[Link] Linear ↔ Notion 연결 완료`);

  console.log(`\n✅ 기능 시작: ${issueId} | Notion: ${page.url}`);
}

async function reportBug(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const title = args._[0];
  if (!title) {
    throw new Error("사용법: report-bug <제목> [--severity high]");
  }

  const severity = (args.severity as string) ?? "medium";
  const priority = resolveSeverity(ctx.config, severity);

  const tmpl = getTemplate(ctx.config, "bugfix");
  const teamLabels = await getTeamLabels(
    ctx.linear,
    ctx.env.LINEAR_DEFAULT_TEAM_ID
  );
  const configLabels = tmpl.linear_labels.map(
    (lid) => validateLabel(ctx.config, lid).name
  );
  const labelIds = resolveLabels(configLabels, teamLabels);

  // 1. Linear issue
  const issue = await createIssue(ctx.linear, {
    teamId: ctx.env.LINEAR_DEFAULT_TEAM_ID,
    title,
    priority,
    labelIds,
    projectId: ctx.env.LINEAR_DEFAULT_PROJECT_ID,
  });
  const issueId = issue.identifier;
  const issueUrl = issue.url;
  console.log(`[Linear] 버그 이슈 생성: ${issueId} (severity: ${severity}) — ${issueUrl}`);

  // 2. Notion
  if (!ctx.notion) {
    console.log("[Notion] Notion 설정 없음 — 문서 생성 생략");
    return;
  }

  let notionUrl: string;

  if (ctx.env.NOTION_BUG_DB_ID) {
    // DB 엔트리
    const entry = await createDatabaseEntry(ctx.notion, ctx.env.NOTION_BUG_DB_ID, {
      Name: { title: [{ text: { content: title } }] },
    });
    notionUrl = entry.url;
    console.log(`[Notion] 버그 DB 엔트리 생성: ${notionUrl}`);
  } else if (ctx.env.NOTION_ROOT_PAGE_ID) {
    // 페이지
    const page = await createTemplatedPage(
      ctx.notion,
      ctx.env.NOTION_ROOT_PAGE_ID,
      tmpl.notion_template,
      title,
      issueUrl,
      severity
    );
    notionUrl = page.url;
    console.log(`[Notion] 버그리포트 페이지 생성: ${notionUrl}`);
  } else {
    console.log("[Notion] NOTION_ROOT_PAGE_ID 미설정 — 문서 생성 생략");
    return;
  }

  // 3. Link
  await createAttachment(ctx.linear, issue.id, notionUrl, `${title} — Bug Report`);
  console.log(`[Link] Linear ↔ Notion 연결 완료`);

  console.log(`\n✅ 버그 리포트: ${issueId} | Notion: ${notionUrl}`);
}

async function addTask(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const parentIdentifier = args._[0];
  const title = args._[1];
  if (!parentIdentifier || !title) {
    throw new Error("사용법: add-task <부모이슈> <제목>");
  }

  const parent = await getIssue(ctx.linear, parentIdentifier);
  const child = await createIssue(ctx.linear, {
    teamId: ctx.env.LINEAR_DEFAULT_TEAM_ID,
    title,
    parentId: parent.id,
    projectId: ctx.env.LINEAR_DEFAULT_PROJECT_ID,
  });

  console.log(
    `✅ 하위 이슈 생성: ${child.identifier} (부모: ${parent.identifier})`
  );
}

async function relate(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const id1 = args._[0];
  const id2 = args._[1];
  if (!id1 || !id2) {
    throw new Error("사용법: relate <이슈1> <이슈2> [--type related]");
  }

  const type = (args.type as string) ?? "related";
  if (type !== "related" && type !== "similar") {
    throw new Error(
      `relate 커맨드는 'related' 또는 'similar' 타입만 지원합니다. blocks 관계는 'block' 커맨드를 사용하세요.`
    );
  }

  const issue1 = await getIssue(ctx.linear, id1);
  const issue2 = await getIssue(ctx.linear, id2);
  await createRelation(ctx.linear, issue1.id, issue2.id, type as "related");

  console.log(`✅ ${id1} ↔ ${id2} (${type}) 관계 생성 완료`);
}

async function block(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const id1 = args._[0];
  const id2 = args._[1];
  if (!id1 || !id2) {
    throw new Error("사용법: block <선행이슈> <후행이슈>");
  }

  const issue1 = await getIssue(ctx.linear, id1);
  const issue2 = await getIssue(ctx.linear, id2);
  await createRelation(ctx.linear, issue1.id, issue2.id, "blocks");

  console.log(`✅ ${id1}이 ${id2}를 선행합니다 (blocks)`);
}

async function attachDoc(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const identifier = args._[0];
  const url = args.url as string;
  const title = args.title as string;
  const type = args.type as string;

  if (!identifier || !url || !title || !type) {
    throw new Error(
      '사용법: attach-doc <이슈> --url "URL" --title "제목" --type <유형>'
    );
  }

  validateDocType(ctx.config, type);
  const issue = await getIssue(ctx.linear, identifier);
  await createAttachment(ctx.linear, issue.id, url, title, type);

  console.log(
    `✅ ${identifier}에 문서 첨부: "${title}" (${type}) — ${url}`
  );
}

async function get(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const identifier = args._[0];
  if (!identifier) {
    throw new Error("사용법: get <이슈>");
  }

  const detail = await getIssueDetail(ctx.linear, identifier);
  const { issue, children, relations, attachments } = detail;

  const state = await issue.state;
  const labels = await issue.labels();
  const labelNames = labels.nodes.map((l) => l.name).join(", ");

  console.log(`\n${issue.identifier}: ${issue.title}`);
  console.log(
    `상태: ${state?.name ?? "?"} | 우선순위: ${issue.priority ?? "?"} | 라벨: ${labelNames || "없음"}`
  );

  if (children.length > 0) {
    console.log("\n하위 이슈:");
    for (const child of children) {
      const childState = await child.state;
      console.log(
        `  ${child.identifier}: ${child.title} (${childState?.name ?? "?"})`
      );
    }
  }

  if (relations.length > 0) {
    console.log("\n관계:");
    for (const rel of relations) {
      const arrow = rel.type === "blocks" ? "→ blocks" : "↔ related";
      console.log(
        `  ${arrow} ${rel.issue.identifier} (${rel.issue.title})`
      );
    }
  }

  if (attachments.length > 0) {
    console.log("\n첨부 문서:");
    for (const att of attachments) {
      const typeLabel = att.subtitle ? ` (${att.subtitle})` : "";
      console.log(`  📄 ${att.title}${typeLabel} — ${att.url}`);
    }
  }
}

// ── Command Registry ──

const COMMANDS: Record<string, CommandFn> = {
  setup: (ctx, args) => setup(ctx, args),
  "start-feature": startFeature,
  "report-bug": reportBug,
  "add-task": addTask,
  relate,
  block,
  "attach-doc": attachDoc,
  get,
};

// ── Main ──

async function main(): Promise<void> {
  const args = minimist(process.argv.slice(2), {
    string: ["severity", "type", "url", "title", "linear-key", "notion-key", "team-id", "project-id", "notion-page"],
    boolean: ["global", "sync"],
    alias: { s: "severity", t: "type" },
  });

  const command = args._[0] as string;
  args._ = args._.slice(1); // command 제거, 나머지가 positional args

  if (!command || command === "help") {
    console.log(`pm-skill — Structured project management CLI (Linear + Notion)

Usage: pm-skill <command> [args] [flags]

Commands:
  init --linear-key K [--notion-key K] [--global]
                                     Initialize config & validate API keys
  setup [--sync]                     Verify config & label matching (--sync creates missing labels)
  start-feature <title>              Start feature (Linear issue + Notion PRD)
  report-bug <title> [--severity S]  File bug report (severity: urgent/high/medium/low)
  add-task <parent> <title>          Add sub-task to an issue
  relate <issue1> <issue2> [--type T]  Link issues (type: related/similar)
  block <blocker> <blocked>          Set blocking relationship
  attach-doc <issue> --url U --title T --type Y
                                     Attach document (type: source-of-truth/issue-tracking/domain-knowledge)
  get <issue>                        Show issue details
  help                               Show this help

Config lookup: CWD/.env + ~/.pm-skill/.env (both loaded, CWD wins)`);
    return;
  }

  // init runs independently — no env/config validation
  if (command === "init") {
    await init(args);
    return;
  }

  const cmdFn = COMMANDS[command];
  if (!cmdFn) {
    const available = ["init", ...Object.keys(COMMANDS)].join(", ");
    throw new Error(
      `Unknown command: '${command}'\nAvailable: ${available}`
    );
  }

  // Validate env
  const env = validateEnv(command);

  // Load & validate config
  const config = loadConfig();

  // Build context
  const linear = getLinearClient(env.LINEAR_API_KEY);
  const notion = env.NOTION_API_KEY
    ? getNotionClient(env.NOTION_API_KEY)
    : null;

  const ctx: CommandContext = { config, linear, notion, env };

  await cmdFn(ctx, args);
}

main().catch((err: Error) => {
  console.error(`\n❌ ${err.message}`);
  process.exit(1);
});
