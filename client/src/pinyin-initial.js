// 中文名拼音首字母（通讯录 A–Z 分组用）
// 覆盖常见姓氏 + 本项目 AI 人设名首字；未收录的汉字归入 '#'

const SURNAMES = {
  阿:'A', 艾:'A', 安:'A', 昂:'A', 敖:'A',
  巴:'B', 白:'B', 百:'B', 柏:'B', 包:'B', 鲍:'B', 暴:'B', 卑:'B', 贝:'B', 贲:'B', 本:'B', 毕:'B', 闭:'B', 边:'B', 卞:'B', 别:'B', 宾:'B', 薄:'B', 卜:'B', 步:'B', 布:'B',
  蔡:'C', 藏:'C', 曹:'C', 岑:'C', 查:'C', 茶:'C', 柴:'C', 常:'C', 畅:'C', 车:'C', 陈:'C', 陈: 'C', 成:'C', 程:'C', 池:'C', 迟:'C', 储:'C', 楚:'C', 褚:'C', 崔:'C', 村:'C',
  戴:'D', 黛:'D', 丹:'D', 但:'D', 邓:'D', 狄:'D', 迪:'D', 刁:'D', 丁:'D', 定:'D', 东:'D', 董:'D', 窦:'D', 杜:'D', 段:'D', 顿:'D',
  樊:'F', 范:'F', 方:'F', 芳:'F', 房:'F', 费:'F', 冯:'F', 凤:'F', 芙:'F', 符:'F', 福:'F', 傅:'F', 富:'F',
  甘:'G', 刚:'G', 高:'G', 戈:'G', 葛:'G', 耿:'G', 龚:'G', 巩:'G', 古:'G', 顾:'G', 关:'G', 观:'G', 管:'G', 光:'G', 郭:'G', 国:'G',
  韩:'H', 杭:'H', 郝:'H', 何:'H', 和:'H', 贺:'H', 赫:'H', 鹤:'H', 恒:'H', 洪:'H', 侯:'H', 后:'H', 胡:'H', 花:'H', 华:'H', 黄:'H', 辉:'H', 惠:'H', 霍:'H',
  姬:'J', 吉:'J', 纪:'J', 季:'J', 贾:'J', 简:'J', 江:'J', 姜:'J', 蒋:'J', 焦:'J', 金:'J', 荆:'J', 景:'J', 鞠:'J',
  康:'K', 柯:'K', 可:'K', 孔:'K', 匡:'K',
  赖:'L', 兰:'L', 蓝:'L', 郎:'L', 劳:'L', 雷:'L', 黎:'L', 李:'L', 力:'L', 连:'L', 莲:'L', 梁:'L', 廖:'L', 林:'L', 凌:'L', 刘:'L', 柳:'L', 龙:'L', 卢:'L', 陆:'L', 吕:'L', 罗:'L', 骆:'L', 洛:'L',
  马:'M', 满:'M', 毛:'M', 梅:'M', 美:'M', 孟:'M', 米:'M', 苗:'M', 闵:'M', 明:'M', 莫:'M', 牟:'M', 木:'M', 穆:'M',
  那:'N', 娜:'N', 乃:'N', 南:'N', 倪:'N', 年:'N', 聂:'N', 宁:'N', 牛:'N', 农:'N',
  欧:'O', 区:'O',
  潘:'P', 庞:'P', 裴:'P', 彭:'P', 皮:'P', 平:'P', 蒲:'P',
  戚:'Q', 齐:'Q', 祁:'Q', 钱:'Q', 强:'Q', 乔:'Q', 秦:'Q', 邱:'Q', 裘:'Q', 屈:'Q', 权:'Q', 全:'Q',
  冉:'R', 饶:'R', 任:'R', 荣:'R', 容:'R', 阮:'R', 瑞:'R', 若:'R',
  沙:'S', 山:'S', 尚:'S', 邵:'S', 申:'S', 沈:'S', 盛:'S', 师:'S', 施:'S', 石:'S', 时:'S', 史:'S', 寿:'S', 舒:'S', 束:'S', 双:'S', 水:'S', 司:'S', 宋:'S', 苏:'S', 孙:'S',
  谭:'T', 汤:'T', 唐:'T', 陶:'T', 滕:'T', 田:'T', 童:'T', 涂:'T',
  万:'W', 汪:'W', 王:'W', 危:'W', 韦:'W', 魏:'W', 温:'W', 文:'W', 闻:'W', 翁:'W', 巫:'W', 邬:'W', 吴:'W', 伍:'W', 武:'W',
  奚:'X', 习:'X', 夏:'X', 仙:'X', 先:'X', 肖:'X', 萧:'X', 晓:'X', 谢:'X', 忻:'X', 辛:'X', 邢:'X', 熊:'X', 徐:'X', 许:'X', 宣:'X', 薛:'X',
  严:'Y', 言:'Y', 阎:'Y', 颜:'Y', 晏:'Y', 杨:'Y', 姚:'Y', 叶:'Y', 依:'Y', 伊:'Y', 易:'Y', 殷:'Y', 尹:'Y', 应:'Y', 英:'Y', 于:'Y', 余:'Y', 俞:'Y', 虞:'Y', 禹:'Y', 喻:'Y', 元:'Y', 袁:'Y', 岳:'Y', 云:'Y', 运:'Y',
  臧:'Z', 曾:'Z', 詹:'Z', 张:'Z', 章:'Z', 赵:'Z', 甄:'Z', 郑:'Z', 钟:'Z', 周:'Z', 朱:'Z', 诸:'Z', 庄:'Z', 卓:'Z', 邹:'Z', 祖:'Z', 左:'Z',
};

// 本项目 AI / 常用名首字补充
const EXTRA = {
  思:'S', 嘶:'S', 司:'S', 四:'S', 松:'S', 颂:'S', 俗:'S', 素:'S', 粟:'S', 岁:'S', 孙:'S',
  小:'X', 肖:'X', 销:'X', 晓:'X', 笑:'X', 效:'X', 谢:'X', 心:'X', 新:'X', 信:'X', 星:'X', 兴:'X',
  阿:'A', 爱:'A', 安:'A',
  也:'Y', 野:'Y', 叶:'Y', 业:'Y', 夜:'Y',
  方:'F', 芳:'F', 飞:'F', 非:'F', 菲:'F', 废:'F',
  妈:'M', 马:'M', 玛:'M',
  爸:'B', 八:'B', 把:'B',
  强:'Q', 球:'Q',
  妞:'N', 牛:'N',
  拉:'L', 辣:'L', 来:'L',
  甜:'T', 田:'T', 天:'T',
  乐:'L', 了:'L',
  一:'Y', 医:'Y', 衣:'Y',
  二:'E',
  三:'S', 山:'S',
  五:'W',
  七:'Q',
  八:'B',
  九:'J',
  十:'S',
};

const MAP = { ...SURNAMES, ...EXTRA };

export function pinyinInitial(name) {
  const s = String(name || '').trim();
  if (!s) return '#';
  const ch = s[0];
  if (/[a-zA-Z]/.test(ch)) return ch.toUpperCase();
  if (/[0-9]/.test(ch)) return '#';
  if (/[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ch)) return '#';
  if (MAP[ch]) return MAP[ch];
  // 次常用: 读音相近的启发式无法覆盖全部汉字, 未收录归 #
  return '#';
}

/** 会话内排序用的键: 字母 + 拼音/原文 */
export function contactSortKey(name) {
  const letter = pinyinInitial(name);
  const s = String(name || '');
  return `${letter}|${s}`;
}

export function groupContactsByLetter(list) {
  const map = new Map();
  for (const p of list) {
    const L = pinyinInitial(p.nickname || p.name || '');
    if (!map.has(L)) map.set(L, []);
    map.get(L).push(p);
  }
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  const ordered = [];
  const byName = (a, b) =>
    String(a.nickname || a.name || '').localeCompare(String(b.nickname || b.name || ''), 'zh-Hans-CN');
  for (const L of letters) {
    if (!map.has(L)) continue;
    ordered.push({ letter: L, people: [...map.get(L)].sort(byName) });
  }
  if (map.has('#')) {
    ordered.push({ letter: '#', people: [...map.get('#')].sort(byName) });
  }
  return ordered;
}
