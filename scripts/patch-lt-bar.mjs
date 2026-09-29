import fs from 'node:fs';

function patch(p, pairs) {
  let c = fs.readFileSync(p, 'utf8');
  const crlf = c.includes('\r\n');
  if (crlf) c = c.replace(/\r\n/g, '\n');
  let n = 0;
  for (const [a, b] of pairs) {
    if (c.includes(a)) {
      c = c.split(a).join(b);
      n++;
    } else {
      console.log('MISS', p, JSON.stringify(a.slice(0, 70)));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(p, c, 'utf8');
  console.log(p, n + '/' + pairs.length);
}

const barChat = `    <ListenTogetherBar
      v-if="listenTogether.inRoom && listenTogether.state.room?.conversationId === (conversationId || 'default')"
      @open-room="emit('open-view', { type: 'listen-together' })"
    />

    <footer class="chat-dock">`;

const barPriv = `    <ListenTogetherBar
      v-if="listenTogether.inRoom && listenTogether.state.room?.conversationId === conversationId"
      @open-room="emit('open-view', { type: 'listen-together' })"
    />

    <footer class="chat-dock">`;

patch('client/src/components/ChatView.vue', [
  [
    "defineEmits(['back', 'open-chat-info', 'members', 'search-used', 'open-video-call', 'open-profile']);",
    "defineEmits(['back', 'open-chat-info', 'members', 'search-used', 'open-video-call', 'open-profile', 'open-view']);",
  ],
  ['    <footer class="chat-dock">', barChat],
]);

patch('client/src/components/PrivateChatView.vue', [
  [
    "defineEmits(['back', 'open-profile', 'open-chat-info', 'search-used', 'open-video-call']);",
    "defineEmits(['back', 'open-profile', 'open-chat-info', 'search-used', 'open-video-call', 'open-view']);",
  ],
  ['    <footer class="chat-dock">', barPriv],
]);
