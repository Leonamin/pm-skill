import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(__dirname, "..");

/**
 * Resolve a file by checking multiple directories in order:
 * 1. CWD (project-local override)
 * 2. ~/.pm-skill/ (user-global config)
 * 3. Package root (bundled defaults)
 */
export function resolveFile(filename: string): string | null {
  const candidates = [
    resolve(process.cwd(), filename),
    resolve(homedir(), ".pm-skill", filename),
    resolve(PKG_ROOT, filename),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

export interface ValidatedEnv {
  LINEAR_API_KEY: string;
  LINEAR_DEFAULT_TEAM_ID: string;
  LINEAR_DEFAULT_PROJECT_ID?: string;
  NOTION_API_KEY?: string;
  NOTION_ROOT_PAGE_ID?: string;
  NOTION_BUG_DB_ID?: string;
}

const REQUIRED_KEYS = ["LINEAR_API_KEY", "LINEAR_DEFAULT_TEAM_ID"] as const;

const NOTION_KEYS = ["NOTION_API_KEY", "NOTION_ROOT_PAGE_ID"] as const;

const KEY_HELP: Record<string, string> = {
  LINEAR_API_KEY:
    "Linear > Settings > API > Personal API Keys",
  LINEAR_DEFAULT_TEAM_ID:
    "'pm-skill setup' to discover your team ID",
  LINEAR_DEFAULT_PROJECT_ID:
    "Linear > Project Settings (optional)",
  NOTION_API_KEY: "https://www.notion.so/my-integrations",
  NOTION_ROOT_PAGE_ID:
    "Parent page ID where Notion docs will be created",
  NOTION_BUG_DB_ID:
    "Notion DB ID for bug tracking (optional — falls back to page creation)",
};

export function loadEnvFile(): void {
  const envPath = resolveFile(".env");
  if (!envPath) return;

  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
}

export function validateEnv(command: string): ValidatedEnv {
  loadEnvFile();

  const missing: string[] = [];

  if (command === "setup") {
    if (!process.env.LINEAR_API_KEY) {
      missing.push("LINEAR_API_KEY");
    }
  } else {
    for (const key of REQUIRED_KEYS) {
      if (!process.env[key]) missing.push(key);
    }
  }

  const notionCommands = ["start-feature", "report-bug"];
  if (notionCommands.includes(command)) {
    for (const key of NOTION_KEYS) {
      if (!process.env[key]) missing.push(key);
    }
  }

  if (missing.length > 0) {
    const hints = missing
      .map((k) => `  ${k}: ${KEY_HELP[k] ?? ""}`)
      .join("\n");
    throw new Error(
      `Required environment variables are not set:\n${hints}\n\n` +
        `Create a .env file in one of: CWD, ~/.pm-skill/, or the package root.\n` +
        `See .env.example for the template.`
    );
  }

  return {
    LINEAR_API_KEY: process.env.LINEAR_API_KEY!,
    LINEAR_DEFAULT_TEAM_ID: process.env.LINEAR_DEFAULT_TEAM_ID!,
    LINEAR_DEFAULT_PROJECT_ID: process.env.LINEAR_DEFAULT_PROJECT_ID,
    NOTION_API_KEY: process.env.NOTION_API_KEY,
    NOTION_ROOT_PAGE_ID: process.env.NOTION_ROOT_PAGE_ID,
    NOTION_BUG_DB_ID: process.env.NOTION_BUG_DB_ID,
  };
}
