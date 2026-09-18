// OpenAI 兼容接口 + 多模型故障转移。
// 支持按人设/群传入 preferred 模型列表, 额度耗尽自动切下一个, 失败冷却 10 分钟。
import { loadAiCfg, aiConfigEnabled } from './config.js';

export function isAiEnabled() {
  return aiConfigEnabled(loadAiCfg());
}

const MODEL_COOLDOWN_MS = 600_000;
const blockedUntil = new Map();
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;
const TOTAL_DEADLINE_MS = 28_000;

function isBlocked(model, now = Date.now()) {
  return (blockedUntil.get(model) ?? 0) > now;
}

function blockModel(model) {
  blockedUntil.set(model, Date.now() + MODEL_COOLDOWN_MS);
  console.log(`[ai] 冷却模型 ${model} 10分钟`);
}

function resolveModels(preferred = null) {
  const cfg = loadAiCfg();
  const all = cfg.models ?? [];
  if (!preferred?.length) return all;
  const ordered = [];
  for (const m of preferred) {
    if (!ordered.includes(m)) ordered.push(m);
  }
  for (const m of all) {
    if (!ordered.includes(m)) ordered.push(m);
  }
  return ordered;
}

export function getAssignments() {
  return loadAiCfg().assignments ?? { personas: {}, groups: {} };
}

export function llmPreferenceFor(kind, id) {
  const a = getAssignments();
  if (kind === 'persona') return a.personas?.[id]?.llm ?? null;
  if (kind === 'group') return a.groups?.[id]?.llm ?? null;
  return null;
}

export function imagePreferenceFor(kind, id) {
  const a = getAssignments();
  if (kind === 'persona') return a.personas?.[id]?.image ?? null;
  if (kind === 'group') return a.groups?.[id]?.image ?? null;
  return null;
}

export function videoPreferenceFor(kind, id) {
  const a = getAssignments();
  if (kind === 'persona') return a.personas?.[id]?.video ?? null;
  if (kind === 'group') return a.groups?.[id]?.video ?? null;
  return null;
}

async function callModel(model, systemPrompt, context, signal) {
  const cfg = loadAiCfg();
  const res = await fetch(`${String(cfg.baseURL).replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model,
      temperature: cfg.temperature ?? 0.9,
      max_tokens: cfg.maxTokens ?? 120,
      messages: [{ role: 'system', content: systemPrompt }, ...context],
    }),
    signal,
  });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(`HTTP ${res.status} [${model}]: ${body}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
}

/**
 * 调用 LLM, 带 preferred 模型优先与故障转移。
 * 每个模型独立 AbortController, 避免超时污染后续模型。
 * @returns {Promise<{text: string|null, model: string|null}>}
 */
export async function chat(systemPrompt, context, preferred = null) {
  if (!isAiEnabled()) return { text: null, model: null };
  const models = resolveModels(preferred);
  const started = Date.now();
  let attempts = 0;
  for (const model of models) {
    if (attempts >= MAX_ATTEMPTS) break;
    if (Date.now() - started > TOTAL_DEADLINE_MS) break;
    if (isBlocked(model, Date.now())) continue;
    attempts += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const text = await callModel(model, systemPrompt, context, controller.signal);
      if (text) return { text, model };
      blockModel(model);
    } catch (err) {
      if (controller.signal.aborted) {
        console.error(`[ai] 超时 [${model}]`);
      } else {
        console.error(`[ai] ${err.message}`);
      }
      blockModel(model);
    } finally {
      clearTimeout(timer);
    }
  }
  return { text: null, model: null };
}
