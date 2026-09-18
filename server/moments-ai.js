// 朋友圈 AI 互动: 发布后 AI 随机点赞/评论 (演示群友感)
import { stmts } from './db.js';
import { personas, personasForGroup } from './ai/personas.js';
import { isAiEnabled, llmPreferenceFor } from './ai/provider.js';
import { chat as llm } from './ai/provider.js';

const AI_IDS = personas.map((p) => p.id);

export function personaDbId(personaId) {
  const i = AI_IDS.indexOf(personaId);
  return i >= 0 ? -(i + 1) : -999;
}

export function personaByDbId(uid) {
  if (uid >= 0) return null;
  const idx = -uid - 1;
  return personas[idx] || null;
}

export function personaByKey(key) {
  return personas.find((p) => p.id === key) || null;
}

const CANNED_LIKES = true;
const CANNED_COMMENTS = [
  '有点意思',
  '拍得不错',
  '羡慕了',
  '哈哈哈',
  '下次叫我',
  '这也太行了',
  '可以可以',
  '细说',
];

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function publicPersonas() {
  return personasForGroup('main').length ? personasForGroup('main') : personas.slice(0, 4);
}

export function scheduleAiMomentReact(momentId, authorUserId) {
  const moment = stmts.momentById.get(Number(momentId));
  if (!moment) return;
  const pool = publicPersonas().filter((p) => p.id);
  if (!pool.length) return;

  const chosen = [...pool].sort(() => Math.random() - 0.5).slice(0, Math.random() < 0.55 ? 2 : 1);

  for (const persona of chosen) {
    const delay = rand(2500, 9000);
    setTimeout(async () => {
      try {
        // 点赞
        try {
          stmts.likeMoment.run(momentId, personaDbId(persona.id), Date.now());
          // 若主键冲突(已赞)则忽略
          try {
            stmts.insertMomentLikeAi?.run?.(momentId, personaDbId(persona.id), persona.id, Date.now());
          } catch { /* ignore */ }
        } catch { /* ignore */ }

        // 约一半概率评论
        if (Math.random() > 0.55) return;
        let text = pick(CANNED_COMMENTS);
        if (isAiEnabled() && moment.content && moment.content.length >= 2) {
          try {
            const { text: llmText } = await Promise.race([
              llm(
                `你是${persona.name}。在微信朋友圈给好友动态写一条很短的评论，像真人，不超过20字，不要引号。`,
                [{ role: 'user', content: `好友动态：${moment.content}` }],
                llmPreferenceFor('persona', persona.id)
              ),
              sleep(12000).then(() => ({ text: null })),
            ]);
            if (llmText && llmText.length <= 40) text = llmText.replace(/^["'「『]+|["'」』]+$/g, '').trim();
          } catch { /* canned fallback */ }
        }
        stmts.insertMomentComment.run(momentId, personaDbId(persona.id), text, Date.now(), null, null, persona.id);
      } catch (e) {
        console.error('[moments-ai]', e.message);
      }
    }, delay);
  }
}

// 补一条 AI 点赞写入 persona_key 的语句 (db 扩展在 moments.js 调用)
export function likeAsPersona(momentId, personaId) {
  const uid = personaDbId(personaId);
  try {
    stmts.likeMoment.run(Number(momentId), uid, Date.now());
    return true;
  } catch {
    return false;
  }
}
