/**
 * Local Model Tracking — register local AI models (Ollama, llama.cpp, vLLM, LM Studio)
 * with compute-time-based costing instead of token pricing.
 *
 * Cost formula: (durationSeconds / 3600) * costPerHour
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Types ──────────────────────────────────────────────────────

export interface LocalModelConfig {
  provider: string;
  model: string;
  costPerHour: number;   // USD per hour of GPU compute
  gpuName?: string;      // e.g. "RTX 4090", "M2 Ultra" — informational
  notes?: string;
}

export const COMPUTE_PRESETS = {
  'local-cpu':      { label: 'Local CPU / Apple Silicon',        costPerHour: 0.004 },
  'local-gpu':      { label: 'Local GPU (RTX 4090, electricity)', costPerHour: 0.07  },
  'cloud-4090':     { label: 'Cloud RTX 4090 (RunPod/Vast)',      costPerHour: 0.40  },
  'cloud-a100':     { label: 'Cloud A100 80GB (RunPod)',          costPerHour: 1.89  },
  'cloud-h100':     { label: 'Cloud H100 80GB (RunPod)',          costPerHour: 2.99  },
  'free':           { label: 'Treat as free (audit only)',        costPerHour: 0.00  },
} as const;

export type ComputePreset = keyof typeof COMPUTE_PRESETS;

// ── Storage ────────────────────────────────────────────────────

const DB_DIR = process.env.COSTHQ_DATA_DIR || join(homedir(), '.costhq');
const CONFIG_PATH = join(DB_DIR, 'local-models.json');

/** Providers auto-recognized as local (no explicit --local needed) */
const LOCAL_PROVIDER_PREFIXES = ['ollama', 'llamacpp', 'llama.cpp', 'vllm', 'lmstudio', 'localai', 'jan', 'koboldcpp'];

function ensureDir() {
  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });
}

function loadConfigFile(): LocalModelConfig[] {
  if (!existsSync(CONFIG_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (c: any) =>
        c &&
        typeof c.provider === 'string' &&
        typeof c.model === 'string' &&
        typeof c.costPerHour === 'number' &&
        c.costPerHour >= 0
    );
  } catch {
    return [];
  }
}

function saveConfigFile(configs: LocalModelConfig[]): void {
  ensureDir();
  writeFileSync(CONFIG_PATH, JSON.stringify(configs, null, 2));
}

function modelKey(provider: string, model: string): string {
  const baseModel = model.split(':')[0].toLowerCase();
  return `${provider.toLowerCase()}/${baseModel}`;
}

// ── Public API ─────────────────────────────────────────────────

export function addLocalModel(config: LocalModelConfig): LocalModelConfig {
  const configs = loadConfigFile();
  const key = modelKey(config.provider, config.model);

  // Upsert: replace if exists
  const idx = configs.findIndex(c => modelKey(c.provider, c.model) === key);
  const entry: LocalModelConfig = {
    provider: config.provider.toLowerCase(),
    model: config.model,
    costPerHour: config.costPerHour,
    gpuName: config.gpuName || undefined,
    notes: config.notes || undefined,
  };

  if (idx >= 0) {
    configs[idx] = entry;
  } else {
    configs.push(entry);
  }

  saveConfigFile(configs);
  return entry;
}

export function removeLocalModel(provider: string, model: string): boolean {
  const configs = loadConfigFile();
  const key = modelKey(provider, model);
  const filtered = configs.filter(c => modelKey(c.provider, c.model) !== key);
  if (filtered.length === configs.length) return false;
  saveConfigFile(filtered);
  return true;
}

export function getLocalModels(): LocalModelConfig[] {
  return loadConfigFile();
}

/**
 * Check if a provider/model is local — either explicitly registered
 * or the provider matches a known local prefix.
 */
export function isLocalModel(provider: string, model: string): boolean {
  const key = modelKey(provider, model);
  const configs = loadConfigFile();
  if (configs.some(c => modelKey(c.provider, c.model) === key)) return true;

  // Check provider prefix
  const lp = provider.toLowerCase();
  return LOCAL_PROVIDER_PREFIXES.some(p => lp === p || lp.startsWith(p + '/'));
}

/**
 * Check if a provider name is a known local provider prefix.
 */
export function isLocalProvider(provider: string): boolean {
  const lp = provider.toLowerCase();
  return LOCAL_PROVIDER_PREFIXES.some(p => lp === p || lp.startsWith(p + '/'));
}

/**
 * Calculate cost from compute duration.
 * Falls back to a lookup of the registered costPerHour.
 * Returns 0 if model not found.
 */
export function calculateLocalCost(provider: string, model: string, durationSeconds: number): number {
  const configs = loadConfigFile();
  const key = modelKey(provider, model);
  const config = configs.find(c => modelKey(c.provider, c.model) === key);

  if (!config) return 0;
  const hours = durationSeconds / 3600;
  return Math.round(hours * config.costPerHour * 1e10) / 1e10;
}

/**
 * Get the configured cost-per-hour for a local model, or null if not registered.
 */
export function getLocalModelRate(provider: string, model: string): number | null {
  const configs = loadConfigFile();
  const key = modelKey(provider, model);
  const config = configs.find(c => modelKey(c.provider, c.model) === key);
  return config ? config.costPerHour : null;
}

// ── Duration Parsing ───────────────────────────────────────────

/**
 * Parse a human-readable duration string into seconds.
 * Supports: "120" (plain seconds), "2m", "2m30s", "1h30m", "1h", "90s", "1.5h"
 */
export function parseDuration(input: string): number | null {
  const trimmed = input.trim();

  // Plain number → seconds
  const plain = Number(trimmed);
  if (!isNaN(plain) && plain >= 0) return Math.round(plain);

  // Pattern: combinations of Nh, Nm, Ns (e.g. "1h30m", "2m30s", "45s")
  const pattern = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?$/i;
  const match = trimmed.match(pattern);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;

  const hours = parseFloat(match[1] || '0');
  const minutes = parseFloat(match[2] || '0');
  const seconds = parseFloat(match[3] || '0');

  const total = hours * 3600 + minutes * 60 + seconds;
  return total >= 0 ? Math.round(total) : null;
}

// ── Ollama Auto-Detect ─────────────────────────────────────────

const OLLAMA_DEFAULT_URL = 'http://localhost:11434';

/**
 * Try to detect running Ollama models via GET /api/tags.
 * Returns model names on success, empty array on failure (Ollama not running).
 * Non-blocking — 2s timeout.
 */
export async function detectOllamaModels(): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${OLLAMA_DEFAULT_URL}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return [];
    const data = (await res.json()) as any;
    if (!data.models || !Array.isArray(data.models)) return [];

    return data.models.map((m: any) => String(m.name || m.model || '')).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Auto-register all detected Ollama models with a given cost-per-hour rate.
 * Returns the list of newly registered model names.
 */
export async function autoRegisterOllamaModels(costPerHour: number, gpuName?: string): Promise<string[]> {
  const models = await detectOllamaModels();
  const registered: string[] = [];

  for (const modelName of models) {
    addLocalModel({
      provider: 'ollama',
      model: modelName,
      costPerHour,
      gpuName,
      notes: 'Auto-detected from Ollama',
    });
    registered.push(modelName);
  }

  return registered;
}
