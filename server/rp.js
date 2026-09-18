// 红包细节: 拼手气拆分 / 专属 / 领取记录 / 24h 过期退回
import { stmts } from './db.js';
import { credit } from './wallet.js';

export const RP_COVERS = [
  { id: 'classic', emoji: '🧧', label: '经典红包', from: '#e8534a', to: '#c20c0c' },
  { id: 'gold', emoji: '💰', label: '金色财富', from: '#f5a623', to: '#e08900' },
  { id: 'luck', emoji: '🍀', label: '好运连连', from: '#34c759', to: '#0f8a3c' },
  { id: 'love', emoji: '❤️', label: '甜蜜告白', from: '#fa5151', to: '#9b0c0c' },
  { id: 'fest', emoji: '🎊', label: '节日庆典', from: '#fa9d3b', to: '#e8534a' },
];

export const RP_EXPIRE_MS = 24 * 60 * 60 * 1000;
export const TF_EXPIRE_MS = 24 * 60 * 60 * 1000;

export function coverById(id) {
  return RP_COVERS.find((c) => c.id === id) || RP_COVERS[0];
}

/** 拼手气: 二倍均值法, 保证每人至少 0.01 */
export function splitLuckyMoney(total, count) {
  const n = Math.max(1, Math.min(50, Math.floor(Number(count) || 1)));
  let remain = Math.round(Number(total) * 100) / 100;
  if (!(remain >= 0.01) || remain < n * 0.01) return null;
  const amounts = [];
  let left = n;
  for (let i = 0; i < n - 1; i++) {
    const maxOne = Math.min(remain - (left - 1) * 0.01, Math.max(0.01, (remain * 2) / left));
    const minOne = 0.01;
    let a = minOne + Math.random() * Math.max(0, maxOne - minOne);
    a = Math.round(a * 100) / 100;
    const cap = Math.round((remain - (left - 1) * 0.01) * 100) / 100;
    if (a > cap) a = cap;
    if (a < 0.01) a = 0.01;
    amounts.push(a);
    remain = Math.round((remain - a) * 100) / 100;
    left -= 1;
  }
  amounts.push(Math.round(remain * 100) / 100);
  return amounts;
}

/** 规范化发送参数 */
export function normalizeRedPacketInput(ext = {}) {
  const rpType = ext.rpType === 'lucky' ? 'lucky' : 'exclusive';
  const cover = String(ext.cover || 'classic').slice(0, 20);
  const note = String(ext.note || '恭喜发财，大吉大利').slice(0, 30);
  const totalAmount = Math.round((Number(ext.amount) || 0) * 100) / 100;
  const count = rpType === 'lucky'
    ? Math.max(1, Math.min(50, Math.floor(Number(ext.rpCount) || 1)))
    : 1;
  if (!(totalAmount >= count * 0.01)) {
    return { error: rpType === 'lucky' ? `拼手气总额至少 ¥${(count * 0.01).toFixed(2)}` : '金额不合法' };
  }
  return { rpType, cover, note, totalAmount, count };
}

export function redPacketPayload(packet) {
  if (!packet) return null;
  const cover = coverById(packet.cover);
  const total = Number(packet.total_amount ?? packet.amount) || 0;
  const remaining = Number(packet.remaining ?? (packet.status === 'claimed' ? 0 : total)) || 0;
  const claimedCount = Number(packet.claimed_count || (packet.status === 'claimed' ? 1 : 0));
  const totalCount = Number(packet.total_count || 1);
  let claims = [];
  try { claims = stmts.listRedPacketClaims.all(packet.id) || []; } catch { claims = []; }
  return {
    packetId: packet.id,
    rpType: packet.rp_type || 'exclusive',
    note: packet.note,
    cover: cover.id,
    coverEmoji: cover.emoji,
    coverFrom: cover.from,
    coverTo: cover.to,
    coverLabel: cover.label,
    totalAmount: total,
    amount: total, // 兼容旧字段
    remaining: Math.max(0, remaining),
    totalCount,
    claimedCount,
    leftCount: Math.max(0, totalCount - claimedCount),
    status: packet.status,
    claimedBy: packet.claimed_by ?? null,
    expiredAt: packet.expired_at || null,
    bestAmount: packet.best_amount ?? null,
    bestUserId: packet.best_user_id ?? null,
    createdAt: packet.created_at,
    claims: claims.map((c) => ({
      userId: c.user_id,
      nickname: c.nickname,
      amount: c.amount,
      isBest: !!c.is_best,
      createdAt: c.created_at,
    })),
    isLucky: (packet.rp_type || 'exclusive') === 'lucky',
  };
}

export function claimRedPacketForUser({ packet, user, log = () => {} }) {
  if (!packet) return { error: '红包不存在' };
  const now = Date.now();
  if (packet.expired_at && now > Number(packet.expired_at)) {
    try { stmts.expireRedPacket.run(packet.id); } catch { /* ignore */ }
    return { error: '红包已过期', status: 'expired' };
  }
  if (packet.from_id === user.id) {
    return { error: '不能领取自己的红包', status: packet.status, payload: redPacketPayload(stmts.getRedPacket.get(packet.id)) };
  }
  if (packet.status !== 'pending') {
    return { error: packet.status === 'expired' ? '红包已过期' : '红包已被领完', status: packet.status, payload: redPacketPayload(packet) };
  }

  const existing = stmts.hasRedPacketClaim.get(packet.id, user.id);
  if (existing) {
    return {
      ok: true,
      amount: existing.amount,
      status: 'already',
      claimed: true,
      payload: redPacketPayload(stmts.getRedPacket.get(packet.id)),
    };
  }

  const isLucky = (packet.rp_type || 'exclusive') === 'lucky';
  const total = Number(packet.total_amount ?? packet.amount) || 0;
  const totalCount = Math.max(1, Number(packet.total_count || 1));
  const claimedCount = Number(packet.claimed_count || 0);
  const remaining = Number(packet.remaining ?? total);

  if (claimedCount >= totalCount || remaining < 0.01) {
    try { stmts.expireRedPacket.run(packet.id); } catch { /* ignore */ }
    return { error: '红包已被领完', status: 'claimed', payload: redPacketPayload(stmts.getRedPacket.get(packet.id)) };
  }

  let gain = 0;
  if (isLucky) {
    const left = totalCount - claimedCount;
    if (left <= 1) {
      gain = Math.round(remaining * 100) / 100;
    } else {
      const parts = splitLuckyMoney(remaining, left);
      gain = parts?.[0] ?? 0.01;
    }
    if (!(gain >= 0.01)) gain = 0.01;
    if (gain > remaining) gain = Math.round(remaining * 100) / 100;
  } else {
    gain = Math.round(total * 100) / 100;
  }

  stmts.insertRedPacketClaim.run(packet.id, user.id, user.nickname || '', gain, 0, now);
  stmts.claimRedPacketLucky.run(gain, user.id, now, packet.id, user.id);
  if (!isLucky) {
    try { stmts.claimRedPacket.run(user.id, now, packet.id, user.id); } catch { /* ignore */ }
  }

  credit(user.id, gain, {
    type: 'redpacket_claim',
    note: packet.note || '领取红包',
    peerId: packet.from_id,
    refType: 'redpacket',
    refId: packet.id,
  });

  // 手气王标记
  try {
    const claims = stmts.listRedPacketClaims.all(packet.id) || [];
    if (claims.length) {
      const maxAmt = Math.max(...claims.map((c) => Number(c.amount) || 0));
      const best = claims.find((c) => Number(c.amount) === maxAmt);
      if (best) stmts.setRedPacketBest.run(best.amount, best.user_id, packet.id);
    }
  } catch { /* ignore */ }

  const updated = stmts.getRedPacket.get(packet.id);
  const payload = redPacketPayload(updated);
  if (payload) {
    const maxAmt = Math.max(...payload.claims.map((c) => c.amount), 0);
    payload.claims = payload.claims.map((c) => ({
      ...c,
      isBest: c.amount === maxAmt && maxAmt > 0,
    }));
    const mine = payload.claims.find((c) => c.userId === user.id);
    if (mine) {
      payload.myClaim = mine.amount;
      payload.isBest = !!mine.isBest;
    }
    if (!isLucky || Number(updated?.claimed_count || 0) >= Number(updated?.total_count || 1)) {
      if (updated?.status === 'pending') {
        // 兜底收口
      }
    }
  }

  log?.(`领取红包: ${user.nickname} +¥${gain.toFixed(2)} packet=${packet.id}`);
  return { ok: true, amount: gain, status: 'claimed', payload, isBest: payload?.isBest };
}

/** 过期退回: 未领完红包/未领转账 */
export function expirePendingPayments({ log = () => {} } = {}) {
  const now = Date.now();
  let packets = 0;
  let transfers = 0;
  try {
    const rows = stmts.listPendingPackets.all(now) || [];
    for (const p of rows) {
      const remain = Number(p.remaining ?? p.total_amount ?? p.amount) || 0;
      const claimedCount = Number(p.claimed_count || 0);
      const totalCount = Number(p.total_count || 1);
      if (claimedCount < totalCount && remain > 0) {
        credit(p.from_id, remain, {
          type: 'redpacket_refund',
          note: '红包超时退回',
          refType: 'redpacket',
          refId: p.id,
        });
      }
      stmts.expireRedPacket.run(p.id);
      packets += 1;
      log?.(`红包过期退回 #${p.id} remain=${remain}`);
    }
  } catch { /* ignore */ }
  try {
    const tfs = stmts.listPendingTransfers.all(now - TF_EXPIRE_MS) || [];
    for (const t of tfs) {
      credit(t.from_id, Number(t.amount) || 0, {
        type: 'transfer_refund',
        note: '转账超时退回',
        refType: 'transfer',
        refId: t.id,
      });
      stmts.expireTransfer.run(t.id);
      transfers += 1;
      log?.(`转账过期退回 #${t.id} amount=${t.amount}`);
    }
  } catch { /* ignore */ }
  return { packets, transfers };
}
