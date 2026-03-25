import { readFileSync } from "fs";
import yaml from "js-yaml";

import { resolveFile } from "./env.js";

// ── Types ──

export interface PmLabel {
  id: string;
  name: string;
  description: string;
  color?: string;
}

export interface PmTemplate {
  id: string;
  name: string;
  description: string;
  notion_template: string;
  linear_labels: string[];
  linear_priority?: string;
}

export interface PmPriority {
  linear: number;
  name: string;
}

export interface PmDocType {
  id: string;
  description: string;
}

export interface PmEpic {
  id: string;
  name: string;
}

export interface PmConfig {
  labels: PmLabel[];
  templates: PmTemplate[];
  priorities: Record<string, PmPriority>;
  severity_mapping: Record<string, string>;
  doc_types: PmDocType[];
  epics: PmEpic[];
}

// ── Validation ──

class ConfigValidationError extends Error {
  constructor(message: string) {
    super(`[Config validation failed] ${message}`);
    this.name = "ConfigValidationError";
  }
}

function validateLabels(labels: unknown): asserts labels is PmLabel[] {
  if (!Array.isArray(labels) || labels.length === 0) {
    throw new ConfigValidationError("labels array is empty or missing.");
  }
  for (const label of labels) {
    if (!label.id || !label.name) {
      throw new ConfigValidationError(
        `Label missing id or name: ${JSON.stringify(label)}`
      );
    }
    if (!label.description) {
      throw new ConfigValidationError(
        `Label '${label.id}' is missing description. All labels require a description.`
      );
    }
  }
}

function validateTemplates(
  templates: unknown,
  labelIds: Set<string>
): asserts templates is PmTemplate[] {
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new ConfigValidationError("templates array is empty or missing.");
  }
  for (const tmpl of templates) {
    if (!tmpl.id || !tmpl.name || !tmpl.description || !tmpl.notion_template) {
      throw new ConfigValidationError(
        `Template '${tmpl.id ?? "(unknown)"}' is missing required fields (id, name, description, notion_template).`
      );
    }
    if (Array.isArray(tmpl.linear_labels)) {
      for (const lid of tmpl.linear_labels) {
        if (!labelIds.has(lid)) {
          throw new ConfigValidationError(
            `Template '${tmpl.id}' references unregistered label '${lid}' in linear_labels.`
          );
        }
      }
    }
  }
}

function validatePriorities(
  priorities: unknown
): asserts priorities is Record<string, PmPriority> {
  if (!priorities || typeof priorities !== "object") {
    throw new ConfigValidationError("priorities is missing.");
  }
  for (const key of ["p0", "p1", "p2", "p3"]) {
    const p = (priorities as Record<string, unknown>)[key];
    if (
      !p ||
      typeof (p as PmPriority).linear !== "number" ||
      typeof (p as PmPriority).name !== "string"
    ) {
      throw new ConfigValidationError(
        `priorities.${key} requires linear (number) and name (string).`
      );
    }
  }
}

function validateSeverityMapping(
  mapping: unknown,
  priorityKeys: Set<string>
): asserts mapping is Record<string, string> {
  if (!mapping || typeof mapping !== "object") {
    throw new ConfigValidationError("severity_mapping is missing.");
  }
  for (const [severity, pKey] of Object.entries(
    mapping as Record<string, string>
  )) {
    if (!priorityKeys.has(pKey)) {
      throw new ConfigValidationError(
        `severity_mapping '${severity}: ${pKey}' — '${pKey}' is not defined in priorities.`
      );
    }
  }
}

function validateDocTypes(
  docTypes: unknown
): asserts docTypes is PmDocType[] {
  if (!Array.isArray(docTypes) || docTypes.length === 0) {
    throw new ConfigValidationError("doc_types array is empty or missing.");
  }
  for (const dt of docTypes) {
    if (!dt.id || !dt.description) {
      throw new ConfigValidationError(
        `doc_type '${dt.id ?? "(unknown)"}' is missing id or description.`
      );
    }
  }
}

// ── Loader ──

export function loadConfig(configPath?: string): PmConfig {
  const path = configPath ?? resolveFile("config.yml");
  if (!path) {
    throw new ConfigValidationError(
      "config.yml not found. Looked in: CWD, ~/.pm-skill/, package root.\n" +
        "Copy the bundled config.yml to one of these locations and customize it."
    );
  }

  let raw: Record<string, unknown>;

  try {
    const content = readFileSync(path, "utf-8");
    raw = yaml.load(content) as Record<string, unknown>;
  } catch (e) {
    throw new ConfigValidationError(
      `Cannot read config.yml: ${path}\n${(e as Error).message}`
    );
  }

  validateLabels(raw.labels);
  const labelIds = new Set(raw.labels.map((l: PmLabel) => l.id));

  validateTemplates(raw.templates, labelIds);
  validatePriorities(raw.priorities);

  const priorityKeys = new Set(Object.keys(raw.priorities as object));
  validateSeverityMapping(raw.severity_mapping, priorityKeys);
  validateDocTypes(raw.doc_types);

  return {
    labels: raw.labels as PmLabel[],
    templates: raw.templates as PmTemplate[],
    priorities: raw.priorities as Record<string, PmPriority>,
    severity_mapping: raw.severity_mapping as Record<string, string>,
    doc_types: raw.doc_types as PmDocType[],
    epics: Array.isArray(raw.epics) ? (raw.epics as PmEpic[]) : [],
  };
}

// ── Query helpers ──

export function validateLabel(config: PmConfig, labelId: string): PmLabel {
  const label = config.labels.find((l) => l.id === labelId);
  if (!label) {
    const available = config.labels.map((l) => l.id).join(", ");
    throw new Error(
      `Label '${labelId}' is not defined in config.\nAvailable: ${available}`
    );
  }
  return label;
}

export function validateDocType(
  config: PmConfig,
  typeId: string
): PmDocType {
  const dt = config.doc_types.find((d) => d.id === typeId);
  if (!dt) {
    const available = config.doc_types.map((d) => d.id).join(", ");
    throw new Error(
      `Doc type '${typeId}' is not defined in config.\nAvailable: ${available}`
    );
  }
  return dt;
}

export function getTemplate(
  config: PmConfig,
  templateId: string
): PmTemplate {
  const tmpl = config.templates.find((t) => t.id === templateId);
  if (!tmpl) {
    const available = config.templates.map((t) => t.id).join(", ");
    throw new Error(
      `Template '${templateId}' is not defined in config.\nAvailable: ${available}`
    );
  }
  return tmpl;
}

export function resolvePriority(
  config: PmConfig,
  priorityKey: string
): number {
  const p = config.priorities[priorityKey];
  if (!p) {
    throw new Error(
      `Priority '${priorityKey}' is not defined in config.`
    );
  }
  return p.linear;
}

export function resolveSeverity(
  config: PmConfig,
  severity: string
): number {
  const pKey = config.severity_mapping[severity];
  if (!pKey) {
    const available = Object.keys(config.severity_mapping).join(", ");
    throw new Error(
      `Severity '${severity}' is not defined in config severity_mapping.\nAvailable: ${available}`
    );
  }
  return resolvePriority(config, pKey);
}
