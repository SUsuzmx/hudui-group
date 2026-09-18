import { chat } from '../server/ai/provider.js';

const sys = `你叫Perry, 说话短句口语。别人问在干嘛必须说具体在做什么。`;
const instruction = `群里有人说: "在干什么" (在问你正在做什么)。【重要】对方在问你"在干嘛/在干什么"。你必须用第一人称回答此刻具体在做什么, 例如"在改需求, 头都大了"。禁止只回"对的/有一说一/确实/嗯"。
提示: 回复要短`;

const r = await chat(sys, [{ role: 'user', content: instruction }], ['qwen3.7-flash', 'qwen3.6-plus']);
console.log('model', r.model);
console.log('text', r.text);
const bad = /^(有一说一|确实|对的|对啊|嗯|行|行吧)[\s，。!！?？]*$/.test((r.text || '').trim());
console.log(bad ? 'STILL_BAD' : 'OK_RELEVANT');
process.exit(bad || !r.text ? 1 : 0);
