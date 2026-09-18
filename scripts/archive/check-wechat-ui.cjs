const fs = require('fs');
const js = fs.readFileSync('C:/perry/wechat.js', 'utf8');
const html = fs.readFileSync('C:/perry/index.html', 'utf8');
const css = fs.readFileSync('C:/perry/wechat.css', 'utf8');
const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const needed = [
  'msgList','chatPage','chatInput','btnSend','emojiPanel','plusPanel','actionSheet',
  'imgPreview','searchPage','tabBar','contactGroups','moreMenu','chatMoreMenu',
  'holdTalk','btnVoiceToggle','toast','mask','chatBody','chatMsgs','searchInput',
  'searchResults','previewImg','btnPreviewClose','btnChatBack','btnEmoji','btnPlus',
  'btnEmojiDel','emojiGrid','alphaIndex','contactCount','statusTime','tabBadgeMsg',
  'msgEmpty','chatLoading','btnMoreOpen','btnChatMore','btnSearchOpen','btnSearchEntry',
  'btnContactSearch','btnSearchCancel','btnContactAdd','meAvatar','chatTitle',
  'chatMemberCount','actionMenu','actionBubbleRef'
];
const missing = needed.filter((id) => !ids.includes(id));
console.log('html ids', ids.length, 'missing', missing);
try {
  new Function(js);
  console.log('js syntax OK', js.length);
} catch (e) {
  console.log('js ERR', e.message);
}
console.log('css', css.length, 'html', html.length);
