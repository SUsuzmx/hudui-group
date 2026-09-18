// 群聊种子数据: 默认主群 + 多个业务群。非默认群 AI 不主动插话。
import { stmts } from './db.js';

export const DEFAULT_GROUP_KIND = 'main';

const SEED_GROUPS = [
  {
    kind: 'main',
    name: 'WeChat',
    avatars: ['思琪', 'Perry', '小辣椒', '阿强'],
    seed: [],
  },
  {
    kind: 'product',
    name: '产品设计小分队（8）',
    avatars: ['💅', '🎮', '🧋', '🍜', '📐', '🎧', '📷', '🚀'],
    seed: [
      { from: 'ai', name: '思琪', emoji: '💅', content: '这版首页改稿我传群里了, 大家看看', ago: 3 * 3600000 },
      { from: 'ai', name: 'Perry', emoji: '🎮', content: '导航层级有点深, 建议再压一压', ago: 2.5 * 3600000 },
      { from: 'ai', name: '小辣椒', emoji: '🌶', content: '同意, 二级入口上提一层就行', ago: 2.4 * 3600000 },
    ],
  },
  {
    kind: 'family',
    name: '家庭群',
    avatars: ['👨', '👩', '👧', '👦', '🐶'],
    seed: [
      { from: 'ai', name: '妈妈', emoji: '👩', content: '记得吃早饭', ago: 25 * 60000 },
      { from: 'ai', name: '爸爸', emoji: '👨', content: '周末回来吃饭吗', ago: 20 * 60000 },
    ],
  },
  {
    kind: 'climb',
    name: '周末爬山群',
    avatars: ['⛰️', '🎒', '🧗', '🌤️', '🥾', '🗺️'],
    seed: [
      { from: 'ai', name: '王也', emoji: '🍃', content: '这周六天气不错, 八点集合?', ago: 3 * 3600000 },
      { from: 'ai', name: '叶修', emoji: '🎮', content: '我可以, 老地方?', ago: 2.8 * 3600000 },
    ],
  },
  {
    kind: 'work',
    name: '工作对接群',
    avatars: ['💼', '📊', '📎', '🗓️', '✅', '🖥️', '📞', '📝', '📈'],
    seed: [
      { from: 'ai', name: '方圆', emoji: '📐', content: '@所有人 明天上午十点例会', ago: 5 * 3600000 },
    ],
  },
  {
    kind: 'game',
    name: '开黑不解释',
    avatars: ['🎮', '🕹️', '👾', '🎧', '🏆'],
    seed: [
      { from: 'ai', name: '阿强', emoji: '💪', content: '晚上开黑, 缺一个', ago: 4 * 86400000 },
    ],
  },
];

export function groupConvId(groupId) {
  return `grp_${groupId}`;
}

export function seedGroups() {
  const now = Date.now();
  const created = [];
  for (const g of SEED_GROUPS) {
    let row = stmts.groupByKind.get(g.kind);
    if (!row) {
      const r = stmts.insertGroup.run(g.name, g.kind, JSON.stringify(g.avatars), now);
      row = stmts.groupById.get(Number(r.lastInsertRowid));
    }
    const convId = groupConvId(row.id);
    // 仅在该会话还没有消息时播种
    const has = stmts.lastGroupMessage.get(convId);
    if (!has) {
      for (const s of g.seed) {
        stmts.insertMessage.run(
          s.from, null, s.name, s.emoji, s.content, now - s.ago, null, null, convId
        );
      }
    }
    created.push(row);
  }
  return created;
}

export function listGroups() {
  return stmts.allGroups.all().map((g) => {
    let avatars = [];
    try { avatars = JSON.parse(g.avatars || '[]'); } catch { avatars = []; }
    const last = stmts.lastGroupMessage.get(groupConvId(g.id));
    return {
      id: g.id,
      kind: g.kind,
      name: g.name,
      avatars,
      isDefault: g.kind === DEFAULT_GROUP_KIND,
      conversationId: groupConvId(g.id),
      lastId: last?.id ?? 0,
      lastMessage: last
        ? (last.media_type === 'image' ? '[图片]'
          : last.media_type === 'video' ? '[视频]'
          : `${last.sender_name}: ${last.content}`.slice(0, 40))
        : '还没有消息, 快来打破沉默',
      lastTime: last?.created_at ?? g.created_at,
    };
  });
}

export function getGroup(groupId) {
  const g = stmts.groupById.get(Number(groupId));
  if (!g) return null;
  let avatars = [];
  try { avatars = JSON.parse(g.avatars || '[]'); } catch { avatars = []; }
  return {
    id: g.id,
    kind: g.kind,
    name: g.name,
    avatars,
    isDefault: g.kind === DEFAULT_GROUP_KIND,
    conversationId: groupConvId(g.id),
    notice: g.notice || '',
  };
}

export function setGroupNotice(groupId, notice) {
  const text = String(notice || '').trim().slice(0, 500);
  stmts.setGroupNotice.run(text, Number(groupId));
  return text;
}

// 用户自建群聊: 无独立成员表, 与种子群一致全局可见
export function createGroup({ name, memberNames }) {
  const cleanName = String(name || '').trim().slice(0, 20) || '新建群聊';
  const avatars = (memberNames || []).slice(0, 9).map((n) => String(n).slice(0, 12));
  const r = stmts.insertGroup.run(cleanName, 'custom', JSON.stringify(avatars), Date.now());
  return getGroup(Number(r.lastInsertRowid));
}
