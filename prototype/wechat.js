/* WeChat 高保真交互原型 */
(function () {
  "use strict";

  // ── 工具 ──
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v);
      } else if (k === "dataset") {
        Object.assign(el.dataset, v);
      } else if (v !== undefined && v !== null && v !== false) {
        el.setAttribute(k, v === true ? "" : v);
      }
    }
    const list = Array.isArray(children) ? children : [children];
    for (const c of list) {
      if (c == null || c === false) continue;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svgDataUri(svg) {
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function makeAvatarSvg(bg, label, size = 96) {
    const initial = (label || "?").slice(0, 1);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect width="100%" height="100%" fill="${bg}"/>
      <text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle"
        fill="#fff" font-size="${size * 0.38}" font-family="PingFang SC,Microsoft YaHei,sans-serif"
        font-weight="500">${initial}</text>
    </svg>`;
    return svgDataUri(svg);
  }

  function makePhotoSvg(w, h, c1, c2, label) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <text x="50%" y="52%" text-anchor="middle" fill="rgba(255,255,255,.92)"
        font-size="18" font-family="PingFang SC,sans-serif">${label || ""}</text>
    </svg>`;
    return svgDataUri(svg);
  }

  function fmtListTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    if (d.toDateString() === now.toDateString()) return hm;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "昨天";
    const diff = (now - d) / 86400000;
    if (diff < 7) return ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function fmtChatTime(ts) {
    const d = new Date(ts);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return hm;
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
  }

  function showToast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => {
      t.hidden = true;
    }, 1600);
  }

  function updateStatusTime() {
    const d = new Date();
    $("#statusTime").textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  // ── 颜色 / 头像资源 ──
  const COLORS = ["#5b8def", "#e67e22", "#9b59b6", "#16a085", "#e74c3c", "#3498db", "#f39c12", "#1abc9c"];
  const avatarCache = new Map();
  function avatarSrc(name, color) {
    const key = name + (color || "");
    if (!avatarCache.has(key)) {
      avatarCache.set(key, makeAvatarSvg(color || COLORS[name.length % COLORS.length], name));
    }
    return avatarCache.get(key);
  }

  const photos = {
    cat: makePhotoSvg(400, 400, "#f6c177", "#eb6f92", "橘猫"),
    food: makePhotoSvg(400, 400, "#9ccfd8", "#c4a7e7", "晚饭"),
    view: makePhotoSvg(400, 400, "#31748f", "#9ccfd8", "风景"),
    selfie: makePhotoSvg(400, 400, "#ea9a97", "#f6c177", "自拍"),
  };

  // ── 虚构数据 ──
  const now = Date.now();
  const min = 60000;
  const hour = 3600000;

  const me = {
    id: "me",
    name: "张小北",
    color: "#5b8def",
    avatar: avatarSrc("张", "#5b8def"),
  };

  const contacts = [
    { id: "c1", name: "阿哲", alpha: "A", color: "#e67e22" },
    { id: "c2", name: "白小纯", alpha: "B", color: "#9b59b6" },
    { id: "c3", name: "陈默", alpha: "C", color: "#16a085" },
    { id: "c4", name: "丁一诺", alpha: "D", color: "#e74c3c" },
    { id: "c5", name: "方圆", alpha: "F", color: "#3498db" },
    { id: "c6", name: "高圆圆的朋友圈很长很长的名字测试", alpha: "G", color: "#f39c12" },
    { id: "c7", name: "韩梅梅", alpha: "H", color: "#1abc9c" },
    { id: "c8", name: "季时", alpha: "J", color: "#5b8def" },
    { id: "c9", name: "柯西", alpha: "K", color: "#e67e22" },
    { id: "c10", name: "李雷", alpha: "L", color: "#9b59b6" },
    { id: "c11", name: "孟浩", alpha: "M", color: "#16a085" },
    { id: "c12", name: "南门", alpha: "N", color: "#e74c3c" },
    { id: "c13", name: "欧阳", alpha: "O", color: "#3498db" },
    { id: "c14", name: "潘多拉", alpha: "P", color: "#f39c12" },
    { id: "c15", name: "秦风", alpha: "Q", color: "#1abc9c" },
    { id: "c16", name: "任逍遥名字特别特别特别长的一个测试用户", alpha: "R", color: "#5b8def" },
    { id: "c17", name: "沈浪", alpha: "S", color: "#e67e22" },
    { id: "c18", name: "唐三", alpha: "T", color: "#9b59b6" },
    { id: "c19", name: "王也", alpha: "W", color: "#16a085" },
    { id: "c20", name: "叶修", alpha: "Y", color: "#e74c3c" },
    { id: "c21", name: "张楚岚", alpha: "Z", color: "#3498db" },
  ].map((c) => ({ ...c, avatar: avatarSrc(c.name[0], c.color) }));

  const conversations = [
    {
      id: "v1",
      type: "group",
      name: "产品设计小分队（8）",
      memberCount: 8,
      unread: 12,
      muted: true,
      pinned: true,
      draft: "",
      lastTime: now - 2 * min,
      lastPreview: "[图片]",
      lastType: "image",
      members: ["阿哲", "白小纯", "陈默", "丁一诺"],
      color: "#07c160",
      messages: [],
    },
    {
      id: "v2",
      type: "single",
      name: "阿哲",
      unread: 3,
      muted: false,
      pinned: true,
      draft: "",
      lastTime: now - 8 * min,
      lastPreview: "晚上一起吃饭吗？我订了那家日料",
      lastType: "text",
      color: "#e67e22",
      messages: [],
    },
    {
      id: "v3",
      type: "group",
      name: "家庭群",
      memberCount: 6,
      unread: 1,
      muted: true,
      pinned: false,
      draft: "",
      lastTime: now - 25 * min,
      lastPreview: "妈妈：记得吃早饭",
      lastType: "text",
      members: ["妈妈", "爸爸", "小姨"],
      color: "#f39c12",
      messages: [],
    },
    {
      id: "v4",
      type: "single",
      name: "韩梅梅",
      unread: 0,
      muted: false,
      pinned: false,
      draft: "好的，我回头看一下方案",
      lastTime: now - 40 * min,
      lastPreview: "方案你看过了吗？",
      lastType: "text",
      color: "#1abc9c",
      messages: [],
    },
    {
      id: "v5",
      type: "single",
      name: "李雷",
      unread: 0,
      muted: false,
      pinned: false,
      draft: "",
      lastTime: now - 2 * hour,
      lastPreview: "[语音] 3\"",
      lastType: "voice",
      color: "#9b59b6",
      messages: [],
    },
    {
      id: "v6",
      type: "group",
      name: "周末爬山群",
      memberCount: 16,
      unread: 0,
      muted: false,
      pinned: false,
      draft: "",
      lastTime: now - 3 * hour,
      lastPreview: "王也：这周六天气不错，八点集合？",
      lastType: "text",
      members: ["王也", "叶修", "孟浩"],
      color: "#16a085",
      messages: [],
    },
    {
      id: "v7",
      type: "single",
      name: "陈默",
      unread: 0,
      muted: false,
      pinned: false,
      draft: "",
      lastTime: now - 5 * hour,
      lastPreview: "文件已经发你邮箱了",
      lastType: "text",
      color: "#e74c3c",
      messages: [],
    },
    {
      id: "v8",
      type: "single",
      name: "高圆圆的朋友圈很长很长的名字测试",
      unread: 5,
      muted: false,
      pinned: false,
      draft: "",
      lastTime: now - 8 * hour,
      lastPreview: "哈哈哈哈哈这也太好笑了吧我跟你说那个事情真的绝了",
      lastType: "text",
      color: "#3498db",
      messages: [],
    },
    {
      id: "v9",
      type: "group",
      name: "工作对接群",
      memberCount: 24,
      unread: 0,
      muted: true,
      pinned: false,
      draft: "",
      lastTime: now - 26 * hour,
      lastPreview: "方圆：@所有人 明天上午十点例会",
      lastType: "text",
      members: ["方圆", "沈浪", "唐三"],
      color: "#576b95",
      messages: [],
    },
    {
      id: "v10",
      type: "single",
      name: "白小纯",
      unread: 0,
      muted: false,
      pinned: false,
      draft: "",
      lastTime: now - 3 * 86400000,
      lastPreview: "好的，回聊",
      lastType: "text",
      color: "#c06a3a",
      messages: [],
    },
  ];

  // 初始化会话消息
  function seedMessages() {
    const v1 = conversations.find((c) => c.id === "v1");
    v1.messages = [
      { id: "m1", type: "time", ts: now - 3 * hour },
      { id: "m2", type: "sys", content: "你邀请了丁一诺加入了群聊" },
      { id: "m3", from: "other", sender: "阿哲", color: "#e67e22", type: "text", content: "大家看一下这版首页改版稿", ts: now - 2.5 * hour },
      { id: "m4", from: "other", sender: "阿哲", color: "#e67e22", type: "image", src: photos.view, ts: now - 2.5 * hour + 1000 },
      { id: "m5", from: "me", type: "text", content: "收到，我晚点细看", ts: now - 2 * hour },
      { id: "m6", from: "other", sender: "白小纯", color: "#9b59b6", type: "text", content: "导航层级我觉得可以再压一压", ts: now - 90 * min },
      { id: "m7", from: "other", sender: "陈默", color: "#16a085", type: "text", content: "同意，现在二级有点深", ts: now - 88 * min },
      { id: "m8", from: "other", sender: "陈默", color: "#16a085", type: "voice", dur: 3, ts: now - 87 * min },
      { id: "m9", from: "me", type: "text", content: "我把入口上提一层，今晚发新稿", ts: now - 30 * min },
      { id: "m10", from: "other", sender: "丁一诺", color: "#e74c3c", type: "text", content: "👍 麻烦了", ts: now - 5 * min },
      { id: "m11", from: "other", sender: "丁一诺", color: "#e74c3c", type: "image", src: photos.food, ts: now - 4 * min },
    ];

    const v2 = conversations.find((c) => c.id === "v2");
    v2.messages = [
      { id: "a1", type: "time", ts: now - 2 * hour },
      { id: "a2", from: "other", sender: "阿哲", color: "#e67e22", type: "text", content: "在吗？", ts: now - 2 * hour },
      { id: "a3", from: "me", type: "text", content: "在的，怎么了", ts: now - 110 * min },
      { id: "a4", from: "other", sender: "阿哲", color: "#e67e22", type: "text", content: "最近有家新开的日料评价不错", ts: now - 10 * min },
      { id: "a5", from: "other", sender: "阿哲", color: "#e67e22", type: "image", src: photos.food, ts: now - 9 * min },
      { id: "a6", from: "other", sender: "阿哲", color: "#e67e22", type: "text", content: "晚上一起吃饭吗？我订了那家日料", ts: now - 8 * min },
    ];

    for (const c of conversations) {
      if (c.messages.length) continue;
      const peerColor = c.color;
      c.messages = [
        { id: c.id + "_t", type: "time", ts: c.lastTime - 10 * min },
        {
          id: c.id + "_1",
          from: "other",
          sender: c.type === "group" ? (c.members?.[0] || c.name) : c.name,
          color: peerColor,
          type: "text",
          content: c.lastPreview.replace(/^\[图片\]$/, "分享了一张图片").replace(/^\[语音\].*$/, "发来一条语音"),
          ts: c.lastTime,
        },
      ];
    }
  }
  seedMessages();

  const replyPool = [
    "好的",
    "收到～",
    "嗯嗯，明白了",
    "这个可以有",
    "我看看哈",
    "稍等，马上回你",
    "哈哈哈",
    "行，那就这么定",
    "你说了算",
    "等我下，五分钟",
    "刚忙完，咋了",
    "我也觉得",
  ];

  const emojiList = [
    "😀","😁","😂","🤣","😊","😇","🙂","🙃",
    "😉","😌","😍","🥰","😘","😗","😙","😚",
    "😋","😛","😝","😜","🤪","🤨","🧐","🤓",
    "😎","🤩","🥳","😏","😒","😞","😔","😟",
    "😕","🙁","☹️","😣","😖","😫","😩","🥺",
    "😢","😭","😤","😠","😡","🤬","🤯","😳",
    "🥵","🥶","😶","😐","😑","😬","🙄","😯",
    "👍","👎","👏","🙏","💪","✌️","🤝","❤️",
    "🔥","⭐","🎉","💯","😅","🤗","🤔","🤭",
  ];

  // ── 全局状态 ──
  const state = {
    tab: "messages",
    chatId: null,
    scrollPos: { messages: 0, contacts: 0, discover: 0, me: 0 },
    dockMode: "none", // none | emoji | plus | voice
    longPressMsgId: null,
    searchQuery: "",
  };

  // ── 消息列表 ──
  function sortConversations() {
    conversations.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastTime - a.lastTime;
    });
  }

  function renderMsgList() {
    sortConversations();
    const list = $("#msgList");
    list.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const c of conversations) {
      const item = h("li", { class: "msg-item" + (c.pinned ? " pinned" : ""), dataset: { id: c.id } });

      const av =
        c.type === "group"
          ? h("div", { class: "avatar group" }, [
              h("span", { style: `background:${COLORS[0]}` }, (c.members?.[0] || "群")[0]),
              h("span", { style: `background:${COLORS[1]}` }, (c.members?.[1] || "友")[0]),
              h("span", { style: `background:${COLORS[2]}` }, (c.members?.[2] || "们")[0]),
              h("span", { style: `background:${COLORS[3]}` }, "+"),
            ])
          : h("img", { class: "avatar", src: avatarSrc(c.name[0], c.color), alt: c.name });

      const previewText = c.draft ? `[草稿] ${c.draft}` : c.lastPreview;

      const side = h("div", { class: "msg-side" });
      if (c.unread > 0) {
        side.append(
          h("span", { class: "badge" + (c.muted ? " mute" : ""), text: c.unread > 99 ? "99+" : String(c.unread) })
        );
      }
      if (c.muted) {
        side.append(
          h("span", {
            class: "mute-icon",
            html: `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M8 10a4 4 0 0 1 8 0v1l2 2H6l2-2v-1z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M4 4l16 16" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
          })
        );
      }

      const main = h("div", { class: "msg-main" }, [
        h("div", { class: "msg-top" }, [
          h("div", { class: "msg-name", text: c.name }),
          h("div", { class: "msg-time", text: fmtListTime(c.lastTime) }),
        ]),
        h("div", { class: "msg-bottom" }, [
          h("div", { class: "msg-preview" + (c.draft ? " draft" : ""), text: previewText }),
        ]),
      ]);

      const wrap = h("div", { class: "msg-swipe" }, [av, main, side]);
      item.append(wrap);

      // 点击
      wrap.addEventListener("click", () => openChat(c.id));

      // 长按会话（模拟置顶/免打扰菜单）
      attachLongPress(wrap, () => openConvLongPress(c));

      frag.append(item);
      if (c !== conversations[conversations.length - 1]) {
        frag.append(h("div", { class: "msg-divider" }));
      }
    }

    list.append(frag);
    $("#msgEmpty").hidden = conversations.length > 0;

    const totalUnread = conversations.reduce((s, c) => s + (c.muted ? 0 : c.unread), 0);
    const badge = $("#tabBadgeMsg");
    if (totalUnread > 0) {
      badge.hidden = false;
      badge.textContent = totalUnread > 99 ? "99+" : String(totalUnread);
    } else {
      badge.hidden = true;
    }
  }

  function openConvLongPress(c) {
    state.longPressMsgId = null;
    const sheet = $("#actionSheet");
    const menu = $("#actionMenu");
    menu.innerHTML = "";
    const items = [
      { action: "pin", label: c.pinned ? "取消置顶" : "置顶" },
      { action: "mute", label: c.muted ? "取消免打扰" : "消息免打扰" },
      { action: "read", label: "标为已读" },
      { action: "delete", label: "删除该聊天", danger: true },
    ];
    for (const it of items) {
      const btn = h("button", {
        class: "action-item" + (it.danger ? " danger" : ""),
        text: it.label,
        onclick: () => {
          closeOverlays();
          if (it.action === "pin") c.pinned = !c.pinned;
          if (it.action === "mute") c.muted = !c.muted;
          if (it.action === "read") c.unread = 0;
          if (it.action === "delete") {
            const i = conversations.findIndex((x) => x.id === c.id);
            if (i >= 0) conversations.splice(i, 1);
          }
          renderMsgList();
          showToast(it.label + "（模拟）");
        },
      });
      menu.append(btn);
    }
    menu.style.top = "30%";
    menu.style.bottom = "auto";
    $("#actionBubbleRef").style.display = "none";
    $("#mask").hidden = false;
    sheet.hidden = false;
    sheet.onclick = (e) => {
      if (e.target === sheet) closeOverlays();
    };
  }

  // ── 通讯录 ──
  function renderContacts() {
    const root = $("#contactGroups");
    root.innerHTML = "";
    const groups = new Map();
    for (const c of contacts) {
      if (!groups.has(c.alpha)) groups.set(c.alpha, []);
      groups.get(c.alpha).push(c);
    }
    const alphas = [...groups.keys()].sort();
    for (const a of alphas) {
      root.append(h("div", { class: "alpha-label", id: "alpha-" + a, text: a }));
      const rows = groups.get(a);
      rows.forEach((c, idx) => {
        const row = h(
          "button",
          {
            class: "contact-row" + (idx === rows.length - 1 ? " is-last" : ""),
            onclick: () => showToast(c.name),
          },
          [
            h("img", { class: "avatar", src: c.avatar, alt: c.name }),
            h("div", { class: "contact-name", text: c.name }),
          ]
        );
        root.append(row);
      });
    }
    $("#contactCount").textContent = String(contacts.length);

    const index = $("#alphaIndex");
    index.innerHTML = "";
    for (const a of alphas) {
      const btn = h(
        "button",
        {
          text: a,
          onclick: () => {
            const el = $("#alpha-" + a);
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          },
        }
      );
      index.append(btn);
    }
  }

  // ── Tab 切换 ──
  function switchTab(tab) {
    if (state.tab === tab) return;
    const scrollEl = $(`#page${tab[0].toUpperCase() + tab.slice(1)} .scroll-y`);
    if (scrollEl) state.scrollPos[state.tab] = scrollEl.scrollTop;

    state.tab = tab;
    const pages = {
      messages: "#pageMessages",
      contacts: "#pageContacts",
      discover: "#pageDiscover",
      me: "#pageMe",
    };
    for (const [k, sel] of Object.entries(pages)) {
      $(sel).hidden = k !== tab;
    }
    $$(".tab-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });

    const next = $(`#page${tab[0].toUpperCase() + tab.slice(1)} .scroll-y`);
    if (next) next.scrollTop = state.scrollPos[tab] || 0;
  }

  // ── 聊天页 ──
  function getConv(id) {
    return conversations.find((c) => c.id === id);
  }

  function openChat(id) {
    const conv = getConv(id);
    if (!conv) return;

    // 保存列表滚动
    const listScroll = $("#msgListScroll");
    if (listScroll) state.scrollPos.messages = listScroll.scrollTop;

    state.chatId = id;
    conv.unread = 0;
    renderMsgList();

    $("#chatTitle").textContent = conv.name;
    const countEl = $("#chatMemberCount");
    if (conv.type === "group" && conv.memberCount) {
      countEl.hidden = false;
      countEl.textContent = `(${conv.memberCount})`;
    } else {
      countEl.hidden = true;
    }

    $("#chatPage").hidden = false;
    $("#chatPage").classList.remove("leaving");
    $("#chatInput").value = "";
    autoSizeInput();
    updateSendBtn();
    closeDock(true);

    $("#chatLoading").hidden = false;
    renderChatMessages(conv, true);
    setTimeout(() => {
      $("#chatLoading").hidden = true;
    }, 280);
  }

  function closeChat() {
    const page = $("#chatPage");
    page.classList.add("leaving");
    closeDock(true);
    closeOverlays();
    setTimeout(() => {
      page.hidden = true;
      page.classList.remove("leaving");
      state.chatId = null;
      // 恢复列表滚动
      const listScroll = $("#msgListScroll");
      if (listScroll) listScroll.scrollTop = state.scrollPos.messages || 0;
    }, 200);
  }

  function renderChatMessages(conv, scrollBottom) {
    const root = $("#chatMsgs");
    root.innerHTML = "";
    const frag = document.createDocumentFragment();
    let lastFrom = null;
    let lastTs = 0;

    for (const m of conv.messages) {
      if (m.type === "time") {
        frag.append(h("div", { class: "time-divider", text: fmtChatTime(m.ts) }));
        lastFrom = null;
        continue;
      }
      if (m.type === "sys") {
        frag.append(h("div", { class: "sys-msg" }, [h("span", { text: m.content })]));
        lastFrom = null;
        continue;
      }

      // 时间间隔过大重新分隔
      if (m.ts - lastTs > 5 * 60000 && lastTs) {
        frag.append(h("div", { class: "time-divider", text: fmtChatTime(m.ts) }));
        lastFrom = null;
      }
      lastTs = m.ts;

      const mine = m.from === "me";
      const senderKey = mine ? "me" : (m.sender || conv.name);
      const sameSender = lastFrom === senderKey;
      lastFrom = senderKey;

      const row = h("div", {
        class: "msg-row" + (mine ? " mine" : "") + (sameSender ? " cont" : ""),
        dataset: { msgId: m.id },
      });

      // 头像：连续消息只保留占位
      if (!sameSender) {
        if (mine) {
          row.append(h("img", { class: "avatar", src: me.avatar, alt: me.name }));
        } else {
          row.append(h("img", { class: "avatar", src: avatarSrc((m.sender || conv.name)[0], m.color || conv.color), alt: m.sender || conv.name }));
        }
      } else {
        row.append(h("div", { class: "avatar", style: "visibility:hidden" }));
      }

      const col = h("div", { class: "msg-col" });
      if (!mine && conv.type === "group" && !sameSender) {
        col.append(h("div", { class: "sender-name", text: m.sender || "" }));
      }

      let bubble;
      if (m.type === "text") {
        bubble = h("div", { class: "bubble", text: m.content });
      } else if (m.type === "image") {
        bubble = h("button", { class: "bubble img-bubble" }, [
          h("img", { src: m.src, alt: "图片" }),
        ]);
        bubble.addEventListener("click", () => openPreview(m.src));
      } else if (m.type === "voice") {
        bubble = h("button", { class: "bubble voice-bubble" }, [
          h("span", { class: "voice-wave" }, [h("i"), h("i"), h("i")]),
          h("span", { class: "voice-dur", text: `${m.dur || 1}"` }),
        ]);
        bubble.addEventListener("click", () => showToast(`播放语音 ${m.dur || 1}"`));
      } else {
        bubble = h("div", { class: "bubble", text: m.content || "" });
      }

      // 长按菜单
      attachLongPress(bubble, (x, y) => openMsgAction(m, bubble, x, y));

      col.append(bubble);
      row.append(col);
      frag.append(row);
    }

    root.append(frag);
    if (scrollBottom) {
      requestAnimationFrame(() => scrollChatToBottom(false));
    }
  }

  function scrollChatToBottom(smooth = true) {
    const el = $("#chatBody");
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }

  function appendChatMsg(m, scroll = true) {
    const conv = getConv(state.chatId);
    if (!conv) return;
    conv.messages.push(m);
    conv.lastTime = m.ts || Date.now();
    if (m.type === "text") conv.lastPreview = m.content;
    else if (m.type === "image") conv.lastPreview = "[图片]";
    else if (m.type === "voice") conv.lastPreview = `[语音] ${m.dur || 1}"`;

    // 增量渲染最后一条（简单整表刷新即可，消息量小）
    renderChatMessages(conv, false);
    if (scroll) scrollChatToBottom(true);
    renderMsgList();
  }

  // ── 输入与发送 ──
  function autoSizeInput() {
    const ta = $("#chatInput");
    ta.style.height = "auto";
    ta.style.height = Math.min(96, Math.max(20, ta.scrollHeight)) + "px";
  }

  function updateSendBtn() {
    const has = $("#chatInput").value.trim().length > 0;
    $("#btnSend").hidden = !has || state.dockMode === "voice";
  }

  function sendCurrentText() {
    const ta = $("#chatInput");
    const text = ta.value.trim();
    if (!text) return;
    const conv = getConv(state.chatId);
    if (!conv) return;

    const m = {
      id: "u" + Date.now(),
      from: "me",
      type: "text",
      content: text,
      ts: Date.now(),
    };
    ta.value = "";
    autoSizeInput();
    updateSendBtn();
    appendChatMsg(m);

    // 本地模拟回复
    const delay = 500 + Math.floor(Math.random() * 700);
    setTimeout(() => {
      if (state.chatId !== conv.id) {
        // 已离开聊天，累计未读
        conv.unread = (conv.unread || 0) + 1;
        conv.lastPreview = replyPool[Math.floor(Math.random() * replyPool.length)];
        conv.lastTime = Date.now();
        renderMsgList();
        return;
      }
      const replyText = replyPool[Math.floor(Math.random() * replyPool.length)];
      const isGroup = conv.type === "group";
      const senderName = isGroup
        ? (conv.members?.[Math.floor(Math.random() * (conv.members?.length || 1))] || "群友")
        : conv.name;
      const senderColor = isGroup
        ? COLORS[senderName.length % COLORS.length]
        : conv.color;

      appendChatMsg({
        id: "r" + Date.now(),
        from: "other",
        sender: isGroup ? senderName : undefined,
        color: senderColor,
        type: "text",
        content: replyText,
        ts: Date.now(),
      });
    }, delay);
  }

  // ── Dock 面板 ──
  function closeDock(silent) {
    $("#emojiPanel").hidden = true;
    $("#plusPanel").hidden = true;
    $("#holdTalk").hidden = true;
    $("#chatInput").hidden = false;
    state.dockMode = "none";
    updateSendBtn();
  }

  function setDockMode(mode) {
    if (state.dockMode === mode) {
      closeDock();
      return;
    }
    state.dockMode = mode;
    $("#emojiPanel").hidden = mode !== "emoji";
    $("#plusPanel").hidden = mode !== "plus";
    const isVoice = mode === "voice";
    $("#holdTalk").hidden = !isVoice;
    $("#chatInput").hidden = isVoice;
    if (!isVoice) {
      // 保持输入内容
    } else {
      // 语音模式下点输入框恢复
    }
    updateSendBtn();
    requestAnimationFrame(() => scrollChatToBottom(false));
  }

  function renderEmojis() {
    const grid = $("#emojiGrid");
    grid.innerHTML = "";
    for (const e of emojiList) {
      grid.append(
        h("button", {
          class: "emoji-item",
          text: e,
          onclick: () => {
            const ta = $("#chatInput");
            const pos = ta.selectionStart ?? ta.value.length;
            ta.value = ta.value.slice(0, pos) + e + ta.value.slice(pos);
            ta.focus();
            autoSizeInput();
            updateSendBtn();
          },
        })
      );
    }
  }

  // ── 长按 ──
  function attachLongPress(el, handler) {
    let timer = null;
    let sx = 0;
    let sy = 0;
    let fired = false;

    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      el.classList.remove("pressed");
    };

    el.addEventListener("pointerdown", (e) => {
      if (e.button != null && e.button !== 0) return;
      sx = e.clientX;
      sy = e.clientY;
      fired = false;
      el.classList.add("pressed");
      timer = setTimeout(() => {
        fired = true;
        el.classList.remove("pressed");
        handler(e.clientX, e.clientY);
      }, 480);
    });

    el.addEventListener("pointermove", (e) => {
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) clear();
    });

    el.addEventListener("pointerup", () => clear());
    el.addEventListener("pointercancel", () => clear());
    el.addEventListener("pointerleave", () => clear());

    el.addEventListener("click", (e) => {
      if (fired) {
        e.preventDefault();
        e.stopPropagation();
        fired = false;
      }
    }, true);
  }

  function openMsgAction(m, bubbleEl, x, y) {
    state.longPressMsgId = m.id;
    const sheet = $("#actionSheet");
    const menu = $("#actionMenu");
    const ref = $("#actionBubbleRef");
    menu.innerHTML = "";

    const items = [
      { action: "copy", label: "复制" },
      { action: "forward", label: "转发" },
      { action: "favorite", label: "收藏" },
      { action: "quote", label: "引用" },
      { action: "multi", label: "多选" },
      { action: "delete", label: "删除", danger: m.from === "me" },
      { action: "recall", label: "撤回" },
    ];

    for (const it of items) {
      menu.append(
        h("button", {
          class: "action-item" + (it.danger ? " danger" : ""),
          text: it.label,
          onclick: () => {
            closeOverlays();
            if (it.action === "copy" && m.type === "text") {
              if (navigator.clipboard?.writeText) {
                navigator.clipboard.writeText(m.content).catch(() => {});
              }
              showToast("已复制");
            } else if (it.action === "delete") {
              const conv = getConv(state.chatId);
              if (conv) {
                const i = conv.messages.findIndex((x) => x.id === m.id);
                if (i >= 0) conv.messages.splice(i, 1);
                renderChatMessages(conv, false);
                renderMsgList();
              }
              showToast("已删除");
            } else if (it.action === "recall") {
              showToast("撤回成功（模拟）");
              const conv = getConv(state.chatId);
              if (conv && m.from === "me") {
                const i = conv.messages.findIndex((x) => x.id === m.id);
                if (i >= 0) {
                  conv.messages.splice(i, 1, {
                    id: "sys" + Date.now(),
                    type: "sys",
                    content: "你撤回了一条消息",
                    ts: Date.now(),
                  });
                  renderChatMessages(conv, true);
                }
              }
            } else {
              showToast(it.label + "（模拟）");
            }
          },
        })
      );
    }

    // 菜单位置：优先气泡上方/下方
    const phone = $("#app").getBoundingClientRect();
    const b = bubbleEl.getBoundingClientRect();
    menu.style.visibility = "hidden";
    sheet.hidden = false;
    $("#mask").hidden = false;

    requestAnimationFrame(() => {
      const mh = menu.offsetHeight || 300;
      let top = b.top - phone.top - mh - 8;
      if (top < 56) top = b.bottom - phone.top + 8;
      const maxTop = phone.height - mh - 20;
      if (top > maxTop) top = maxTop;
      menu.style.top = Math.max(48, top) + "px";
      menu.style.bottom = "auto";
      menu.style.visibility = "visible";
    });

    sheet.onclick = (e) => {
      if (e.target === sheet || e.target === ref) closeOverlays();
    };
  }

  // ── 图片预览 ──
  function openPreview(src) {
    $("#previewImg").src = src;
    $("#imgPreview").hidden = false;
  }

  function closePreview() {
    $("#imgPreview").hidden = true;
    $("#previewImg").src = "";
  }

  // ── 弹层关闭 ──
  function closeOverlays() {
    $("#mask").hidden = true;
    $("#moreMenu").hidden = true;
    $("#chatMoreMenu").hidden = true;
    $("#actionSheet").hidden = true;
    state.longPressMsgId = null;
  }

  // ── 搜索 ──
  function openSearch() {
    $("#searchPage").hidden = false;
    $("#searchInput").value = "";
    renderSearch("");
    setTimeout(() => $("#searchInput").focus(), 50);
  }

  function closeSearch() {
    $("#searchPage").hidden = true;
    $("#searchInput").blur();
  }

  function renderSearch(q) {
    const hint = $("#searchHint");
    const box = $("#searchResults");
    box.innerHTML = "";
    q = (q || "").trim().toLowerCase();
    if (!q) {
      hint.hidden = false;
      hint.textContent = "搜索指定内容";
      return;
    }
    hint.hidden = true;

    const hits = conversations.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.lastPreview || "").toLowerCase().includes(q)
    );
    const people = contacts.filter((c) => c.name.toLowerCase().includes(q));

    if (!hits.length && !people.length) {
      hint.hidden = false;
      hint.textContent = "无结果";
      return;
    }

    if (hits.length) {
      box.append(h("div", { class: "search-cat", text: "聊天记录" }));
      for (const c of hits) {
        box.append(
          h(
            "button",
            {
              class: "search-item",
              onclick: () => {
                closeSearch();
                openChat(c.id);
              },
            },
            [
              h("img", { class: "avatar", src: avatarSrc(c.name[0], c.color), alt: "" }),
              h("div", { class: "search-item-main" }, [
                h("div", { class: "search-item-name", text: c.name }),
                h("div", { class: "search-item-sub", text: c.lastPreview }),
              ]),
            ]
          )
        );
      }
    }

    if (people.length) {
      box.append(h("div", { class: "search-cat", text: "联系人" }));
      for (const p of people) {
        box.append(
          h(
            "button",
            {
              class: "search-item",
              onclick: () => {
                closeSearch();
                showToast(p.name);
              },
            },
            [
              h("img", { class: "avatar", src: p.avatar, alt: "" }),
              h("div", { class: "search-item-main" }, [
                h("div", { class: "search-item-name", text: p.name }),
                h("div", { class: "search-item-sub", text: "联系人" }),
              ]),
            ]
          )
        );
      }
    }
  }

  // ── 事件绑定 ──
  function bindEvents() {
    // Tab
    $$(".tab-item").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    // 搜索
    $("#btnSearchOpen").addEventListener("click", openSearch);
    $("#btnSearchEntry").addEventListener("click", openSearch);
    $("#btnContactSearch").addEventListener("click", openSearch);
    $("#btnSearchCancel").addEventListener("click", closeSearch);
    $("#searchInput").addEventListener("input", (e) => renderSearch(e.target.value));

    // 消息页更多
    $("#btnMoreOpen").addEventListener("click", () => {
      $("#mask").hidden = false;
      $("#moreMenu").hidden = false;
    });

    // 聊天更多
    $("#btnChatMore").addEventListener("click", () => {
      $("#mask").hidden = false;
      $("#chatMoreMenu").hidden = false;
    });

    // 遮罩点击关闭
    $("#mask").addEventListener("click", closeOverlays);

    // 弹层菜单通用 toast
    document.addEventListener("click", (e) => {
      const t = e.target.closest("[data-toast]");
      if (t) {
        showToast(t.dataset.toast + "（模拟）");
        if (!t.closest(".dock-panel") && !t.closest(".pop-menu")) {
          // 保持
        }
        if (t.closest(".pop-menu")) closeOverlays();
      }
    });

    // 聊天返回
    $("#btnChatBack").addEventListener("click", closeChat);

    // 发送
    $("#btnSend").addEventListener("click", sendCurrentText);
    $("#chatInput").addEventListener("input", () => {
      autoSizeInput();
      updateSendBtn();
    });
    $("#chatInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCurrentText();
      }
    });
    $("#chatInput").addEventListener("focus", () => {
      if (state.dockMode === "emoji" || state.dockMode === "plus") closeDock();
      setTimeout(() => scrollChatToBottom(false), 80);
    });

    // 表情 / 加号 / 语音
    $("#btnEmoji").addEventListener("click", () => setDockMode("emoji"));
    $("#btnPlus").addEventListener("click", () => setDockMode("plus"));
    $("#btnVoiceToggle").addEventListener("click", () => {
      if (state.dockMode === "voice") {
        closeDock();
        $("#chatInput").focus();
      } else {
        setDockMode("voice");
      }
    });
    $("#btnEmojiDel").addEventListener("click", () => {
      const ta = $("#chatInput");
      // 删除一个 emoji 或字符
      const chars = [...ta.value];
      chars.pop();
      ta.value = chars.join("");
      autoSizeInput();
      updateSendBtn();
    });
    $("#holdTalk").addEventListener("click", () => showToast("松开发送（模拟）"));

    // 图片预览
    $("#btnPreviewClose").addEventListener("click", closePreview);
    $("#imgPreview").addEventListener("click", (e) => {
      if (e.target === $("#imgPreview") || e.target === $("#previewImg")) closePreview();
    });

    // 联系人添加
    $("#btnContactAdd").addEventListener("click", () => showToast("添加朋友"));

    // 点击聊天空白关闭面板（输入区除外）
    $("#chatBody").addEventListener("click", (e) => {
      if (state.dockMode === "emoji" || state.dockMode === "plus") {
        if (!e.target.closest(".bubble")) closeDock();
      }
    });
  }

  // ── 初始化 ──
  function init() {
    updateStatusTime();
    setInterval(updateStatusTime, 30000);
    renderMsgList();
    renderContacts();
    renderEmojis();
    bindEvents();
    $("#meAvatar").textContent = "张";
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
