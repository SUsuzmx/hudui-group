import fs from 'node:fs';

const checks = [];
function ok(n, c, d = '') {
  checks.push({ n, c: !!c, d });
  console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (d ? ' — ' + d : ''));
}

const chat = fs.readFileSync('client/src/components/ChatView.vue', 'utf8');
ok('ChatView 九宫格含群工具', chat.includes('群工具'));
ok('ChatView 拍摄独立 camera', chat.includes('cameraInput') && chat.includes('capture='));
ok('ChatView 翻译菜单', chat.includes("doAction('translate')"));
ok('ChatView 提醒菜单', chat.includes("doAction('remind')"));
ok('ChatView 转文字菜单', chat.includes("doAction('voice-text')"));
ok('ChatView 日期条', chat.includes('showDateSep') && chat.includes('fmtDayLabel'));
ok('ChatView 群待办', chat.includes('addGroupTodo') && chat.includes('showTodoSheet'));
ok('ChatView 点昵称插入@', chat.includes('insertMentionName'));
ok('ChatView 听筒切换', chat.includes('toggleVoiceOutputMode'));
ok('ChatView 合并转发展开', chat.includes('mergeExpand') && chat.includes('me-head'));

const pv = fs.readFileSync('client/src/components/PrivateChatView.vue', 'utf8');
ok('私聊拍摄/名片/收藏', pv.includes('pickCamera') && pv.includes('sendMyCard') && pv.includes('openFavPicker'));
ok('私聊翻译/提醒', pv.includes("doAction('translate')") && pv.includes("doAction('remind')"));

const vp = fs.readFileSync('client/src/voice-player.js', 'utf8');
ok('语音听筒/连播/转写', vp.includes('setVoiceOutput') && vp.includes('setAutoPlayNext') && vp.includes('transcribeVoice') && vp.includes('playNextInQueue'));

const mv = fs.readFileSync('client/src/components/MomentsView.vue', 'utf8');
ok('朋友圈 except/范围/互斥', mv.includes("value: 'except'") && mv.includes('momentsRange') && mv.includes('hideThem') && mv.includes('hiddenFrom'));

const main = fs.readFileSync('client/src/components/MainView.vue', 'utf8');
ok('状态墙入口', main.includes('statusWall') && main.includes('loadFriendStatuses'));

const fd = fs.readFileSync('client/src/components/FriendDetailView.vue', 'utf8');
const iMute = fd.indexOf("p === 'mute-them'");
const muteBlock = fd.slice(iMute, iMute + 500);
ok('mute-them 本地处理', iMute > 0 && !muteBlock.includes('setFriendPermission'));

const idx = fs.readFileSync('server/index.js', 'utf8');
ok('服务端状态墙接口', idx.includes('/api/status/friends'));
const mo = fs.readFileSync('server/moments.js', 'utf8');
ok('服务端 except 过滤', mo.includes("vis === 'except'"));
const meta = fs.readFileSync('server/meta.js', 'utf8');
ok('设置键 moments 隐私', meta.includes('momentsRange') && meta.includes('momentsHideFrom') && meta.includes('momentsHideThem'));

const fails = checks.filter((x) => !x.c);
console.log('====', checks.length - fails.length + '/' + checks.length, '====');
if (fails.length) process.exitCode = 1;
