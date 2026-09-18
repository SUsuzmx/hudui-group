// 演示钱包: 零钱余额 + 流水账本 (红包/转账)
import { stmts } from './db.js';

export function getBalance(userId) {
  const row = stmts.getUserBalance.get(Number(userId));
  if (row && typeof row.balance === 'number') return row.balance;
  // 迁移兜底
  try { stmts.setUserBalance.run(100, Number(userId)); } catch { /* ignore */ }
  return 100;
}

export function setBalance(userId, balance) {
  const next = Math.max(0, Math.round(Number(balance) * 100) / 100);
  stmts.setUserBalance.run(next, Number(userId));
  return next;
}

export function credit(userId, amount, { type, note = '', peerId = null, refType = null, refId = null } = {}) {
  const amt = Math.max(0, Math.round(Number(amount) * 100) / 100);
  if (!amt) return getBalance(userId);
  const before = getBalance(userId);
  const after = setBalance(userId, before + amt);
  stmts.insertWalletTx.run(Number(userId), type || 'credit', amt, after, note, peerId, refType, refId, Date.now());
  return after;
}

export function debit(userId, amount, { type, note = '', peerId = null, refType = null, refId = null } = {}) {
  const amt = Math.max(0, Math.round(Number(amount) * 100) / 100);
  if (!amt) return { ok: true, balance: getBalance(userId) };
  const before = getBalance(userId);
  if (before < amt) return { ok: false, error: '零钱不足', balance: before };
  const after = setBalance(userId, before - amt);
  stmts.insertWalletTx.run(Number(userId), type || 'debit', -amt, after, note, peerId, refType, refId, Date.now());
  return { ok: true, balance: after };
}

export function listTx(userId) {
  return (stmts.listWalletTx.all(Number(userId)) || []).map((t) => ({
    id: t.id,
    type: t.type,
    amount: t.amount,
    balanceAfter: t.balance_after,
    note: t.note,
    peerId: t.peer_id,
    refType: t.ref_type,
    refId: t.ref_id,
    createdAt: t.created_at,
  }));
}
