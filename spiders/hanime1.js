// 影视仓同步 QuickJS；不执行网站脚本，也不自动获取浏览器 Cookie。
const SITE = 'https://hanime1.me';
const DEFAULT_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
let config = {};
let landing = '';

function object(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (e) { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function decode(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, function (all, key) {
    if (key[0] !== '#') return named[key.toLowerCase()];
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}

function text(value) {
  return decode(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function attrs(tag) {
  const result = {};
  const re = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) result[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
  return result;
}

function hasClass(tag, name) {
  return (' ' + (attrs(tag).class || '').replace(/\s+/g, ' ') + ' ').indexOf(' ' + name + ' ') >= 0;
}

function block(html, tag, predicate) {
  const re = new RegExp('</?' + tag + '\\b[^>]*>', 'gi');
  let start = -1;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    const closing = /^<\//.test(m[0]);
    if (start < 0) {
      if (!closing && predicate(m[0])) { start = m.index; depth = 1; }
    } else {
      depth += closing ? -1 : 1;
      if (!depth) return html.slice(start, re.lastIndex);
    }
  }
  return '';
}

function byId(html, tag, id) { return block(html, tag, function (t) { return attrs(t).id === id; }); }
function byClass(html, tag, name) { return block(html, tag, function (t) { return hasClass(t, name); }); }
function absolute(value) {
  value = decode(value).trim();
  if (value.indexOf('//') === 0) return 'https:' + value;
  if (value[0] === '/' && value[1] !== '/') return SITE + value;
  return /^https?:\/\/[^\s]+$/i.test(value) ? value : '';
}
function pageNumber(value) { return Math.max(1, Math.floor(Number(value) || 1)); }
function ua() { return config.userAgent || DEFAULT_UA; }

function getHtml(path) {
  if (config.cookie && !config.userAgent) throw new Error('配置 Cookie 时还需填写同一浏览器的 userAgent');
  const headers = { 'User-Agent': ua(), Referer: SITE + '/', 'Accept-Language': 'zh-CN,zh;q=0.9' };
  if (config.cookie) headers.Cookie = config.cookie;
  let r;
  try { r = req(SITE + path, { method: 'get', timeout: 15000, headers: headers }); }
  catch (e) { throw new Error('Hanime1 网络请求失败，请检查网络后重试'); }
  const html = r && typeof r.content === 'string' ? r.content : '';
  const title = text((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  if (/Just a moment|请稍候|請稍候/i.test(title) ||
      (r && [403, 503].indexOf(Number(r.code)) >= 0 && /cloudflare|cf-chl-/i.test(html))) {
    throw new Error('Cloudflare 验证未通过，请手动验证并更新 ext.cookie 和 ext.userAgent');
  }
  if (!r || Number(r.code) < 200 || Number(r.code) >= 300) throw new Error('Hanime1 HTTP ' + (r && r.code));
  if (!html.trim()) throw new Error('Hanime1 返回空响应');
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function options(html, className) {
  const list = [];
  const seen = Object.create(null);
  const re = /<div\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = attrs(m[0]);
    if (!hasClass(m[0], className) || a['data-value'] === undefined || seen[a['data-value']]) continue;
    const body = block(html.slice(m.index), 'div', function () { return true; });
    const name = text(body);
    if (name) { list.push({ n: name, v: a['data-value'] }); seen[a['data-value']] = true; }
  }
  return list;
}

function navigation(html) {
  const genres = options(byId(html, 'div', 'genre-modal'), 'genre-option');
  const sort = options(byId(html, 'div', 'sort-modal'), 'hentai-sort-options-wrapper');
  const tags = [];
  const seen = Object.create(null);
  (byId(html, 'div', 'tags').match(/<label\b[^>]*>[\s\S]*?<\/label>/gi) || []).forEach(function (label) {
    const a = attrs((label.match(/<input\b[^>]*>/i) || [''])[0]);
    if (a.name !== 'tags[]' || !a.value || seen[a.value]) return;
    tags.push({ n: text(byClass(label, 'span', 'checkmark')) || a.value, v: a.value });
    seen[a.value] = true;
  });
  if (!genres.length || !tags.length || !sort.length) throw new Error('未识别网站分类或筛选选项，请检查页面结构');
  const filters = {};
  const classes = genres.map(function (g) {
    const id = 'genre:' + encodeURIComponent(g.v);
    const tagValues = [{ n: '不限', v: '' }].concat(tags);
    filters[id] = [1, 2, 3].map(function (i) { return { key: 'tag' + i, name: '标签' + i, init: '', value: tagValues }; });
    filters[id].push({ key: 'broad', name: '匹配规则', init: '', value: [{ n: '全部符合', v: '' }, { n: '任意符合', v: 'on' }] });
    filters[id].push({ key: 'sort', name: '排序', init: '', value: [{ n: '网站默认', v: '' }].concat(sort.filter(function (s) { return s.v; })) });
    return { type_id: id, type_name: g.n };
  });
  return { class: classes, filters: filters };
}

function searchPath(genre, page, extend, keyword) {
  const e = object(extend);
  const pairs = [];
  function add(key, value) { pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(value)); }
  if (genre && genre !== '全部') add('genre', genre);
  if (keyword) add('query', keyword);
  const seen = Object.create(null);
  [e.tag1, e.tag2, e.tag3].forEach(function (tag) {
    if (typeof tag === 'string' && tag && !seen[tag]) { add('tags[]', tag); seen[tag] = true; }
  });
  if (e.broad === 'on') add('broad', 'on');
  if (typeof e.sort === 'string' && e.sort) add('sort', e.sort);
  add('page', pageNumber(page));
  return '/search?' + pairs.join('&');
}

function watchId(value) {
  const url = absolute(value);
  const m = url.match(/^https:\/\/hanime1\.me\/watch\?v=(\d+)(?:&|$)/);
  return m ? m[1] : '';
}

function cards(html) {
  const list = [];
  const seen = Object.create(null);
  (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) || []).forEach(function (a) {
    const horizontal = hasClass(a.slice(0, a.indexOf('>') + 1), 'video-link');
    const vertical = byClass(a, 'div', 'search-videos');
    if (!horizontal && !vertical) return;
    const id = watchId(attrs(a.slice(0, a.indexOf('>') + 1)).href);
    if (!id || seen[id]) return;
    const name = text(byClass(a, 'div', horizontal ? 'title' : 'home-rows-videos-title'));
    if (!name) return;
    const image = attrs((a.match(/<img\b[^>]*>/i) || [''])[0]);
    list.push({ vod_id: 'video:' + id, vod_name: name, vod_pic: absolute(image['data-src'] || image.src), vod_remarks: text(byClass(a, 'div', 'duration')) });
    seen[id] = true;
  });
  return list;
}

function listing(html, page) {
  const list = cards(html);
  if (!list.length && !byId(html, 'div', 'genre-modal')) throw new Error('未识别视频列表，请检查页面结构');
  let last = page;
  (html.match(/<ul\b[^>]*>[\s\S]*?<\/ul>/gi) || []).forEach(function (nav) {
    if (!hasClass(nav.slice(0, nav.indexOf('>') + 1), 'pagination')) return;
    const re = /[?&](?:amp;)?page=(\d+)/g;
    let m;
    while ((m = re.exec(nav))) last = Math.max(last, Number(m[1]));
  });
  return { list: list, page: page, pagecount: list.length ? last : page, limit: list.length };
}

function failure(page, error) {
  const message = String(error.message || error);
  return { list: [{ vod_id: 'status', vod_name: message, vod_pic: '', vod_remarks: SITE, action: 'error:' + message }], page: page, pagecount: page, limit: 1 };
}
function meta(html, name) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    const a = attrs(tags[i]);
    if (a.property === name || a.name === name) return a.content || '';
  }
  return '';
}
function videoId(value) { return (String(value || '').match(/^video:(\d+)(?::[^#\s$]+)?$/) || [])[1] || watchId(value); }
function media(html) {
  const player = byId(html, 'video', 'player');
  const list = [];
  (player.match(/<source\b[^>]*>/gi) || []).forEach(function (tag) {
    const a = attrs(tag);
    const url = absolute(a.src);
    if (!/^https?:\/\/[^\s]+\.(?:mp4|m3u8)(?:[?#]|$)/i.test(url)) return;
    list.push({ name: a.size || String(list.length + 1), url: url });
  });
  if (!list.length) throw new Error('未找到支持的播放器媒体地址');
  return list;
}

export default {
  init(ext) {
    ext = object(ext);
    const headers = object(ext.headers);
    config = { cookie: String(ext.cookie || headers.Cookie || ''), userAgent: String(ext.userAgent || headers['User-Agent'] || '') };
    landing = '';
  },
  home() {
    try { landing = getHtml('/search'); return JSON.stringify(navigation(landing)); }
    catch (e) { landing = ''; return JSON.stringify({ class: [{ type_id: 'status', type_name: '站点状态' }] }); }
  },
  homeVod() {
    try { const html = landing || getHtml('/search'); landing = ''; return JSON.stringify(listing(html, 1)); }
    catch (e) { return JSON.stringify(failure(1, e)); }
  },
  category(tid, pg, filter, extend) {
    const page = pageNumber(pg);
    try {
      if (tid === 'status') { landing = ''; getHtml('/search'); throw new Error('验证已通过，请刷新站点首页以重新加载分类'); }
      if (String(tid).indexOf('genre:') !== 0) throw new Error('无效的 Hanime1 分类');
      const genre = decodeURIComponent(String(tid).slice(6));
      return JSON.stringify(listing(getHtml(searchPath(genre, page, extend)), page));
    } catch (e) { return JSON.stringify(failure(page, e)); }
  },
  search(wd, quick, pg) {
    const page = pageNumber(pg);
    const keyword = String(wd || '').trim();
    if (!keyword) return JSON.stringify({ list: [], page: page, pagecount: page, limit: 0 });
    try { return JSON.stringify(listing(getHtml(searchPath('', page, {}, keyword)), page)); }
    catch (e) { return JSON.stringify(failure(page, e)); }
  },
  detail(id) {
    const key = videoId(id);
    if (!key) throw new Error('无效的视频 ID');
    const html = getHtml('/watch?v=' + key);
    const sources = media(html);
    const title = text(meta(html, 'og:title')).replace(/\s*-\s*Hanime1\.me\s*$/i, '');
    if (!title) throw new Error('未识别视频详情');
    return JSON.stringify({ list: [{ vod_id: 'video:' + key, vod_name: title, vod_pic: absolute(meta(html, 'og:image')),
      vod_content: text(meta(html, 'description') || meta(html, 'og:description')), vod_play_from: 'Hanime1',
      vod_play_url: sources.map(function (s) { return s.name + 'p$video:' + key + ':' + s.name; }).join('#') }] });
  },
  play(flag, id) {
    const key = videoId(id);
    if (!key) throw new Error('无效的视频 ID');
    const quality = String(id).split(':')[2];
    const list = media(getHtml('/watch?v=' + key));
    const source = list.filter(function (s) { return s.name === quality; })[0] || list[0];
    const headers = { 'User-Agent': ua(), Referer: SITE + '/watch?v=' + key };
    // 不把站点 Cookie 发给媒体 CDN。
    if (source.url.indexOf(SITE + '/') === 0 && config.cookie) headers.Cookie = config.cookie;
    return JSON.stringify({ parse: 0, url: source.url, header: headers });
  },
  action(id) {
    if (String(id).indexOf('error:') === 0) return JSON.stringify({ toast: String(id).slice(6) + '；' + SITE });
    return '{}';
  }
};
