// FongMi / 影视TV QuickJS Spider；标签和演员目录从站点动态读取。
const SITE = 'https://koreanpornmovie.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 15000;
const CLASSES = [
  { type_id: 'tags', type_name: '标签分类' },
  { type_id: 'actors', type_name: '演员' }
];

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
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ').trim();
}

function attrs(tag) {
  const result = {};
  const re = /([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let m;
  while ((m = re.exec(tag))) result[m[1].toLowerCase()] = decode(m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4]);
  return result;
}

function hasClass(tag, name) {
  return (' ' + (attrs(tag).class || '').replace(/\s+/g, ' ') + ' ').indexOf(' ' + name + ' ') !== -1;
}

// 只匹配所需标签的边界，保留嵌套菜单/正文；不依赖浏览器 DOM API。
function block(html, tag, name) {
  const re = new RegExp('</?' + tag + '\\b[^>]*>', 'gi');
  let start = -1;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    const closing = /^<\//.test(m[0]);
    if (start < 0) {
      if (!closing && hasClass(m[0], name)) { start = m.index; depth = 1; }
    } else {
      depth += closing ? -1 : 1;
      if (!depth) return html.slice(start, re.lastIndex);
    }
  }
  return '';
}

function absolute(value, base) {
  let u = decode(value).trim();
  if (!u || u[0] === '#' || /^(?:javascript|data):/i.test(u)) return '';
  base = base || SITE + '/';
  if (u.indexOf('//') === 0) u = 'https:' + u;
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(u)) return '';
    const origin = base.match(/^https?:\/\/[^/]+/i);
    if (!origin) return '';
    if (u[0] === '/') u = origin[0] + u;
    else if (u[0] === '?') u = base.split(/[?#]/)[0] + u;
    else u = base.split(/[?#]/)[0].replace(/[^/]*$/, '') + u;
  }
  const parts = u.match(/^(https?:\/\/[^/]+)([^?#]*)([?#][\s\S]*)?$/i);
  if (!parts) return '';
  const path = [];
  parts[2].split('/').forEach(function (part) {
    if (part === '..') path.pop();
    else if (part !== '.') path.push(part);
  });
  return parts[1] + (path.join('/') || '/') + (parts[3] || '');
}

function sitePath(value) {
  const url = absolute(value);
  return url.indexOf(SITE + '/') === 0 ? url.slice(SITE.length).split('#')[0] : '';
}

function getHtml(url, referer) {
  const r = req(url, {
    method: 'get', timeout: TIMEOUT,
    headers: { 'User-Agent': UA, Referer: referer || SITE + '/', 'Accept-Language': 'zh-CN,zh;q=0.9' }
  });
  if (!r || Number(r.code) < 200 || Number(r.code) >= 300 || typeof r.content !== 'string') {
    throw new Error('koreanpornmovie HTTP ' + (r && r.code));
  }
  return r.content;
}

function pageNumber(value) { return Math.max(1, parseInt(value, 10) || 1); }
function emptyPage(page) { return { list: [], page: page, pagecount: page, limit: 0, total: 0 }; }
function canonical(path) { return path.replace(/%[\da-f]{2}/gi, function (s) { return s.toUpperCase(); }).replace(/\/$/, ''); }
function main(html) { return block(html, 'main', 'site-main'); }

function help(list, kind) {
  // 影视仓按首项是否 folder 选择布局；首项操作卡片保留三列海报网格。
  if (list.length) list.unshift({ vod_id: kind + ':help', vod_name: SITE, vod_pic: '', vod_remarks: kind === 'tags' ? '标签分类' : '演员', action: kind + ':help' });
  return list;
}

function tagFolders(html, page) {
  const list = [];
  const seen = Object.create(null);
  const re = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  let m;
  const scope = main(html);
  while ((m = re.exec(scope))) {
    const tag = m[0].match(/^<a\b[^>]*>/i)[0];
    const path = sitePath(attrs(tag).href);
    const name = text(m[0]);
    const key = canonical(path);
    if (!hasClass(tag, 'tag-cloud-link') || !/^\/tag\/[^/?#]+\/?$/.test(path) || !name || seen[key]) continue;
    seen[key] = true;
    list.push({ vod_id: path, vod_name: name, vod_pic: '', vod_tag: 'folder', vod_remarks: '标签' });
  }
  help(list, 'tags');
  const limit = 30;
  return { list: list.slice((page - 1) * limit, page * limit), page: page, pagecount: Math.max(1, Math.ceil(list.length / limit)), limit: limit, total: list.length };
}

function cards(html, actors, firstList) {
  const list = [];
  const seen = Object.create(null);
  const re = /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi;
  let m;
  const scope = firstList ? block(main(html), 'div', 'videos-list') : main(html);
  while ((m = re.exec(scope))) {
    const opening = m[0].match(/^<article\b[^>]*>/i)[0];
    if (!hasClass(opening, actors ? 'thumb-block' : 'loop-video')) continue;
    const link = m[0].match(/<a\b[^>]*>/i);
    const path = link && sitePath(attrs(link[0]).href);
    const name = text(block(m[0], 'header', 'entry-header'));
    const key = path && canonical(path);
    if (!path || !name || seen[key] || (actors && !/^\/actor\/[^/?#]+\/?$/.test(path))) continue;
    seen[key] = true;
    const img = m[0].match(/<img\b[^>]*>/i);
    const image = img ? attrs(img[0]) : {};
    const vod = {
      vod_id: actors ? path : SITE + path, vod_name: name,
      vod_pic: absolute(image['data-src'] || image.src || attrs(opening)['data-main-thumb']),
      vod_remarks: actors ? '演员' : text(block(m[0], 'span', 'duration'))
    };
    if (actors) vod.vod_tag = 'folder';
    list.push(vod);
  }
  return list;
}

function pageResult(html, page, actors) {
  const list = cards(html, actors);
  if (!list.length) return emptyPage(page);
  let pagecount = page;
  const pagination = block(main(html), 'div', 'pagination');
  const re = /<a\b[^>]*>/gi;
  let m;
  while ((m = re.exec(pagination))) {
    const path = sitePath(attrs(m[0]).href);
    const number = path.match(/\/page\/(\d+)(?:\/|\?|$)/);
    if (number) pagecount = Math.max(pagecount, Number(number[1]));
  }
  const limit = list.length;
  if (actors && page === 1) help(list, 'actors');
  return { list: list, page: page, pagecount: pagecount, limit: limit };
}

function playerFrame(html, base) {
  const scope = block(main(html), 'div', 'video-player');
  const re = /<iframe\b[^>]*>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const url = absolute(attrs(m[0]).src, base);
    if (sitePath(url).indexOf('/wp-content/plugins/clean-tube-player/public/player-x.php?') === 0) return url;
  }
  return '';
}

export default {
  init(ext) {},

  home(filter) { return JSON.stringify({ class: CLASSES }); },

  homeVod() {
    try { return JSON.stringify({ list: cards(getHtml(SITE + '/'), false, true) }); }
    catch (e) { return JSON.stringify({ list: [] }); }
  },

  action(id) {
    const messages = {
      'tags:help': SITE,
      'actors:help': SITE
    };
    return JSON.stringify(Object.prototype.hasOwnProperty.call(messages, id) ? { toast: messages[id] } : {});
  },

  category(tid, pg, filter, extend) {
    const page = pageNumber(pg);
    try {
      if (tid === 'tags') return JSON.stringify(tagFolders(getHtml(SITE + '/tags/'), page));
      if (tid === 'actors') return JSON.stringify(pageResult(getHtml(SITE + '/actors/' + (page > 1 ? 'page/' + page + '/' : '')), page, true));
      const path = sitePath(tid);
      if (!/^\/(?:tag|actor)\/[^/?#]+\/?$/.test(path)) return JSON.stringify(emptyPage(page));
      const url = SITE + path.replace(/\/$/, '') + '/' + (page > 1 ? 'page/' + page + '/' : '');
      return JSON.stringify(pageResult(getHtml(url), page, false));
    } catch (e) { return JSON.stringify(emptyPage(page)); }
  },

  search(wd, quick, pg) {
    const page = pageNumber(pg);
    const key = String(wd || '').trim();
    if (!key) return JSON.stringify(emptyPage(page));
    try {
      const url = SITE + (page > 1 ? '/page/' + page + '/' : '/') + '?s=' + encodeURIComponent(key);
      return JSON.stringify(pageResult(getHtml(url), page, false));
    } catch (e) { return JSON.stringify(emptyPage(page)); }
  },

  detail(id) {
    try {
      const url = absolute(id);
      if (!sitePath(url)) return JSON.stringify({ list: [] });
      const html = getHtml(url);
      const scope = main(html);
      const title = text(block(scope, 'h1', 'entry-title'));
      const frame = playerFrame(html, url);
      if (!title || !frame) return JSON.stringify({ list: [] });
      let pic = '';
      const year = title.match(/\((\d{4})\)/);
      const metas = scope.match(/<meta\b[^>]*>/gi) || [];
      metas.forEach(function (tag) {
        const a = attrs(tag);
        if (a.itemprop === 'thumbnailUrl') pic = absolute(a.content, url);
      });
      return JSON.stringify({ list: [{
        vod_id: url, vod_name: title, vod_pic: pic, vod_year: year ? year[1] : '',
        vod_content: text(block(scope, 'div', 'desc')),
        vod_play_from: 'KoreanPornMovie', vod_play_url: '播放$' + frame
      }] });
    } catch (e) { return JSON.stringify({ list: [] }); }
  },

  play(flag, id, vipFlags) {
    try {
      const url = absolute(id);
      if (sitePath(url).indexOf('/wp-content/plugins/clean-tube-player/public/player-x.php?') !== 0) return JSON.stringify({ parse: 0, url: '' });
      // 读取播放器生成的 source，不执行脚本，也不依赖 Node/浏览器的 Base64 API。
      const html = getHtml(url);
      const video = html.match(/<video\b[^>]*>[\s\S]*?<\/video\s*>/i);
      const sources = video ? video[0].match(/<source\b[^>]*>/gi) || [] : [];
      for (let i = 0; i < sources.length; i++) {
        const stream = absolute(attrs(sources[i]).src, url);
        if (!/\.(?:mp4|m3u8)(?:[?#]|$)/i.test(stream)) continue;
        return JSON.stringify({ parse: 0, url: stream, header: { 'User-Agent': UA, Referer: url } });
      }
      return JSON.stringify({ parse: 0, url: '' });
    } catch (e) { return JSON.stringify({ parse: 0, url: '' }); }
  }
};
