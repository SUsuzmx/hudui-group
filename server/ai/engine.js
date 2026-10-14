// AI 私聊引擎: 仅服务私聊会话(历史遗留的 pv_*_ai_* 会话)的回复与 Agent 任务。
// 群聊已去掉 AI 群友, 本引擎不再参与任何群聊行为。
import { personas } from './personas.js';
import {
  chat as llm,
  isAiEnabled,
  llmPreferenceFor,
  imagePreferenceFor,
  videoPreferenceFor,
} from './provider.js';
import { genImage, genVideo, isMediaEnabled } from './media.js';
import {
  parseAgentCommand,
  createReminder,
  dueReminders,
  generateAgentFile,
  formatRemindConfirm,
} from './agent.js';

function mediaPrefs(persona) {
  const personaImage = imagePreferenceFor('persona', persona?.id);
  const personaVideo = videoPreferenceFor('persona', persona?.id);
  const personaLlm = llmPreferenceFor('persona', persona?.id);
  return {
    llm: personaLlm || null,
    image: personaImage || null,
    video: personaVideo || null,
  };
}

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONTEXT_SIZE = 25;
const MEDIA_RE = /\[(图片|视频)[:：]([^\]]{2,120})\]/g;

export function createEngine({ deps }) {
  const { sendPrivateAI, getPrivateContext } = deps;
  const busy = new Set();

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

  async function personaSpeakPrivate(persona, convId, instruction, userMessage) {
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
        const prefs = mediaPrefs(persona);
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

  async function runAgentTask(persona, agent, msg, convId = null, isPrivate = false) {
    const busyKey = isPrivate ? `pv:${persona.id}` : persona.id;
    if (busy.has(busyKey)) return;
    busy.add(busyKey);
    try {
      const send = (content, mediaType = null, mediaUrl = null) => {
        if (isPrivate && convId) sendPrivateAI(convId, persona, content, mediaType, mediaUrl);
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
    tick() {
      // 到期提醒（仅私聊来源的提醒会真正推送）
      try {
        const hits = dueReminders();
        for (const r of hits) {
          const persona = personas.find((p) => p.id === r.personaId) || personas[0];
          const line = `⏰ 提醒时间到啦\n事项：${r.text}\n（${r.timeLabel || ''} 你让我提醒你的）`;
          if (r.isPrivate && r.convId) sendPrivateAI(r.convId, persona, line, null, null);
        }
      } catch (e) {
        console.error('[engine] reminder tick', e);
      }
    },

    onPrivateMessage(user, persona, convId, msg) {
      // AI 不作为好友私聊对象时仍兼容历史会话; Agent 指令优先
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
