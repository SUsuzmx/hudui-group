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
      console.log('MISS', p, JSON.stringify(a.slice(0, 75)));
    }
  }
  if (crlf) c = c.replace(/\n/g, '\r\n');
  fs.writeFileSync(p, c, 'utf8');
  console.log(p, n + '/' + pairs.length);
}

// ---- ChatView: 一起听改为进入点歌页；迷你条挪到顶部 ----
patch('client/src/components/ChatView.vue', [
  [
    `async function openListenTogether() {
  dockMode.value = 0;
  const conv = conversationId.value || 'default';
  const existing = listenTogether.state.room;
  if (existing && existing.conversationId === conv) {
    emit('open-view', { type: 'listen-together' });
    return;
  }
  if (existing) {
    showToast('请先退出当前一起听');
    return;
  }
  const cur = musicPlayer.state.current;
  const track = cur
    ? {
        id: cur.id,
        source: cur.source || 'qq',
        title: cur.title || cur.name || '未知歌曲',
        artist: cur.artist || '',
        cover: cur.cover || cur.picUrl || '',
        duration: cur.duration || 0,
        mid: cur.mid,
        mediaMid: cur.mediaMid,
        hash: cur.hash,
        albumId: cur.albumId,
        albumAudioId: cur.albumAudioId,
        mixSongId: cur.mixSongId,
      }
    : {
        id: 'demo-1',
        source: 'qq',
        title: '一起听',
        artist: '从听一听选歌',
        cover: '',
        duration: 0,
      };
  if (musicPlayer.state.current) showToast('将切换为房间歌曲');
  const res = await createRoom({ conversationId: conv, track });
  if (res?.ok && res.room) {
    // 发送邀请卡片
    const ext = {
      roomId: res.room.id,
      title: track.title,
      artist: track.artist,
      cover: track.cover,
      source: track.source,
      hostName: props.me?.nickname || '我',
      memberCount: 1,
      id: track.id,
    };
    if (!socket) socket = getSocket();
    socket?.emit('message:send', {
      conversationId: conv,
      content: '',
      mediaType: 'listentogether',
      ext,
    }, () => {});
    emit('open-view', { type: 'listen-together' });
  }
}`,
    `function openListenTogether() {
  dockMode.value = 0;
  const conv = conversationId.value || 'default';
  const existing = listenTogether.state.room;
  if (existing && existing.conversationId === conv) {
    emit('open-view', { type: 'listen-together' });
    return;
  }
  if (existing) {
    showToast('请先退出当前一起听');
    return;
  }
  // 先点歌，选中后再开房播放
  emit('open-view', {
    type: 'listen-together',
    pickSong: true,
    conversationId: conv,
    hostName: props.me?.nickname || '我',
  });
}`,
  ],
  [
    `    <!-- 输入区 -->
    <ListenTogetherBar
      v-if="listenTogether.inRoom && listenTogether.state.room?.conversationId === (conversationId || 'default')"
      @open-room="emit('open-view', { type: 'listen-together' })"
    />

    <footer class="chat-dock">`,
    `    <!-- 输入区 -->
    <footer class="chat-dock">`,
  ],
  [
    `    </header>

    <div v-if="showConnHint" class="conn-bar">连接已断开，正在重连…</div>`,
    `    </header>

    <ListenTogetherBar
      v-if="listenTogether.inRoom && listenTogether.state.room?.conversationId === (conversationId || 'default')"
      @open-room="emit('open-view', { type: 'listen-together' })"
    />

    <div v-if="showConnHint" class="conn-bar">连接已断开，正在重连…</div>`,
  ],
]);

// ---- PrivateChatView ----
patch('client/src/components/PrivateChatView.vue', [
  [
    `async function openListenTogether() {
  const conv = conversationId.value;
  const existing = listenTogether.state.room;
  if (existing && existing.conversationId === conv) {
    emit('open-view', { type: 'listen-together' });
    return;
  }
  if (existing) {
    showToast('请先退出当前一起听');
    return;
  }
  const cur = musicPlayer.state.current;
  const track = cur
    ? {
        id: cur.id,
        source: cur.source || 'qq',
        title: cur.title || cur.name || '未知歌曲',
        artist: cur.artist || '',
        cover: cur.cover || cur.picUrl || '',
        duration: cur.duration || 0,
      }
    : { id: 'demo-1', source: 'qq', title: '一起听', artist: '从听一听选歌', cover: '', duration: 0 };
  if (cur) showToast('将切换为房间歌曲');
  const res = await createRoom({ conversationId: conv, track });
  if (res?.ok && res.room) {
    const ext = {
      roomId: res.room.id,
      title: track.title,
      artist: track.artist,
      cover: track.cover,
      source: track.source,
      hostName: props.me?.nickname || '我',
      memberCount: 1,
      id: track.id,
    };
    if (!socket) socket = getSocket();
    socket?.emit('private:send', {
      conversationId: conv,
      content: '',
      mediaType: 'listentogether',
      ext,
    }, () => {});
    emit('open-view', { type: 'listen-together' });
  }
}`,
    `function openListenTogether() {
  const conv = conversationId.value;
  const existing = listenTogether.state.room;
  if (existing && existing.conversationId === conv) {
    emit('open-view', { type: 'listen-together' });
    return;
  }
  if (existing) {
    showToast('请先退出当前一起听');
    return;
  }
  // 先点歌，选中后再开房播放
  emit('open-view', {
    type: 'listen-together',
    pickSong: true,
    conversationId: conv,
    hostName: props.me?.nickname || '我',
  });
}`,
  ],
  [
    `    <ListenTogetherBar
      v-if="listenTogether.inRoom && listenTogether.state.room?.conversationId === conversationId"
      @open-room="emit('open-view', { type: 'listen-together' })"
    />

    <footer class="chat-dock">`,
    `    <footer class="chat-dock">`,
  ],
]);
