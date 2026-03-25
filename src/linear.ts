import { LinearClient, IssueRelationType, type Issue, type IssueLabel, type WorkflowState, type Team } from "@linear/sdk";

// ── Client ──

let _client: LinearClient | null = null;

export function getLinearClient(apiKey: string): LinearClient {
  if (!_client) {
    _client = new LinearClient({ apiKey });
  }
  return _client;
}

/**
 * Validate a Linear API key by calling viewer endpoint.
 * Returns user info on success, throws on failure.
 */
export async function validateLinearKey(apiKey: string): Promise<{ id: string; name: string; email: string }> {
  const client = new LinearClient({ apiKey });
  try {
    const viewer = await client.viewer;
    return { id: viewer.id, name: viewer.name, email: viewer.email };
  } catch {
    throw new Error("Linear API key validation failed. Check your key at: Linear > Settings > API > Personal API Keys");
  }
}

// ── Types ──

export interface CreateIssueOpts {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  labelIds?: string[];
  parentId?: string;
  projectId?: string;
  stateId?: string;
}

export interface IssueDetail {
  issue: Issue;
  children: Issue[];
  relations: Array<{ type: string; issue: Issue }>;
  attachments: Array<{ title: string; url: string; subtitle?: string | null }>;
}

// ── Issue CRUD ──

export async function createIssue(
  client: LinearClient,
  opts: CreateIssueOpts
): Promise<Issue> {
  const payload = await client.createIssue({
    teamId: opts.teamId,
    title: opts.title,
    description: opts.description,
    priority: opts.priority,
    labelIds: opts.labelIds,
    parentId: opts.parentId,
    projectId: opts.projectId,
    stateId: opts.stateId,
  });

  const issue = await payload.issue;
  if (!issue) {
    throw new Error("이슈 생성에 실패했습니다.");
  }
  return issue;
}

export async function updateIssue(
  client: LinearClient,
  id: string,
  input: Record<string, unknown>
): Promise<void> {
  await client.updateIssue(id, input);
}

export async function getIssue(
  client: LinearClient,
  identifier: string
): Promise<Issue> {
  try {
    return await client.issue(identifier);
  } catch {
    throw new Error(`이슈 '${identifier}'을 찾을 수 없습니다.`);
  }
}

export async function getIssueDetail(
  client: LinearClient,
  identifier: string
): Promise<IssueDetail> {
  const issue = await getIssue(client, identifier);

  const [childrenConn, relationsConn, attachmentsConn] = await Promise.all([
    issue.children(),
    issue.relations(),
    issue.attachments(),
  ]);

  const relations: IssueDetail["relations"] = [];
  for (const rel of relationsConn.nodes) {
    const relatedIssue = await rel.relatedIssue;
    if (relatedIssue) {
      relations.push({ type: rel.type, issue: relatedIssue });
    }
  }

  return {
    issue,
    children: childrenConn.nodes,
    relations,
    attachments: attachmentsConn.nodes.map((a) => ({
      title: a.title,
      url: a.url,
      subtitle: a.subtitle,
    })),
  };
}

// ── Relations ──

const RELATION_TYPE_MAP: Record<string, IssueRelationType> = {
  blocks: IssueRelationType.Blocks,
  related: IssueRelationType.Related,
  similar: IssueRelationType.Similar,
  duplicate: IssueRelationType.Duplicate,
};

export async function createRelation(
  client: LinearClient,
  issueId: string,
  relatedIssueId: string,
  type: "blocks" | "related" | "similar"
): Promise<void> {
  const relationType = RELATION_TYPE_MAP[type];
  if (!relationType) {
    throw new Error(`알 수 없는 관계 유형: '${type}'`);
  }
  await client.createIssueRelation({
    issueId,
    relatedIssueId,
    type: relationType,
  });
}

// ── Attachments ──

export async function createAttachment(
  client: LinearClient,
  issueId: string,
  url: string,
  title: string,
  subtitle?: string
): Promise<void> {
  await client.createAttachment({
    issueId,
    url,
    title,
    subtitle,
  });
}

// ── Label Creation ──

export async function createLabel(
  client: LinearClient,
  teamId: string,
  name: string,
  opts?: { description?: string; color?: string }
): Promise<{ id: string; name: string }> {
  const payload = await client.createIssueLabel({
    teamId,
    name,
    description: opts?.description,
    color: opts?.color,
  });
  const label = await payload.issueLabel;
  if (!label) {
    throw new Error(`Failed to create label '${name}'.`);
  }
  return { id: label.id, name: label.name };
}

// ── Team / Labels / States ──

export async function getTeams(client: LinearClient): Promise<Team[]> {
  const conn = await client.teams();
  return conn.nodes;
}

export async function getTeamStates(
  client: LinearClient,
  teamId: string
): Promise<WorkflowState[]> {
  const team = await client.team(teamId);
  const conn = await team.states();
  return conn.nodes;
}

export async function getTeamLabels(
  client: LinearClient,
  teamId: string
): Promise<IssueLabel[]> {
  const team = await client.team(teamId);
  const conn = await team.labels();
  return conn.nodes;
}

/**
 * config의 label name으로 Linear 워크스페이스 라벨 ID를 매칭합니다.
 * 대소문자 무시 매칭. 미매칭 시 에러.
 */
export function resolveLabels(
  configLabelNames: string[],
  teamLabels: IssueLabel[]
): string[] {
  const ids: string[] = [];
  const labelMap = new Map(
    teamLabels.map((l) => [l.name.toLowerCase(), l.id])
  );

  for (const name of configLabelNames) {
    const id = labelMap.get(name.toLowerCase());
    if (!id) {
      const available = teamLabels.map((l) => l.name).join(", ");
      throw new Error(
        `Linear 워크스페이스에서 라벨 '${name}'을 찾을 수 없습니다.\n` +
          `사용 가능한 라벨: ${available}\n` +
          `'setup' 커맨드로 라벨 매칭 상태를 확인하세요.`
      );
    }
    ids.push(id);
  }

  return ids;
}
