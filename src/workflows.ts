#!/usr/bin/env node

import minimist from "minimist";
import { existsSync, copyFileSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { type LinearClient as LinearClientType } from "@linear/sdk";
import { type Client as NotionClientType } from "@notionhq/client";

import { validateEnv, writeEnvFile, resolveFile, PKG_ROOT, type ValidatedEnv } from "./env.js";
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
  deleteIssue,
  getIssue,
  getIssueDetail,
  createRelation,
  createAttachment,
  createLabel,
  getTeams,
  getTeamStates,
  getTeamLabels,
  getTeamProjects,
  resolveLabels,
} from "./linear.js";
import {
  getNotionClient,
  createTemplatedPage,
  createDatabaseEntry,
  validateNotionKey,
  searchPages,
  createPageFromMarkdown,
  updatePageContent,
  deletePage,
  extractNotionPageId,
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

// ── Init ──

function copyBundledFile(srcName: string, destPath: string): void {
  if (existsSync(destPath)) {
    console.log(`  ${srcName} already exists — skipped`);
    return;
  }
  const src = resolve(PKG_ROOT, srcName);
  if (!existsSync(src)) {
    console.log(`  Warning: bundled ${srcName} not found — skipping`);
    return;
  }
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(src, destPath);
  console.log(`  ${srcName} → ${destPath}`);
}

async function init(args: minimist.ParsedArgs): Promise<void> {
  const linearKey = args["linear-key"] as string | undefined;
  const notionKey = args["notion-key"] as string | undefined;
  const teamId = args["team-id"] as string | undefined;
  const projectId = args["project-id"] as string | undefined;
  const notionPage = args["notion-page"] as string | undefined;

  if (!linearKey) {
    throw new Error(
      "Usage: npx pm-skill init --linear-key <key> [--notion-key <key>]\n" +
        "  --linear-key    Linear API key (required)\n" +
        "  --notion-key    Notion API key (optional)\n" +
        "  --team-id       Linear team ID (auto-detected if omitted)\n" +
        "  --project-id    Linear project ID (optional)\n" +
        "  --notion-page   Notion root page ID (optional)"
    );
  }

  const cwd = process.cwd();
  console.log(`=== pm-skill init ===\n`);

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
      throw new Error(`Team '${teamId}' not found. Run 'npx pm-skill init --linear-key <key>' to see available teams.`);
    }
  }

  // 3. Auto-detect project
  let selectedProjectId = projectId;
  if (!selectedProjectId) {
    const projects = await getTeamProjects(client, selectedTeamId);
    if (projects.length === 0) {
      console.log("  No projects found — skipping project assignment");
    } else if (projects.length === 1) {
      selectedProjectId = projects[0].id;
      console.log(`  Auto-selected project: "${projects[0].name}"`);
    } else {
      console.log(`\n  Available projects (${projects.length}):`);
      for (const proj of projects) {
        console.log(`    ${proj.name} | ${proj.id}`);
      }
      selectedProjectId = projects[0].id;
      console.log(`  Using first project: "${projects[0].name}". Override with --project-id <id>`);
    }
  }

  // 4. Validate Notion key + auto-detect root page
  let selectedNotionPage = notionPage;
  if (notionKey) {
    console.log("\n[Notion] Validating API key...");
    const notionUser = await validateNotionKey(notionKey);
    console.log(`  Authenticated as: ${notionUser.name}`);

    if (!selectedNotionPage) {
      console.log("  Searching for accessible pages...");
      const notionClient = getNotionClient(notionKey);
      const pages = await searchPages(notionClient, "");
      if (pages.length === 0) {
        console.log("  ⚠️  No pages shared with this integration.");
        console.log("  Share a page in Notion: page menu → Connections → add your integration");
      } else if (pages.length === 1) {
        selectedNotionPage = pages[0].id;
        console.log(`  Auto-selected root page: "${pages[0].title}" (${pages[0].id})`);
      } else {
        console.log(`\n  Accessible pages (${pages.length}):`);
        for (const page of pages) {
          console.log(`    ${page.title} | ${page.id}`);
        }
        selectedNotionPage = pages[0].id;
        console.log(`  Using first page: "${pages[0].title}". Override with --notion-page <id>`);
      }
    }
  }

  // 4. Write .env
  console.log("\n[Config] Writing .env...");
  const envEntries: Record<string, string> = {
    LINEAR_API_KEY: linearKey,
    LINEAR_DEFAULT_TEAM_ID: selectedTeamId,
  };
  if (selectedProjectId) envEntries.LINEAR_DEFAULT_PROJECT_ID = selectedProjectId;
  if (notionKey) envEntries.NOTION_API_KEY = notionKey;
  if (selectedNotionPage) envEntries.NOTION_ROOT_PAGE_ID = selectedNotionPage;

  const envPath = writeEnvFile(cwd, envEntries);
  console.log(`  Written: ${envPath}`);

  // 5. Copy config.yml, SKILL.md, AGENTS.md
  console.log("\n[Files] Setting up project files...");
  copyBundledFile("config.yml", resolve(cwd, "config.yml"));
  copyBundledFile("SKILL.md", resolve(cwd, ".claude", "skills", "pm-skill", "SKILL.md"));
  copyBundledFile("AGENTS.md", resolve(cwd, "AGENTS.md"));

  // 6. Summary
  console.log(`\n=== Init complete ===`);
  console.log(`  .env:       ${envPath}`);
  console.log(`  config.yml: ${resolve(cwd, "config.yml")}`);
  console.log(`  SKILL.md:   ${resolve(cwd, ".claude/skills/pm-skill/SKILL.md")}`);
  console.log(`  AGENTS.md:  ${resolve(cwd, "AGENTS.md")}`);
  console.log(`  Linear:     ${linearUser.name} | Team: ${selectedTeamId}`);
  if (notionKey) console.log(`  Notion:     connected`);
  console.log(`\nNext steps:`);
  console.log(`  - Edit config.yml to match your project's labels/templates`);
  console.log(`  - Run 'npx pm-skill setup' to verify label matching`);
  console.log(`  - Run 'npx pm-skill setup --sync' to create missing labels in Linear`);
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
  const teamLabels = await getTeamLabels(ctx.linear, teamId);
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
    console.log(`\n💡 ${missingLabels.length} label(s) missing. Run 'npx pm-skill setup --sync' to create them.`);
  } else {
    console.log("\n✅ All config labels matched.");
  }

  // 6. Notion connection check
  console.log("\n📓 Notion:");
  if (ctx.env.NOTION_API_KEY) {
    try {
      const notionInfo = await validateNotionKey(ctx.env.NOTION_API_KEY);
      console.log(`  ✅ Connected: ${notionInfo.name}`);
      if (ctx.env.NOTION_ROOT_PAGE_ID) {
        console.log(`  Root page: ${ctx.env.NOTION_ROOT_PAGE_ID}`);
      } else {
        console.log(`  ⚠️  NOTION_ROOT_PAGE_ID not set — page creation will be skipped`);
      }
      if (ctx.env.NOTION_BUG_DB_ID) {
        console.log(`  Bug DB: ${ctx.env.NOTION_BUG_DB_ID}`);
      }
    } catch {
      console.log("  ❌ Notion API key is invalid. Check https://www.notion.so/my-integrations");
    }
  } else {
    console.log("  ⚠️  NOTION_API_KEY not set — Notion features disabled");
    console.log("  Run 'npx pm-skill init --linear-key <key> --notion-key <key>' to set up");
  }
}

async function startFeature(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const title = args._[0];
  if (!title) {
    throw new Error("Usage: npx pm-skill start-feature <title>");
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

  const issue = await createIssue(ctx.linear, {
    teamId: ctx.env.LINEAR_DEFAULT_TEAM_ID,
    title,
    priority,
    labelIds,
    projectId: ctx.env.LINEAR_DEFAULT_PROJECT_ID,
  });
  console.log(`[Linear] Issue created: ${issue.identifier} — ${issue.url}`);

  if (!ctx.notion || !ctx.env.NOTION_ROOT_PAGE_ID) {
    console.log("[Notion] Not configured — skipping page creation");
    return;
  }

  const page = await createTemplatedPage(
    ctx.notion,
    ctx.env.NOTION_ROOT_PAGE_ID,
    tmpl.notion_template,
    title,
    issue.url
  );
  console.log(`[Notion] Page created: ${page.url}`);

  await createAttachment(ctx.linear, issue.id, page.url, `${title} — PRD`);
  console.log(`[Link] Linear ↔ Notion linked`);
  console.log(`\n✅ Feature started: ${issue.identifier} | Notion: ${page.url}`);
  console.log(`   Notion Page ID: ${page.id} (use with --parent for sub-docs)`);
}

async function reportBug(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const title = args._[0];
  if (!title) {
    throw new Error("Usage: npx pm-skill report-bug <title> [--severity high]");
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

  const issue = await createIssue(ctx.linear, {
    teamId: ctx.env.LINEAR_DEFAULT_TEAM_ID,
    title,
    priority,
    labelIds,
    projectId: ctx.env.LINEAR_DEFAULT_PROJECT_ID,
  });
  console.log(`[Linear] Bug created: ${issue.identifier} (severity: ${severity}) — ${issue.url}`);

  if (!ctx.notion) {
    console.log("[Notion] Not configured — skipping");
    return;
  }

  let notionUrl: string;

  if (ctx.env.NOTION_BUG_DB_ID) {
    const entry = await createDatabaseEntry(ctx.notion, ctx.env.NOTION_BUG_DB_ID, {
      Name: { title: [{ text: { content: title } }] },
    });
    notionUrl = entry.url;
    console.log(`[Notion] Bug DB entry: ${notionUrl}`);
  } else if (ctx.env.NOTION_ROOT_PAGE_ID) {
    const page = await createTemplatedPage(
      ctx.notion,
      ctx.env.NOTION_ROOT_PAGE_ID,
      tmpl.notion_template,
      title,
      issue.url,
      severity
    );
    notionUrl = page.url;
    console.log(`[Notion] Bug report page: ${notionUrl}`);
  } else {
    console.log("[Notion] NOTION_ROOT_PAGE_ID not set — skipping");
    return;
  }

  await createAttachment(ctx.linear, issue.id, notionUrl, `${title} — Bug Report`);
  console.log(`[Link] Linear ↔ Notion linked`);
  console.log(`\n✅ Bug reported: ${issue.identifier} | Notion: ${notionUrl}`);
}

async function addTask(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const parentIdentifier = args._[0];
  const title = args._[1];
  if (!parentIdentifier || !title) {
    throw new Error("Usage: npx pm-skill add-task <parent-issue> <title>");
  }

  const parent = await getIssue(ctx.linear, parentIdentifier);
  const child = await createIssue(ctx.linear, {
    teamId: ctx.env.LINEAR_DEFAULT_TEAM_ID,
    title,
    parentId: parent.id,
    projectId: ctx.env.LINEAR_DEFAULT_PROJECT_ID,
  });

  console.log(`✅ Sub-issue created: ${child.identifier} (parent: ${parent.identifier})`);
}

async function relate(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const id1 = args._[0];
  const id2 = args._[1];
  if (!id1 || !id2) {
    throw new Error("Usage: npx pm-skill relate <issue1> <issue2> [--type related]");
  }

  const type = (args.type as string) ?? "related";
  if (type !== "related" && type !== "similar") {
    throw new Error(
      `relate only supports 'related' or 'similar'. Use 'block' command for blocking relationships.`
    );
  }

  const issue1 = await getIssue(ctx.linear, id1);
  const issue2 = await getIssue(ctx.linear, id2);
  await createRelation(ctx.linear, issue1.id, issue2.id, type as "related");

  console.log(`✅ ${id1} ↔ ${id2} (${type}) linked`);
}

async function block(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const id1 = args._[0];
  const id2 = args._[1];
  if (!id1 || !id2) {
    throw new Error("Usage: npx pm-skill block <blocker> <blocked>");
  }

  const issue1 = await getIssue(ctx.linear, id1);
  const issue2 = await getIssue(ctx.linear, id2);
  await createRelation(ctx.linear, issue1.id, issue2.id, "blocks");

  console.log(`✅ ${id1} blocks ${id2}`);
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
      'Usage: npx pm-skill attach-doc <issue> --url "URL" --title "Title" --type <type>'
    );
  }

  validateDocType(ctx.config, type);
  const issue = await getIssue(ctx.linear, identifier);
  await createAttachment(ctx.linear, issue.id, url, title, type);

  console.log(`✅ ${identifier}: attached "${title}" (${type}) — ${url}`);
}

async function get(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const identifier = args._[0];
  if (!identifier) {
    throw new Error("Usage: npx pm-skill get <issue>");
  }

  const detail = await getIssueDetail(ctx.linear, identifier);
  const { issue, children, relations, attachments } = detail;

  const state = await issue.state;
  const labels = await issue.labels();
  const labelNames = labels.nodes.map((l) => l.name).join(", ");

  console.log(`\n${issue.identifier}: ${issue.title}`);
  console.log(
    `State: ${state?.name ?? "?"} | Priority: ${issue.priority ?? "?"} | Labels: ${labelNames || "none"}`
  );

  if (children.length > 0) {
    console.log("\nSub-issues:");
    for (const child of children) {
      const childState = await child.state;
      console.log(
        `  ${child.identifier}: ${child.title} (${childState?.name ?? "?"})`
      );
    }
  }

  if (relations.length > 0) {
    console.log("\nRelations:");
    for (const rel of relations) {
      const arrow = rel.type === "blocks" ? "→ blocks" : "↔ related";
      console.log(
        `  ${arrow} ${rel.issue.identifier} (${rel.issue.title})`
      );
    }
  }

  if (attachments.length > 0) {
    console.log("\nAttachments:");
    for (const att of attachments) {
      const typeLabel = att.subtitle ? ` (${att.subtitle})` : "";
      console.log(`  ${att.title}${typeLabel} — ${att.url}`);
    }
  }
}

async function pushDoc(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const identifier = args._[0];
  const filePath = args._[1] as string | undefined;
  const content = args.content as string | undefined;
  const title = args.title as string | undefined;
  const parentPageId = args.parent as string | undefined;

  if (!identifier || (!filePath && !content)) {
    throw new Error(
      "Usage: npx pm-skill push-doc <issue> <file.md> [--title T] [--parent P]\n" +
        "       npx pm-skill push-doc <issue> --title T --content \"# md\" [--parent P]"
    );
  }

  if (!ctx.notion) {
    throw new Error("Notion is not configured. Run 'npx pm-skill init' with --notion-key.");
  }

  const targetParent = parentPageId ?? ctx.env.NOTION_ROOT_PAGE_ID;
  if (!targetParent) {
    throw new Error("No Notion parent page. Set NOTION_ROOT_PAGE_ID or use --parent <page-id>.");
  }

  // Read markdown
  let markdown: string;
  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    markdown = readFileSync(filePath, "utf-8");
  } else {
    markdown = content!;
  }

  // Determine title
  const docTitle = title ?? (filePath ? filePath.replace(/^.*[\\/]/, "").replace(/\.md$/, "") : "Untitled");

  // Get Linear issue for linking
  const issue = await getIssue(ctx.linear, identifier);

  // Create Notion page under specified parent
  const page = await createPageFromMarkdown(
    ctx.notion,
    targetParent,
    docTitle,
    markdown
  );
  console.log(`[Notion] Page created: "${docTitle}" — ${page.url}`);
  console.log(`[Notion] Page ID: ${page.id}`);

  // Link to Linear issue
  await createAttachment(ctx.linear, issue.id, page.url, docTitle, "source-of-truth");
  console.log(`[Link] Attached to ${issue.identifier}`);
  console.log(`\n✅ Document pushed: ${issue.identifier} | ${page.url}`);
}

async function updateDoc(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const pageId = args._[0];
  const filePath = args._[1] as string | undefined;
  const content = args.content as string | undefined;

  if (!pageId || (!filePath && !content)) {
    throw new Error(
      "Usage: npx pm-skill update-doc <page-id> <file.md>\n" +
        "       npx pm-skill update-doc <page-id> --content \"# Updated...\""
    );
  }

  if (!ctx.notion) {
    throw new Error("Notion is not configured. Run 'npx pm-skill init' with --notion-key.");
  }

  let markdown: string;
  if (filePath) {
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    markdown = readFileSync(filePath, "utf-8");
  } else {
    markdown = content!;
  }

  await updatePageContent(ctx.notion, pageId, markdown);
  console.log(`✅ Page updated: ${pageId}`);
}

async function createFolder(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const folderName = args._[0];
  const parentPageId = args.parent as string | undefined;

  if (!folderName) {
    throw new Error("Usage: npx pm-skill create-folder <name> [--parent <page-id>]");
  }

  if (!ctx.notion) {
    throw new Error("Notion is not configured. Run 'npx pm-skill init' with --notion-key.");
  }

  const targetParent = parentPageId ?? ctx.env.NOTION_ROOT_PAGE_ID;
  if (!targetParent) {
    throw new Error("No Notion parent page. Set NOTION_ROOT_PAGE_ID or use --parent <page-id>.");
  }

  const response = await ctx.notion.pages.create({
    parent: { page_id: targetParent },
    properties: {
      title: { title: [{ text: { content: folderName } }] },
    },
    children: [],
  });

  const pageId = response.id;
  const url = `https://notion.so/${pageId.replace(/-/g, "")}`;

  console.log(`✅ Folder created: "${folderName}"`);
  console.log(`   Page ID: ${pageId}`);
  console.log(`   URL: ${url}`);
  console.log(`\nUse with: npx pm-skill push-doc <issue> <file> --parent ${pageId}`);
}

async function del(
  ctx: CommandContext,
  args: minimist.ParsedArgs
): Promise<void> {
  const identifiers = args._ as string[];
  if (identifiers.length === 0) {
    throw new Error("Usage: npx pm-skill delete <issue> [issue2 ...]");
  }

  for (const identifier of identifiers) {
    const detail = await getIssueDetail(ctx.linear, identifier);

    // Delete linked Notion pages
    if (ctx.notion && detail.attachments.length > 0) {
      for (const att of detail.attachments) {
        if (att.url.includes("notion.so")) {
          const pageId = extractNotionPageId(att.url);
          if (pageId) {
            try {
              await deletePage(ctx.notion, pageId);
              console.log(`  [Notion] Deleted: ${att.title}`);
            } catch {
              console.log(`  [Notion] Could not delete: ${att.url} (may already be deleted or no access)`);
            }
          }
        }
      }
    }

    // Delete Linear issue
    await deleteIssue(ctx.linear, detail.issue.id);
    console.log(`✅ Deleted: ${detail.issue.identifier} (${detail.issue.title})`);
  }
}

async function selectProject(args: minimist.ParsedArgs): Promise<void> {
  // Load env manually — we need API key and team ID but not project ID
  const { loadEnvFile, writeEnvFile } = await import("./env.js");
  loadEnvFile();

  const apiKey = process.env.LINEAR_API_KEY;
  const teamId = process.env.LINEAR_DEFAULT_TEAM_ID;
  if (!apiKey || !teamId) {
    throw new Error("LINEAR_API_KEY and LINEAR_DEFAULT_TEAM_ID must be set. Run 'npx pm-skill init' first.");
  }

  const client = getLinearClient(apiKey);
  const projects = await getTeamProjects(client, teamId);

  if (projects.length === 0) {
    console.log("No projects found for this team.");
    return;
  }

  const projectIdArg = args._[0] as string | undefined;

  if (projectIdArg) {
    // Direct selection by ID or name
    const match = projects.find(
      (p) => p.id === projectIdArg || p.name.toLowerCase() === projectIdArg.toLowerCase()
    );
    if (!match) {
      console.log("Available projects:");
      for (const p of projects) {
        console.log(`  ${p.name} | ${p.id}`);
      }
      throw new Error(`Project '${projectIdArg}' not found.`);
    }
    writeEnvFile(process.cwd(), { LINEAR_DEFAULT_PROJECT_ID: match.id });
    console.log(`✅ Selected project: "${match.name}" (${match.id})`);
  } else {
    // List projects with current marker
    const currentId = process.env.LINEAR_DEFAULT_PROJECT_ID;
    console.log("Available projects:");
    for (const p of projects) {
      const marker = p.id === currentId ? " ← current" : "";
      console.log(`  ${p.name} | ${p.id}${marker}`);
    }
    console.log(`\nUsage: npx pm-skill select-project "<name or id>"`);
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
  "push-doc": pushDoc,
  "update-doc": updateDoc,
  "create-folder": createFolder,
  delete: del,
  get,
};

// ── Main ──

async function main(): Promise<void> {
  const args = minimist(process.argv.slice(2), {
    string: ["severity", "type", "url", "title", "content", "parent", "linear-key", "notion-key", "team-id", "project-id", "notion-page"],
    boolean: ["sync", "version"],
    alias: { s: "severity", t: "type" },
  });

  // --version
  if (args.version) {
    const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, "package.json"), "utf-8"));
    console.log(`pm-skill v${pkg.version}`);
    return;
  }

  const command = args._[0] as string;
  args._ = args._.slice(1);

  if (!command || command === "help") {
    console.log(`pm-skill — Structured project management CLI (Linear + Notion)

Usage: npx pm-skill <command> [args] [flags]

Commands:
  init --linear-key K [--notion-key K]
                                     Initialize project (validates keys, creates .env, config.yml, SKILL.md, AGENTS.md)
  setup [--sync]                     Verify config & label matching (--sync creates missing labels)
  select-project [name-or-id]        List or switch Linear project
  start-feature <title>              Start feature (Linear issue + Notion PRD)
  report-bug <title> [--severity S]  File bug report (severity: urgent/high/medium/low)
  add-task <parent> <title>          Add sub-task to an issue
  relate <issue1> <issue2> [--type T]  Link issues (type: related/similar)
  block <blocker> <blocked>          Set blocking relationship
  attach-doc <issue> --url U --title T --type Y
                                     Attach document (type: source-of-truth/issue-tracking/domain-knowledge)
  get <issue>                        Show issue details
  push-doc <issue> <file.md> [--title T] [--parent P]
                                     Upload markdown to Notion + link to issue
  push-doc <issue> --title T --content "# md" [--parent P]
                                     Push content directly (for AI agents)
  update-doc <page-id> <file.md>     Replace Notion page content with markdown
  update-doc <page-id> --content "# md"
                                     Replace content directly
  create-folder <name> [--parent P]  Create Notion folder (returns page ID for --parent)
  delete <issue> [issue2 ...]        Delete issue(s) + linked Notion pages
  help                               Show this help
  --version                          Show version

All config is per-project (CWD). Run 'npx pm-skill init' in each project.`);
    return;
  }

  // These commands run independently — no full env/config validation
  if (command === "init") {
    await init(args);
    return;
  }
  if (command === "select-project") {
    await selectProject(args);
    return;
  }

  const cmdFn = COMMANDS[command];
  if (!cmdFn) {
    const available = ["init", ...Object.keys(COMMANDS)].join(", ");
    throw new Error(
      `Unknown command: '${command}'\nAvailable: ${available}`
    );
  }

  const env = validateEnv(command);
  const config = loadConfig();

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
