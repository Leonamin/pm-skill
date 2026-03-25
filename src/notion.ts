import { Client } from "@notionhq/client";
import type { BlockObjectRequest } from "@notionhq/client/build/src/api-endpoints.js";
import { markdownToBlocks } from "@tryfabric/martian";

// ── Client ──

let _client: Client | null = null;

export function getNotionClient(apiKey: string): Client {
  if (!_client) {
    _client = new Client({ auth: apiKey });
  }
  return _client;
}

/**
 * Validate a Notion API key by calling users.me endpoint.
 * Returns bot info on success, throws on failure.
 */
export async function validateNotionKey(apiKey: string): Promise<{ id: string; name: string }> {
  const client = new Client({ auth: apiKey });
  try {
    const me = await client.users.me({});
    return { id: me.id, name: me.name ?? "(unnamed integration)" };
  } catch {
    throw new Error("Notion API key validation failed. Check your key at: https://www.notion.so/my-integrations");
  }
}

// ── Types ──

type RichText = {
  type: "text";
  text: { content: string; link?: { url: string } | null };
};

// ── Block Builders ──

function text(content: string): RichText[] {
  return [{ type: "text", text: { content } }];
}

function heading1(content: string): BlockObjectRequest {
  return {
    object: "block" as const,
    type: "heading_1" as const,
    heading_1: { rich_text: text(content) },
  };
}

function heading2(content: string): BlockObjectRequest {
  return {
    object: "block" as const,
    type: "heading_2" as const,
    heading_2: { rich_text: text(content) },
  };
}

function paragraph(content: string): BlockObjectRequest {
  return {
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: { rich_text: text(content) },
  };
}

function todo(content: string, checked = false): BlockObjectRequest {
  return {
    object: "block" as const,
    type: "to_do" as const,
    to_do: { rich_text: text(content), checked },
  };
}

function numberedItem(content: string): BlockObjectRequest {
  return {
    object: "block" as const,
    type: "numbered_list_item" as const,
    numbered_list_item: { rich_text: text(content) },
  };
}

function bookmark(url: string): BlockObjectRequest {
  return {
    object: "block" as const,
    type: "bookmark" as const,
    bookmark: { url },
  };
}

function divider(): BlockObjectRequest {
  return {
    object: "block" as const,
    type: "divider" as const,
    divider: {},
  };
}

// ── Template Builders ──

export function buildFeaturePRD(
  title: string,
  linearUrl: string
): BlockObjectRequest[] {
  return [
    heading2(`📋 ${title}`),
    bookmark(linearUrl),
    divider(),
    heading1("목표"),
    paragraph(""),
    heading1("배경"),
    paragraph(""),
    heading1("요구사항"),
    todo("요구사항 1"),
    todo("요구사항 2"),
    todo("요구사항 3"),
    heading1("설계"),
    paragraph(""),
    heading1("테스트 계획"),
    paragraph(""),
  ];
}

export function buildBugReport(
  title: string,
  severity: string,
  linearUrl: string
): BlockObjectRequest[] {
  return [
    heading2(`🐛 ${title} (${severity})`),
    bookmark(linearUrl),
    divider(),
    heading1("재현 단계"),
    numberedItem("단계 1"),
    numberedItem("단계 2"),
    numberedItem("단계 3"),
    heading1("예상 동작"),
    paragraph(""),
    heading1("실제 동작"),
    paragraph(""),
    heading1("환경"),
    paragraph("OS / 브라우저 / 디바이스"),
    heading1("해결 방안"),
    paragraph(""),
  ];
}

export function buildDesignDoc(
  title: string,
  linearUrl: string
): BlockObjectRequest[] {
  return [
    heading2(`📐 ${title}`),
    bookmark(linearUrl),
    divider(),
    heading1("개요"),
    paragraph(""),
    heading1("제약 조건"),
    paragraph(""),
    heading1("옵션 비교"),
    paragraph(""),
    heading1("결정"),
    paragraph(""),
    heading1("후속 작업"),
    todo("후속 작업 1"),
    todo("후속 작업 2"),
  ];
}

export function buildImprovement(
  title: string,
  linearUrl: string
): BlockObjectRequest[] {
  return [
    heading2(`✨ ${title}`),
    bookmark(linearUrl),
    divider(),
    heading1("현재 상태"),
    paragraph(""),
    heading1("개선 목표"),
    paragraph(""),
    heading1("변경 사항"),
    todo("변경 1"),
    todo("변경 2"),
    todo("변경 3"),
    heading1("영향 범위"),
    paragraph(""),
  ];
}

export function buildRefactor(
  title: string,
  linearUrl: string
): BlockObjectRequest[] {
  return [
    heading2(`🔧 ${title}`),
    bookmark(linearUrl),
    divider(),
    heading1("리팩토링 대상"),
    paragraph(""),
    heading1("현재 문제점"),
    paragraph(""),
    heading1("변경 계획"),
    todo("단계 1"),
    todo("단계 2"),
    heading1("검증 방법"),
    paragraph(""),
  ];
}

// ── Template Dispatcher ──

const TEMPLATE_BUILDERS: Record<
  string,
  (title: string, linearUrl: string, severity?: string) => BlockObjectRequest[]
> = {
  "feature-prd": buildFeaturePRD,
  "bug-report": (t, u, s) => buildBugReport(t, s ?? "medium", u),
  "design-doc": buildDesignDoc,
  improvement: buildImprovement,
  refactor: buildRefactor,
};

export function getTemplateBlocks(
  notionTemplate: string,
  title: string,
  linearUrl: string,
  severity?: string
): BlockObjectRequest[] {
  const builder = TEMPLATE_BUILDERS[notionTemplate];
  if (!builder) {
    const available = Object.keys(TEMPLATE_BUILDERS).join(", ");
    throw new Error(
      `notion_template '${notionTemplate}'에 대한 빌더가 없습니다.\n등록된 템플릿: ${available}`
    );
  }
  return builder(title, linearUrl, severity);
}

// ── Page CRUD ──

export async function createPage(
  client: Client,
  parentPageId: string,
  title: string,
  blocks: BlockObjectRequest[]
): Promise<{ id: string; url: string }> {
  const response = await client.pages.create({
    parent: { page_id: parentPageId },
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
    children: blocks,
  });

  return {
    id: response.id,
    url: `https://notion.so/${response.id.replace(/-/g, "")}`,
  };
}

export async function createDatabaseEntry(
  client: Client,
  databaseId: string,
  properties: Record<string, unknown>
): Promise<{ id: string; url: string }> {
  const response = await client.pages.create({
    parent: { database_id: databaseId },
    properties: properties as Record<string, any>,
  });

  return {
    id: response.id,
    url: `https://notion.so/${response.id.replace(/-/g, "")}`,
  };
}

export async function createTemplatedPage(
  client: Client,
  parentPageId: string,
  notionTemplate: string,
  title: string,
  linearUrl: string,
  severity?: string
): Promise<{ id: string; url: string }> {
  const blocks = getTemplateBlocks(notionTemplate, title, linearUrl, severity);
  return createPage(client, parentPageId, title, blocks);
}

export async function getPage(
  client: Client,
  pageId: string
): Promise<Record<string, unknown>> {
  return (await client.pages.retrieve({ page_id: pageId })) as Record<
    string,
    unknown
  >;
}

export async function searchPages(
  client: Client,
  query: string
): Promise<Array<{ id: string; title: string }>> {
  const response = await client.search({
    query,
    filter: { property: "object", value: "page" },
  });

  return response.results.map((page: any) => ({
    id: page.id,
    title:
      page.properties?.title?.title?.[0]?.text?.content ??
      page.properties?.Name?.title?.[0]?.text?.content ??
      "(untitled)",
  }));
}

// ── Page Deletion ──

/**
 * Archive (delete) a Notion page by ID.
 */
export async function deletePage(client: Client, pageId: string): Promise<void> {
  await client.pages.update({ page_id: pageId, archived: true });
}

/**
 * Extract Notion page ID from a Notion URL.
 * Handles formats like: https://notion.so/abc123def456... or https://www.notion.so/workspace/Page-Title-abc123def456
 */
export function extractNotionPageId(url: string): string | null {
  const match = url.match(/([a-f0-9]{32})(?:\?|$)/);
  if (match) {
    const raw = match[1];
    // Format as UUID
    return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
  }
  return null;
}

// ── Markdown Upload ──

/**
 * Convert markdown to Notion blocks.
 */
export function mdToBlocks(markdown: string): BlockObjectRequest[] {
  return markdownToBlocks(markdown) as BlockObjectRequest[];
}

/**
 * Create a Notion page from markdown content.
 * Handles the 100-block-per-request API limit by chunking.
 */
export async function createPageFromMarkdown(
  client: Client,
  parentPageId: string,
  title: string,
  markdown: string
): Promise<{ id: string; url: string }> {
  const blocks = mdToBlocks(markdown);

  // First batch goes with page creation (max 100)
  const firstBatch = blocks.slice(0, 100);
  const rest = blocks.slice(100);

  const response = await client.pages.create({
    parent: { page_id: parentPageId },
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
    children: firstBatch,
  });

  const pageId = response.id;

  // Append remaining blocks in chunks of 100
  for (let i = 0; i < rest.length; i += 100) {
    await client.blocks.children.append({
      block_id: pageId,
      children: rest.slice(i, i + 100),
    });
  }

  return {
    id: pageId,
    url: `https://notion.so/${pageId.replace(/-/g, "")}`,
  };
}

/**
 * Clear all blocks from a page, then append new markdown content.
 */
export async function updatePageContent(
  client: Client,
  pageId: string,
  markdown: string
): Promise<void> {
  // 1. Delete existing blocks
  const existing = await client.blocks.children.list({ block_id: pageId });
  for (const block of existing.results) {
    await client.blocks.delete({ block_id: block.id });
  }

  // 2. Append new blocks
  const blocks = mdToBlocks(markdown);
  for (let i = 0; i < blocks.length; i += 100) {
    await client.blocks.children.append({
      block_id: pageId,
      children: blocks.slice(i, i + 100),
    });
  }
}
