// AI 群友触发引擎: 新人欢迎 / 随机插嘴 / 冷场开聊。
// 支持媒体消息: LLM 输出里的 [图片:描述] / [视频:描述] 会被解析并异步生成后发出。
import { personas, personasForGroup } from './personas.js';
import {
  chat as llm,
  isAiEnabled,
  llmPreferenceFor,
  imagePreferenceFor,
  videoPreferenceFor,
} from './provider.js';
import { genImage, genVideo, isMediaEnabled } from './media.js';
import { getGroup } from '../groups.js';
import {
  parseAgentCommand,
  createReminder,
  dueReminders,
  generateAgentFile,
  formatRemindConfirm,
  formatFileMessage,
} from './agent.js';

function resolveGroupKind(convId) {
  if (!convId || typeof convId !== 'string' || !convId.startsWith('grp_')) return 'main';
  const gid = Number(convId.replace(/^grp_/, ''));
  const g = Number.isInteger(gid) ? getGroup(gid) : null;
  return g?.kind || 'main';
}

function poolFor(convId) {
  return personasForGroup(resolveGroupKind(convId));
}

function mediaPrefs(persona, convId) {
  const groupKey = resolveGroupKind(convId);
  const groupImage = imagePreferenceFor('group', groupKey);
  const groupVideo = videoPreferenceFor('group', groupKey);
  const groupLlm = llmPreferenceFor('group', groupKey);
  const personaImage = imagePreferenceFor('persona', persona?.id);
  const personaVideo = videoPreferenceFor('persona', persona?.id);
  const personaLlm = llmPreferenceFor('persona', persona?.id);
  return {
    llm: personaLlm || groupLlm || null,
    image: groupImage || personaImage || null,
    video: groupVideo || personaVideo || null,
  };
}

function llmPrefs(persona, convId) {
  return mediaPrefs(persona, convId).llm;
}

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PERSONA_COOLDOWN_MS = 60_000;
const GLOBAL_COOLDOWN_MS = 15_000;
const CONTEXT_SIZE = 25;
const MEDIA_COOLDOWN_MS = 300_000;
const MEDIA_RE = /\[(图片|视频)[:：]([^\]]{2,120})\]/g;

export function createEngine({ config, deps }) {
  const { sendAI, getRecentContext, getConvContext, sendPrivateAI, getPrivateContext } = deps;
  const aiCfg = config.ai ?? {};
  const interjectRate = aiCfg.interjectRate ?? 0.4;
  const mentionRate = aiCfg.mentionRate ?? 0.9;
  const silenceMinutes = aiCfg.silenceMinutes ?? 4;
  const maxPer10Min = aiCfg.maxAIMessagesPer10Min ?? 30;

  const lastAIReply = new Map(personas.map((p) => [p.id, 0]));
  const lastMedia = new Map(personas.map((p) => [p.id, 0]));
  const lastConvAI = new Map(); // convId -> ts
  const busy = new Set();
  let lastGlobalAI = 0;
  let lastActivity = Date.now();
  let lastInterjector = null;
  let sentTimestamps = [];

  function ensurePersonaTs(id) {
    if (!lastAIReply.has(id)) lastAIReply.set(id, 0);
    if (!lastMedia.has(id)) lastMedia.set(id, 0);
  }

  const tooFast = () => {
    const cutoff = Date.now() - 600_000;
    sentTimestamps = sentTimestamps.filter((t) => t > cutoff);
    return sentTimestamps.length >= maxPer10Min;
  };

  function buildContext(persona, extraInstruction, convId = null) {
    const src = convId ? (getConvContext ? getConvContext(convId, CONTEXT_SIZE) : []) : getRecentContext(CONTEXT_SIZE);
    const history = (src || []).map((m) => {
      const isSelf = m.senderType === 'ai' && m.senderName === persona.name;
      return {
        role: isSelf ? 'assistant' : 'user',
        content: isSelf
          ? (m.mediaType ? `[发了${m.mediaType === 'image' ? '一张图' : '一个视频'}]` : m.content)
          : `${m.senderName}: ${m.content}`,
      };
    });
    if (extraInstruction) history.push({ role: 'user', content: extraInstruction });
    return history;
  }

  function buildPrivateContext(persona, convId, extraInstruction) {
    const history = (getPrivateContext(convId, CONTEXT_SIZE) ?? []).map((m) => {
      const isSelf = m.senderType === 'ai' && m.senderName === persona.name;
      return {
        role: isSelf ? 'assistant' : 'user',
        content: isSelf
          ? (m.mediaType ? `[发了${m.mediaType === 'image' ? '一张图' : '一个视频'}]` : m.content)
          : m.content,
      };
    });
    if (extraInstruction) history.push({ role: 'user', content: extraInstruction });
    return history;
  }

  function clean(text) {
    return text.replace(/^["'「『]+|["'」』]+$/g, '').trim();
  }

  function isAskingDoing(content = '') {
    return /在干嘛|在干什么|干嘛呢|做什么呢|在忙|忙啥|在吗\?|在吗？/.test(content);
  }

  function isQuestion(content = '') {
    return /[?？]|吗|呢|怎么|什么|哪|谁|多少|为什么|能不能|可不可以/.test(content);
  }

  // 问题类消息的对口兜底, 避免"有一说一 对的"这种不搭边回复
  function questionFallback(persona, content) {
    if (isAskingDoing(content)) {
      const doing = [
        '刚忙完, 歇会儿刷手机',
        '在吃饭呢, 你吃了没',
        '躺床上刷剧, 怎么了',
        '刚开完会, 脑子有点木',
        '在写东西, 快收尾了',
        '出门买东西, 一会儿回',
        '打完一局, 正好看到你消息',
      ];
      return pick(doing);
    }
    if (/名字|你是谁|叫什么/.test(content)) return `我是${persona.name}啊`;
    if (/在吗/.test(content)) return '在的, 说';
    return null;
  }

  function cannedLine(persona, kind, nick) {
    const line = pick(persona.canned[kind] ?? persona.canned.interject);
    return line.replace('{nick}', nick ?? '新人');
  }

  function isGenericFiller(text = '') {
    return /^(有一说一|确实|对的|对啊|嗯|行|行吧|笑死|好家伙|不至于|啊\?)[\s，。!！?？]*$/.test(text.trim());
  }

  async function generate(persona, kind, instruction, nick, convId = null, userContent = '') {
    const qFallback = questionFallback(persona, userContent);
    if (!isAiEnabled()) return qFallback || cannedLine(persona, kind, nick);
    const preferred = llmPrefs(persona, convId);
    const { text } = await llm(persona.systemPrompt, buildContext(persona, instruction, convId), preferred);
    let result = text ? clean(text) : null;

    // 问"在干嘛"却回了空话 → 强制换成对口回答
    if (isAskingDoing(userContent) && (!result || isGenericFiller(result))) {
      result = qFallback || '刚在忙手头的事, 你呢';
    }
    if (!result) {
      if (qFallback) return qFallback;
      return Math.random() < 0.4 ? cannedLine(persona, kind, nick) : null;
    }
    // 群聊问"在干嘛"也补图, 与私聊一致
    if (isAskingDoing(userContent) && !result.includes('[图片:')) {
      const scenes = ['正在吃的东西', '眼前的画面', '现在的样子', '手边的东西'];
      result += `\n[图片:${scenes[Math.floor(Math.random() * scenes.length)]}]`;
    }
    return result;
  }

  async function generatePrivate(persona, convId, instruction, userMessage) {
    const qFallback = questionFallback(persona, userMessage);
    if (!isAiEnabled()) return qFallback || cannedLine(persona, 'interject');
    const preferred = llmPreferenceFor('persona', persona?.id);
    // LLM 失败/超时后尽快回退到对口话术, 避免私聊长时间无响应
    let llmResult = null;
    try {
      llmResult = await Promise.race([
        llm(persona.systemPrompt, buildPrivateContext(persona, convId, instruction), preferred),
        sleep(22_000).then(() => ({ text: null, model: null })),
      ]);
    } catch {
      llmResult = { text: null, model: null };
    }
    const { text } = llmResult || {};
    let result = text ? clean(text) : null;
    if (isAskingDoing(userMessage) && (!result || isGenericFiller(result))) {
      result = qFallback || '刚在忙, 怎么了';
    }
    if (!result) return qFallback || cannedLine(persona, 'interject');

    if (isAskingDoing(userMessage) && !result.includes('[图片:')) {
      const scenes = ['正在吃的东西', '眼前的画面', '现在的样子', '手边的东西'];
      const scene = scenes[Math.floor(Math.random() * scenes.length)];
      result += `\n[图片:${scene}]`;
    }

    return result;
  }

  function parseMedia(text) {
    const media = [];
    let t = text.replace(MEDIA_RE, (_, type, prompt) => {
      media.push({ type: type === '图片' ? 'image' : 'video', prompt: prompt.trim() });
      return ' ';
    });
    t = t.replace(/\s+/g, ' ').trim();
    return { texts: t ? [t] : [], media };
  }

  function splitMessage(text) {
    if (text.length <= 25 || Math.random() < 0.45) return [text];
    const parts = text.split(/(?<=[。！？!?~…])\s*/).filter(Boolean);
    if (parts.length < 2) return [text];
    const chunks = [];
    for (let i = 0; i < parts.length && chunks.length < 3; i += 2) {
      chunks.push(parts.slice(i, i + 2).join(''));
    }
    return chunks.filter((c) => c.trim());
  }

  function sendMedia(persona, items, convId = null) {
    const prefs = mediaPrefs(persona, convId);
    for (const m of items.slice(0, 2)) {
      const now = Date.now();
      if (now - (lastMedia.get(persona.id) ?? 0) < MEDIA_COOLDOWN_MS) continue;
      if (!isMediaEnabled()) continue;
      lastMedia.set(persona.id, now);
      const kind = m.type;
      const p = kind === 'image'
        ? genImage(m.prompt, prefs.image)
        : genVideo(m.prompt, { preferred: prefs.video });
      p.then((url) => {
        if (url) sendAI(persona, `['${m.prompt.slice(0, 30)}']`, kind, url, convId);
      }).catch((err) => console.error(`[engine] ${kind} 生成失败: ${err.message}`));
    }
  }

  async function personaSpeak(persona, kind, instruction, nick, convId = null, userContent = '') {
    if (busy.has(persona.id)) return;
    ensurePersonaTs(persona.id);
    busy.add(persona.id);
    try {
      const raw = await generate(persona, kind, instruction, nick, convId, userContent);
      if (!raw) return;
      const { texts, media } = parseMedia(raw);
      const chunks = texts.length ? splitMessage(texts[0]) : [];
      for (let i = 0; i < chunks.length; i++) {
        const typing = i === 0 ? Math.min(5000, 800 + chunks[i].length * 45) : rand(600, 1200);
        await sleep(typing);
        sendAI(persona, chunks[i], null, null, convId);
        sentTimestamps.push(Date.now());
        lastAIReply.set(persona.id, Date.now());
        lastGlobalAI = Date.now();
        lastActivity = Date.now();
      }
      if (media.length) {
        await sleep(rand(1500, 3000));
        sendMedia(persona, media, convId);
      }
    } finally {
      busy.delete(persona.id);
    }
  }

  async function personaSpeakPrivate(persona, convId, instruction, userMessage) {
    // 私聊 busy 与群聊隔离, 群 AI 占线时私聊仍可回复
    const busyKey = `pv:${persona.id}`;
    if (busy.has(busyKey)) return;
    busy.add(busyKey);
    try {
      const raw = await generatePrivate(persona, convId, instruction, userMessage);
      if (!raw) return;
      const { texts, media } = parseMedia(raw);
      const chunks = texts.length ? splitMessage(texts[0]) : [];
      for (let i = 0; i < chunks.length; i++) {
        const typing = i === 0 ? Math.min(5000, 800 + chunks[i].length * 45) : rand(600, 1200);
        await sleep(typing);
        sendPrivateAI(convId, persona, chunks[i]);
      }
      if (media.length) {
        await sleep(rand(1500, 3000));
        const prefs = mediaPrefs(persona, null);
        for (const m of media.slice(0, 1)) {
          if (!isMediaEnabled()) continue;
          const kind = m.type;
          const p = kind === 'image'
            ? genImage(m.prompt, prefs.image)
            : genVideo(m.prompt, { preferred: prefs.video });
          p.then((url) => {
            if (url) sendPrivateAI(convId, persona, `['${m.prompt.slice(0, 30)}']`, kind, url);
          }).catch((err) => console.error(`[engine] 私聊 ${kind} 生成失败: ${err.message}`));
        }
      }
    } finally {
      busy.delete(busyKey);
    }
  }

  function pickablePersonas() {
    const now = Date.now();
    const c = personas.filter((p) => now - lastAIReply.get(p.id) > PERSONA_COOLDOWN_MS && !busy.has(p.id));
    if (c.length > 1) return c.filter((p) => p.id !== lastInterjector);
    return c.length ? c : [];
  }

  // 解析消息里的@提及
  function parseMentions(content, pool = personas) {
    const mentioned = [];
    for (const p of pool) {
      if (content.includes(`@${p.name}`) || content.includes(`@${p.name.replace(/\s/g, '')}`)) {
        mentioned.push(p);
      }
    }
    return mentioned;
  }

  // 根据用户消息内容生成更精准的回复指令
  function buildReplyInstruction(senderName, content, kind) {
    const topicHints = [];
    if (/吃|饭|菜|餐|外卖|火锅|烧烤|奶茶|咖啡|美食/.test(content)) topicHints.push('在聊吃的');
    if (/游戏|打|玩|lol|王者|原神|吃鸡|steam/.test(content)) topicHints.push('在聊游戏');
    if (/工作|上班|加班|老板|同事|开会|项目|需求/.test(content)) topicHints.push('在聊工作');
    if (/学|考试|作业|论文|毕业|课/.test(content)) topicHints.push('在聊学习');
    if (/电影|剧|综艺|动漫|番|电视/.test(content)) topicHints.push('在聊影视');
    if (/天气|冷|热|下雨|太阳/.test(content)) topicHints.push('在聊天气');
    if (/累|困|烦|烦死|难受|不开心|郁闷/.test(content)) topicHints.push('心情不太好');
    if (/开心|哈哈|笑死|绝了|666|厉害|牛/.test(content)) topicHints.push('情绪很好在嗨');
    if (isAskingDoing(content)) topicHints.push('在问你正在做什么');
    else if (isQuestion(content)) topicHints.push('在问问题');
    if (/!|！/.test(content)) topicHints.push('语气很激动');

    const topicStr = topicHints.length ? `(${topicHints.join(', ')})` : '';

    let base;
    if (kind === 'mention') {
      base = `"${senderName}"在跟你说话: "${content}" ${topicStr}。你必须像真人回微信一样回应TA说的内容。`;
    } else {
      base = `群里有人说: "${content}" ${topicStr}。你要针对这句话接话。`;
    }

    if (isAskingDoing(content)) {
      base += `\n【重要】对方在问你"在干嘛/在干什么"。你必须用第一人称回答此刻具体在做什么(结合人设: 吃饭/刷剧/写东西/打游戏/上班/出门等), 例如"在改需求, 头都大了"。禁止只回"对的/有一说一/确实/嗯"。`;
    } else if (isQuestion(content)) {
      base += `\n【重要】这是一个问题, 必须直接回答问题本身, 不要答非所问, 不要用"有一说一/对的/确实"敷衍。`;
    }

    const extra = [
      '回复要短, 像发微信一样, 一两句话就够了',
      '必须紧扣对方说的内容, 不要答非所问',
      '不要重复别人说过的话',
      '不要输出引号、旁白或解释',
    ];
    return `${base}\n提示: ${pick(extra)}`;
  }

  async function runAgentTask(persona, agent, msg, convId = null, isPrivate = false) {
    if (busy.has(persona.id) && !isPrivate) return;
    const busyKey = isPrivate ? `pv:${persona.id}` : persona.id;
    if (busy.has(busyKey)) return;
    busy.add(busyKey);
    ensurePersonaTs(persona.id);
    try {
      const send = (content, mediaType = null, mediaUrl = null) => {
        if (isPrivate && convId) sendPrivateAI(convId, persona, content, mediaType, mediaUrl);
        else sendAI(persona, content, mediaType, mediaUrl, convId);
        sentTimestamps.push(Date.now());
        lastAIReply.set(persona.id, Date.now());
        lastGlobalAI = Date.now();
      };

      await sleep(rand(400, 900));

      if (agent.type === 'remind_need_time') {
        send(agent.hint);
        return;
      }
      if (agent.type === 'remind') {
        const item = createReminder({
          convId: convId || null,
          personaId: persona.id,
          personaName: persona.name,
          text: agent.text,
          timeLabel: agent.timeLabel,
          dueAt: agent.dueAt,
          from: msg.senderName,
          isPrivate: Boolean(isPrivate),
        });
        send(formatRemindConfirm(item));
        return;
      }
      if (agent.type === 'file') {
        send(`收到，正在为你生成${{ excel: ' Excel 表格', word: ' Word 文档', ppt: ' PPT', pdf: ' PDF' }[agent.kind] || '文件'}「${agent.title}」…`);
        try {
          const file = await generateAgentFile(agent);
          await sleep(300);
          send(`文件已生成：${file.filename}`, 'file', file.url);
          send(`可直接点击文件查看/下载。需要改内容再跟我说，例如「再生成一份关于XX的 word」。`);
        } catch (e) {
          console.error('[agent] file gen failed', e);
          send(`抱歉，生成文件失败了（${e.message}）。可以换一种描述再试一次。`);
        }
        return;
      }
    } finally {
      busy.delete(busyKey);
    }
  }

  return {
    onUserJoin(user) {
      if (aiCfg.welcomeEnabled === false) return;
      const candidates = personas.filter((p) => !busy.has(p.id));
      const n = Math.random() < 0.4 && candidates.length > 1 ? 2 : 1;
      const chosen = [...candidates].sort(() => Math.random() - 0.5).slice(0, n);
      for (const persona of chosen) {
        setTimeout(() => {
          personaSpeak(persona, 'welcome', `新群友"${user.nickname}"刚加入群聊, 你打个招呼, 随意点。`, user.nickname);
        }, rand(2000, 5000));
      }
    },

    onUserMessage(msg, meta = {}) {
      lastActivity = Date.now();
      if (tooFast()) return;
      const now = Date.now();
      const convId = meta.conversationId || null;
      const isDefault = meta.isDefault !== false;
      const pool = poolFor(convId);

      // @提及: 该群相关人设都响应
      const atMentions = parseMentions(msg.content, pool);
      if (atMentions.length) {
        for (const mentioned of atMentions) {
          if (!busy.has(mentioned.id) && now - lastAIReply.get(mentioned.id) > 15_000) {
            const agent = parseAgentCommand(msg.content);
            if (agent) {
              runAgentTask(mentioned, agent, msg, convId);
              continue;
            }
            const instruction = buildReplyInstruction(msg.senderName, msg.content, 'mention');
            personaSpeak(mentioned, 'interject', instruction, msg.senderName, convId, msg.content);
          }
        }
        return;
      }

      // 直接叫名字
      const nameMention = pool.find((p) =>
        msg.content.includes(p.name) && !msg.content.includes(`@${p.name}`)
      );
      if (nameMention && !busy.has(nameMention.id) && now - lastAIReply.get(nameMention.id) > 20_000) {
        const agent = parseAgentCommand(msg.content);
        if (agent) {
          runAgentTask(nameMention, agent, msg, convId);
          return;
        }
        if (Math.random() < mentionRate) {
          const instruction = buildReplyInstruction(msg.senderName, msg.content, 'mention');
          personaSpeak(nameMention, 'interject', instruction, msg.senderName, convId, msg.content);
        }
        return;
      }

      // 真人发言: 所有群都可接话; 非默认群不冷场主动发言(tick 仍只作用默认群)
      const convKey = convId || 'default';
      const convCooldown = isDefault ? GLOBAL_COOLDOWN_MS : 4000;
      if (now - (lastConvAI.get(convKey) ?? 0) < convCooldown) return;
      const candidates = [];
      for (const p of pool) {
        ensurePersonaTs(p.id);
        if (now - lastAIReply.get(p.id) > (isDefault ? PERSONA_COOLDOWN_MS : 20000) && !busy.has(p.id)) {
          candidates.push(p);
        }
      }
      if (!candidates.length) return;
      // 非默认群几乎必回, 避免"发了没人理"
      const rate = isDefault ? interjectRate : 0.95;
      if (Math.random() > rate) return;
      const agentAny = parseAgentCommand(msg.content || '');
      if (agentAny) {
        const agentPersona = pick(candidates);
        lastInterjector = agentPersona.id;
        lastConvAI.set(convKey, now);
        runAgentTask(agentPersona, agentAny, msg, convId);
        return;
      }
      const filtered = candidates.length > 1 ? candidates.filter((p) => p.id !== lastInterjector) : candidates;
      const persona = pick(filtered.length ? filtered : candidates);
      lastInterjector = persona.id;
      lastConvAI.set(convKey, now);
      const instruction = buildReplyInstruction(msg.senderName, msg.content, 'interject');
      personaSpeak(persona, 'interject', instruction, msg.senderName, convId, msg.content);
    },

    tick() {
      // 到期提醒
      try {
        const hits = dueReminders();
        for (const r of hits) {
          const persona = personas.find((p) => p.id === r.personaId) || personas[0];
          const line = `⏰ 提醒时间到啦\n事项：${r.text}\n（${r.timeLabel || ''} 你让我提醒你的）`;
          if (r.isPrivate && r.convId) sendPrivateAI(r.convId, persona, line, null, null);
          else sendAI(persona, line, null, null, r.convId || null);
        }
      } catch (e) {
        console.error('[engine] reminder tick', e);
      }

      const idleMs = Date.now() - lastActivity;
      if (idleMs < silenceMinutes * 60_000) return;
      if (tooFast()) return;
      const candidates = pickablePersonas();
      if (!candidates.length) return;
      const starter = pick(candidates);
      lastInterjector = starter.id;
      const wantPic = isMediaEnabled() && Math.random() < 0.3;
      const instruction = wantPic
        ? '群里冷场很久了, 你来活跃气氛: 说句话, 并在最后加一行 [图片:一个有意思的画面描述] 发张好玩的图。'
        : '群里冷场很久了, 你主动抛个新话题活跃下气氛, 随便聊点什么都行。';
      personaSpeak(starter, 'topic', instruction);
      if (Math.random() < 0.5) {
        const others = personas.filter((p) => p.id !== starter.id && !busy.has(p.id));
        if (others.length) {
          const second = pick(others);
          setTimeout(() => {
            personaSpeak(second, 'interject', `刚才"${starter.name}"在群里说了话, 你接个茬, 针对TA说的内容回应。`);
          }, rand(5000, 12000));
        }
      }
    },

    noteAIActivity() {
      lastActivity = Date.now();
    },

    onPrivateMessage(user, persona, convId, msg) {
      // AI 不作为好友私聊对象时仍兼容历史会话; Agent 指令优先
      ensurePersonaTs(persona.id);
      const agent = parseAgentCommand(msg.content || '');
      if (agent) {
        runAgentTask(persona, agent, msg, convId, true);
        return;
      }
      let instruction = `"${user.nickname}"在私聊里跟你说: "${msg.content}"。像朋友之间私聊一样回复TA, 针对TA说的内容回应, 语气自然随意。`;
      if (isAskingDoing(msg.content)) {
        instruction += `\n对方在问你"在干嘛"。用第一人称具体回答此刻在做什么(结合人设), 禁止回答"对的/有一说一/确实"这类无关内容。`;
      } else if (isQuestion(msg.content)) {
        instruction += `\n这是一个问题, 必须直接回答, 不要答非所问。`;
      }
      setTimeout(() => {
        personaSpeakPrivate(persona, convId, instruction, msg.content);
      }, rand(800, 2000));
    },
  };
}
