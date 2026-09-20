// AI Agent: 群聊中 @AI 可创建提醒、生成办公文件 (excel/word/ppt/pdf)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(path.dirname(__dirname));
const MEDIA_DIR = path.join(ROOT, 'data', 'media');
const REMINDER_FILE = path.join(ROOT, 'data', 'ai-reminders.json');
const GEN_SCRIPT = path.join(__dirname, 'agent_gen.py');

function ensureDirs() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(REMINDER_FILE), { recursive: true });
}

export function loadReminders() {
  try {
    return JSON.parse(fs.readFileSync(REMINDER_FILE, 'utf8')) || [];
  } catch {
    return [];
  }
}

function saveReminders(list) {
  ensureDirs();
  fs.writeFileSync(REMINDER_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function pythonBin() {
  return process.env.MIMO_PYTHON || process.env.PYTHON || 'python';
}

function runPython(payload) {
  return new Promise((resolve, reject) => {
    const py = pythonBin();
    const child = spawn(py, [GEN_SCRIPT], {
      cwd: ROOT,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || out || `python exit ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(out.trim().split('\n').filter(Boolean).pop() || '{}'));
      } catch (e) {
        reject(new Error(`解析生成结果失败: ${e.message}; out=${out}`));
      }
    });
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

function sanitizeName(s) {
  return String(s || '文件').replace(/[\\/:*?"<>|\n\r]+/g, '_').slice(0, 40) || '文件';
}

function parseWhen(text) {
  const now = new Date();
  let due = null;
  let label = '';

  // 明天 / 后天
  const dayMatch = text.match(/(今天|今晚|明天|后天|大后天)/);
  // 具体时间 HH:MM 或 X点/X点半
  const hm = text.match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  const cn = text.match(/(\d{1,2})\s*点(半|一刻|三刻)?/);
  // N分钟后/小时后
  const relMin = text.match(/(\d+)\s*分钟后/);
  const relHour = text.match(/(\d+)\s*(?:个)?小时后/);

  const d = new Date(now);
  if (dayMatch) {
    const w = dayMatch[1];
    if (w === '明天') d.setDate(d.getDate() + 1);
    else if (w === '后天') d.setDate(d.getDate() + 2);
    else if (w === '大后天') d.setDate(d.getDate() + 3);
    // 今天/今晚 keep today
  }

  if (relMin) {
    due = new Date(now.getTime() + Number(relMin[1]) * 60_000);
    label = `${relMin[1]}分钟后`;
  } else if (relHour) {
    due = new Date(now.getTime() + Number(relHour[1]) * 3600_000);
    label = `${relHour[1]}小时后`;
  } else if (hm) {
    d.setHours(Number(hm[1]), Number(hm[2]), 0, 0);
    due = d;
    label = `${dayMatch?.[1] || ''}${hm[1]}:${hm[2]}`.trim();
  } else if (cn) {
    let hour = Number(cn[1]);
    const suffix = cn[2];
    if (suffix === '半') d.setHours(hour, 30, 0, 0);
    else if (suffix === '一刻') d.setHours(hour, 15, 0, 0);
    else if (suffix === '三刻') d.setHours(hour, 45, 0, 0);
    else d.setHours(hour, 0, 0, 0);
    due = d;
    label = `${dayMatch?.[1] || ''}${hour}点${suffix || ''}`.trim();
  } else if (/半小时后/.test(text)) {
    due = new Date(now.getTime() + 30 * 60_000);
    label = '半小时后';
  }

  if (due && due.getTime() <= now.getTime() + 20_000) {
    due = new Date(now.getTime() + 5 * 60_000);
    if (!label) label = '5分钟后';
  }
  return { due, label };
}

function extractReminderText(content) {
  let t = String(content || '')
    .replace(/@[^\s@，,]+/g, ' ')
    .replace(/^(帮我|请|麻烦你?)\s*/i, '')
    .replace(/(提醒我|提醒|叫我|定个提醒|设个提醒|创建提醒)/g, ' ');
  // 先去掉时间, 再处理冒号等
  t = t
    .replace(/(今天|今晚|明天|后天|大后天)/g, ' ')
    .replace(/\d{1,2}\s*[:：]\s*\d{2}/g, ' ')
    .replace(/\d{1,2}\s*点(半|一刻|三刻)?/g, ' ')
    .replace(/\d+\s*(个)?小时后/g, ' ')
    .replace(/\d+\s*分钟后/g, ' ')
    .replace(/半小时后/g, ' ')
    .replace(/^\d{1,2}(\s+\d{1,2})?/, ' ')
    .replace(/(关于|内容是|事项是|：|:)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t || '待办事项';
}

/** 返回 null 表示不是 agent 任务 */
export function parseAgentCommand(content = '') {
  const text = String(content || '').trim();
  if (!text) return null;

  // 提醒
  if (/(提醒我|帮我提醒|定个提醒|设个提醒|创建提醒|叫我)/.test(text)) {
    const { due, label } = parseWhen(text);
    if (!due) {
      return { type: 'remind_need_time', hint: '请告诉我提醒时间，例如：提醒我明天 10:30 开会' };
    }
    return {
      type: 'remind',
      dueAt: due.getTime(),
      timeLabel: label || due.toLocaleString('zh-CN'),
      text: extractReminderText(text),
    };
  }

  // 文件生成
  const fileM =
    text.match(/(?:生成|做|写|出|创建|导出)(?:一份|一个|个)?\s*([^\s，。]{0,20})?\s*(excel|表格|xlsx|word|文档|docx|ppt|pptx|演示文稿|pdf)/i) ||
    text.match(/(excel|表格|xlsx|word|文档|docx|ppt|pptx|演示文稿|pdf)(?:文件|格式)?/i);
  if (/(生成|做|写|出|创建|导出|来一份|来个)/.test(text) && fileM) {
    const raw = (fileM[2] || fileM[1] || '').toLowerCase();
    let kind = 'excel';
    if (/excel|表格|xlsx/.test(raw) || /excel|表格|xlsx/i.test(text)) kind = 'excel';
    else if (/word|文档|docx/i.test(raw + text)) kind = 'word';
    else if (/ppt|pptx|演示/i.test(raw + text)) kind = 'ppt';
    else if (/pdf/i.test(raw + text)) kind = 'pdf';

    // 标题与正文
    let title = '';
    const titleM = text.match(/(?:关于|主题是|标题是|名叫|题为)\s*([^，。,,：:\n]{1,40})/);
    if (titleM) title = titleM[1].trim();
    title = title
      .replace(/(的)?(excel|表格|xlsx|word|文档|docx|ppt|pptx|演示文稿|pdf)(文件|格式)?/gi, '')
      .trim();
    let body = text
      .replace(/@[^\s@，,]+/g, ' ')
      .replace(/(生成|做|写|出|创建|导出)(一份|一个|个)?/g, ' ')
      .replace(/(excel|表格|xlsx|word|文档|docx|ppt|pptx|演示文稿|pdf)(文件|格式)?/gi, ' ')
      .replace(/(关于|主题是|标题是|名叫|题为)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      title = body.split(/[，。,,;；：:]/)[0]?.slice(0, 24) || 'AI 生成文档';
      title = title.replace(/的$/,'').trim() || 'AI 生成文档';
    }
    // 去掉标题残留的“的”前后碎片
    body = body
      .replace(title, ' ')
      .replace(/^(帮我|给我|来|请)\s*/g, '')
      .replace(/^\s*的\s*/, ' ')
      .replace(/\b的\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!body || body === '的' || /^[\s的]*$/.test(body) || body.length < 2) {
      body = `围绕「${title}」的要点整理。\n要点1：背景与目标\n要点2：关键结论\n要点3：下一步行动`;
    }

    return { type: 'file', kind, title, body, original: text };
  }

  return null;
}

export function createReminder(task) {
  ensureDirs();
  const list = loadReminders();
  const item = {
    id: `r_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    ...task,
    createdAt: Date.now(),
    fired: false,
  };
  list.push(item);
  saveReminders(list);
  return item;
}

/** 到期提醒，交给 engine 发送 */
export function dueReminders(now = Date.now()) {
  const list = loadReminders();
  const hits = list.filter((r) => !r.fired && r.dueAt <= now);
  if (!hits.length) return [];
  for (const h of hits) h.fired = true;
  saveReminders(list);
  return hits;
}

/** 生成文件，返回 { url, filename, kind } */
export async function generateAgentFile({ kind, title, body }) {
  ensureDirs();
  const stamp = Date.now();
  const safe = sanitizeName(title);
  const ext = { excel: 'xlsx', word: 'docx', ppt: 'pptx', pdf: 'pdf' }[kind] || 'txt';
  const filename = `ai_${kind}_${stamp}.${ext}`;
  const outPath = path.join(MEDIA_DIR, filename);
  const result = await runPython({
    kind,
    title: title || 'AI 文档',
    body: body || '',
    out: outPath,
  });
  if (!fs.existsSync(outPath)) {
    throw new Error(result?.error || '文件未生成');
  }
  return {
    url: `/media/${filename}`,
    filename: `${safe}.${ext}`,
    kind,
    path: outPath,
  };
}

export function formatFileMessage(file) {
  const label = { excel: '表格', word: 'Word 文档', ppt: '演示文稿', pdf: 'PDF' }[file.kind] || '文件';
  return `[文件]${file.filename}`;
}

export function formatRemindConfirm(item) {
  return `好的，已创建提醒\n事项：${item.text}\n时间：${item.timeLabel}\n到点我会在会话里提醒你。`;
}
