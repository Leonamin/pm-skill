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

// ── Page CRUD ──

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
