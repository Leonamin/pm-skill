#!/usr/bin/env node

import minimist from "minimist";
import { type LinearClient as LinearClientType } from "@linear/sdk";
import { type Client as NotionClientType } from "@notionhq/client";

import { validateEnv, type ValidatedEnv } from "./env.js";
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
  createIssue,
  getIssue,
  getIssueDetail,
  createRelation,
  createAttachment,
  getTeams,
  getTeamStates,
  getTeamLabels,
  resolveLabels,
} from "./linear.js";
import {
  getNotionClient,
  createTemplatedPage,
  createDatabaseEntry,
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

// ── Commands ──

async function setup(ctx: CommandContext): Promise<void> {
  console.log("=== PM Skill Setup ===\n");

  // 1. Teams
  const teams = await getTeams(ctx.linear);
  console.log("📋 Linear 팀 목록:");
  for (const team of teams) {
    const marker =
      team.id === ctx.env.LINEAR_DEFAULT_TEAM_ID ? " ← 현재 설정" : "";
    console.log(`  ${team.key} | ${team.name} | ${team.id}${marker}`);
  }

  // 2. States
  const teamId = ctx.env.LINEAR_DEFAULT_TEAM_ID;
  console.log(`\n📊 팀 상태 목록 (${teamId}):`);
  const states = await getTeamStates(ctx.linear, teamId);
  for (const state of states) {
    console.log(`  ${state.name} (${state.type}) | ${state.id}`);
  }

  // 3. Labels + matching
  console.log("\n🏷️  Linear 라벨 목록:");
  const teamLabels = await getTeamLabels(ctx.linear, teamId);
  for (const label of teamLabels) {
    console.log(`  ${label.name} | ${label.id}`);
  }

  // 4. Config label matching
  console.log("\n🔗 Config ↔ Linear 라벨 매칭:");
  const linearLabelMap = new Map(
    teamLabels.map((l) => [l.name.toLowerCase(), l])
  );
  for (const configLabel of ctx.config.labels) {
    const match = linearLabelMap.get(configLabel.name.toLowerCase());
    if (match) {
      console.log(`  ✅ ${configLabel.id} (${configLabel.name}) → ${match.id}`);
    } else {
      console.log(
        `  ⚠️  ${configLabel.id} (${configLabel.name}) → 매칭 없음! Linear에 '${configLabel.name}' 라벨을 생성하세요.`
      );
    }
  }

  // 5. .env guide
  console.log("\n📝 .env 설정 안내:");
  console.log("  LINEAR_API_KEY=<위에서 사용 중인 키>");
  console.log(`  LINEAR_DEFAULT_TEAM_ID=${teamId}`);
  if (ctx.env.LINEAR_DEFAULT_PROJECT_ID) {
    console.log(
      `  LINEAR_DEFAULT_PROJECT_ID=${ctx.env.LINEAR_DEFAULT_PROJECT_ID}`
    );
  } else {
    console.log(
      "  LINEAR_DEFAULT_PROJECT_ID=<Linear 프로젝트 ID (선택)>"
    );
  }
  console.log("\nNotion 설정은 https://www.notion.so/my-integrations 에서 키를 발급하세요.");
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
  setup: (ctx) => setup(ctx),
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
    string: ["severity", "type", "url", "title"],
    alias: { s: "severity", t: "type" },
  });

  const command = args._[0] as string;
  args._ = args._.slice(1); // command 제거, 나머지가 positional args

  if (!command || command === "help") {
    console.log(`pm-skill — Structured project management CLI (Linear + Notion)

Usage: pm-skill <command> [args] [flags]

Commands:
  setup                              Verify Linear/Notion connection & show config
  start-feature <title>              Start feature (Linear issue + Notion PRD)
  report-bug <title> [--severity S]  File bug report (severity: urgent/high/medium/low)
  add-task <parent> <title>          Add sub-task to an issue
  relate <issue1> <issue2> [--type T]  Link issues (type: related/similar)
  block <blocker> <blocked>          Set blocking relationship
  attach-doc <issue> --url U --title T --type Y
                                     Attach document (type: source-of-truth/issue-tracking/domain-knowledge)
  get <issue>                        Show issue details
  help                               Show this help

Config lookup order: CWD → ~/.pm-skill/ → package root`);
    return;
  }

  const cmdFn = COMMANDS[command];
  if (!cmdFn) {
    const available = Object.keys(COMMANDS).join(", ");
    throw new Error(
      `알 수 없는 커맨드: '${command}'\n사용 가능한 커맨드: ${available}`
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
