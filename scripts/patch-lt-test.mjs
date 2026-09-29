import fs from 'node:fs';
let c = fs.readFileSync('scripts/test-listen-together.mjs', 'utf8');
c = c.split("'listen:join', { roomId }").join("'listen:join', { sessionId: roomId, roomId }");
c = c.split("'listen:leave', { roomId }").join("'listen:leave', { sessionId: roomId, roomId }");
c = c.split("'listen:sync', { roomId }").join("'listen:sync', { sessionId: roomId, roomId }");
// AI 私聊拒绝
if (!c.includes('AI 私聊拒绝')) {
  c = c.replace(
    '  s1.disconnect();',
    `  // AI 私聊拒绝
  const aiConv = 'pv_' + id1 + '_ai_siqi';
  const aiCreate = await emitAck(s1, 'listen:create', {
    conversationId: aiConv,
    track: { id: 'ai-1', source: 'qq', title: 'x' },
  });
  ok('AI 私聊拒绝', Boolean(aiCreate.error), aiCreate.error || 'created!');

  s1.disconnect();`
  );
}
fs.writeFileSync('scripts/test-listen-together.mjs', c, 'utf8');
console.log('test updated');
