// 一次性验证 AI 配置: 走 provider 的故障转移逻辑, 打印实际使用的模型和回复。
import { chat, isAiEnabled } from '../server/ai/provider.js';

console.log('aiEnabled =', isAiEnabled());
const r = await chat('你在一个微信群里, 网名"老猫"。像真人一样说话, 单条不超过30字。', [
  { role: 'user', content: '测试员甲: 老猫 在吗, 出来说句话' },
]);
console.log('model =', r.model);
console.log('reply =', r.text);
process.exit(r.text ? 0 : 1);
