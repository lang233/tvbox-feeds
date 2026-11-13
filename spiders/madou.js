// FongMi / 影视TV QuickJS Spider；分类来自站点导航，不维护固定分类表。
const SITE = 'https://madou.club';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 15000;

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
    throw new Error('madou HTTP ' + (r && r.code));
  }
  return r.content;
}

function menuNodes(html) {
  const nav = block(html, 'div', 'sitenav');
  const roots = [];
  const stack = [];
  const re = /<li\b[^>]*>|<\/li\s*>|<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  let m;
  while ((m = re.exec(nav))) {
    if (/^<li\b/i.test(m[0])) {
      const node = { name: '', href: '', children: [] };
      (stack.length ? stack[stack.length - 1].children : roots).push(node);
      stack.push(node);
    } else if (/^<\/li/i.test(m[0])) stack.pop();
    else if (stack.length) {
      const node = stack[stack.length - 1];
      node.name = text(m[0]);
      node.href = attrs(m[0].match(/^<a\b[^>]*>/i)[0]).href || '';
    }
  }
  return roots;
}

function groupId(node) {
  const path = sitePath(node.href);
  return 'group:' + (path.indexOf('/category/') === 0 ? path : encodeURIComponent(node.name));
}

function menuClasses(html) {
  const roots = menuNodes(html);
  const classes = [];
  const seen = {};
  function add(node, rank) {
    const path = sitePath(node.href);
    const group = !rank && (node.children.length > 0 || node.name === '其他原创/企划');
    if (!group && (!path || (!rank && path.indexOf('/category/') !== 0))) return;
    const id = group ? groupId(node) : (rank ? 'rank:' : '') + path;
    const key = id.replace(/%[\da-f]{2}/gi, function (s) { return s.toUpperCase(); }).replace(/\/$/, '');
    if (seen[key] || !node.name) return;
    seen[key] = true;
    classes.push({ type_id: id, type_name: node.name });
  }
  function rankings(nodes) {
    nodes.forEach(function (node) {
      if (node.name === '点赞排行') add(node, true);
      rankings(node.children);
    });
  }
  roots.forEach(function (node) {
    if (node.name === '麻豆传媒' || node.name === '麻豆番外篇' || node.name === '其他原创/企划') add(node, false);
  });
  rankings(roots);
  return classes;
}

function groupFolders(html, id, page) {
  let selected;
  function find(nodes) {
    nodes.forEach(function (node) {
      if (groupId(node) === id) selected = node;
      find(node.children);
    });
  }
  find(menuNodes(html));
  const list = [];
  const seen = Object.create(null);
  function add(id, name) {
    const key = id.replace(/%[\da-f]{2}/gi, function (s) { return s.toUpperCase(); }).replace(/\/$/, '');
    if (!name || seen[key]) return;
    seen[key] = true;
    list.push({ vod_id: id, vod_name: name, vod_pic: '', vod_tag: 'folder', vod_remarks: '子分类' });
  }
  if (selected) {
    const ownPath = sitePath(selected.href);
    if (ownPath.indexOf('/category/') === 0) add(ownPath, '全部内容');
    selected.children.forEach(function (node) {
      const path = sitePath(node.href);
      if (node.children.length) add(groupId(node), node.name);
      else if (path.indexOf('/category/') === 0) add(path, node.name);
    });
  }
  return folderPage(list, page, '子分类', 'groups:help');
}

function cards(html) {
  const list = [];
  const seen = {};
  const re = /<article\b[^>]*>[\s\S]*?<\/article\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (!hasClass(m[0].match(/^<article\b[^>]*>/i)[0], 'excerpt')) continue;
    const title = m[0].match(/<h2\b[^>]*>[\s\S]*?<\/h2>/i);
    const link = title && title[0].match(/<a\b[^>]*>/i);
    const id = link && absolute(attrs(link[0]).href);
    const name = title && text(title[0]);
    if (!id || !sitePath(id) || !name || seen[id]) continue;
    seen[id] = true;
    const img = m[0].match(/<img\b[^>]*>/i);
    const image = img ? attrs(img[0]) : {};
    const like = block(m[0], 'a', 'post-like');
    const count = like.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
    const date = m[0].match(/<time\b[^>]*>([\s\S]*?)<\/time>/i);
    const remarks = [];
    if (date && text(date[1])) remarks.push(text(date[1]));
    if (count && text(count[1])) remarks.push('赞 ' + text(count[1]));
    list.push({ vod_id: id, vod_name: name, vod_pic: absolute(image['data-src'] || image.src), vod_remarks: remarks.join(' · ') });
  }
  return list;
}

function pageNumber(pg) { return Math.max(1, parseInt(pg, 10) || 1); }

function pageResult(html, page, rank) {
  const list = cards(html);
  const pagination = block(html, 'div', 'pagination');
  const next = block(pagination, 'li', 'next-page');
  const hasNext = !rank && list.length > 0 && /<a\b[^>]*href\s*=/i.test(next);
  const limit = list.length;
  return { list: list, page: page, pagecount: hasNext ? page + 1 : page, limit: limit, total: (page - 1) * limit + limit + (hasNext ? 1 : 0) };
}

function emptyPage(page) { return { list: [], page: page, pagecount: page, limit: 0, total: 0 }; }

const JS_STRING = /(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)')/.source;
function literal(html, before) {
  const m = html.match(new RegExp(before + '\\s*' + JS_STRING, 'i'));
  if (!m) return '';
  return (m[1] !== undefined ? m[1] : m[2]).replace(/\\(?:u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi, function (all, u, x, c) {
    return u || x ? String.fromCharCode(parseInt(u || x, 16)) : ({ n: '\n', r: '\r', t: '\t' }[c] || c);
  });
}

function players(html, detailUrl) {
  const content = block(html, 'article', 'article-content');
  const list = [];
  const re = /<iframe\b[^>]*>/gi;
  let m;
  while ((m = re.exec(content))) {
    const url = absolute(attrs(m[0]).src, detailUrl);
    if (url && list.indexOf(url) < 0) list.push(url);
  }
  return list;
}

function tagFolders(html, page) {
  const scope = block(html, 'div', 'tagslist');
  const list = [];
  const seen = Object.create(null);
  const re = /<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  let m;
  while ((m = re.exec(scope))) {
    const opening = m[0].match(/^<a\b[^>]*>/i)[0];
    if (!hasClass(opening, 'name')) continue;
    const path = sitePath(attrs(opening).href);
    const name = text(m[0]);
    const key = path.replace(/%[\da-f]{2}/gi, function (s) { return s.toUpperCase(); }).replace(/\/$/, '');
    if (path.indexOf('/tag/') !== 0 || !name || seen[key]) continue;
    seen[key] = true;
    list.push({ vod_id: path, vod_name: name, vod_pic: '', vod_tag: 'folder', vod_remarks: '标签' });
  }
  return folderPage(list, page, '标签分类', 'tags:help');
}

function folderPage(list, page, label, action) {
  // 影视仓按首项是否文件夹选择布局；操作卡片让目录及下级页面保留海报网格。
  if (list.length) list.unshift({ vod_id: action, vod_name: SITE, vod_pic: '', vod_remarks: label, action: action });
  const limit = 30;
  return { list: list.slice((page - 1) * limit, page * limit), page: page, pagecount: Math.max(1, Math.ceil(list.length / limit)), limit: limit, total: list.length };
}

export default {
  init(ext) {
    try { this.ext = typeof ext === 'string' ? JSON.parse(ext) : (ext || {}); }
    catch (e) { this.ext = {}; }
  },

  action(id) {
    if (id === 'tags:help') return JSON.stringify({ toast: SITE });
    if (id === 'groups:help') return JSON.stringify({ toast: SITE });
    return JSON.stringify({});
  },

  home(filter) {
    try {
      const classes = menuClasses(getHtml(SITE + '/'));
      if (classes.length) classes.unshift({ type_id: 'tags', type_name: '标签分类' });
      return JSON.stringify({ class: classes });
    }
    catch (e) { return JSON.stringify({ class: [] }); }
  },

  homeVod() {
    try { return JSON.stringify({ list: cards(getHtml(SITE + '/')) }); }
    catch (e) { return JSON.stringify({ list: [] }); }
  },

  category(tid, pg, filter, extend) {
    const page = pageNumber(pg);
    try {
      if (tid === 'tags') return JSON.stringify(tagFolders(getHtml(SITE + '/tags'), page));
      if (String(tid).indexOf('group:') === 0) return JSON.stringify(groupFolders(getHtml(SITE + '/'), tid, page));
      const rank = String(tid).indexOf('rank:') === 0;
      const path = sitePath(rank ? String(tid).slice(5) : tid);
      if (!path || (!rank && !/^\/(?:category|tag)\//.test(path)) || (rank && page > 1)) return JSON.stringify(emptyPage(page));
      const url = SITE + path.replace(/\/$/, '') + (page > 1 ? '/page/' + page : '');
      return JSON.stringify(pageResult(getHtml(url), page, rank));
    } catch (e) { return JSON.stringify(emptyPage(page)); }
  },

  search(wd, quick, pg) {
    const page = pageNumber(pg);
    const key = String(wd || '').trim();
    if (!key) return JSON.stringify(emptyPage(page));
    try {
      const url = SITE + (page > 1 ? '/page/' + page : '/') + '?s=' + encodeURIComponent(key);
      return JSON.stringify(pageResult(getHtml(url), page, false));
    } catch (e) { return JSON.stringify(emptyPage(page)); }
  },

  detail(id) {
    try {
      const url = absolute(id);
      if (!sitePath(url)) return JSON.stringify({ list: [] });
      const html = getHtml(url);
      const title = text(block(html, 'h1', 'article-title'));
      const frames = players(html, url);
      if (!title || !frames.length) return JSON.stringify({ list: [] });
      let pic = '';
      const metas = html.match(/<meta\b[^>]*>/gi) || [];
      let description = '';
      metas.forEach(function (tag) {
        const a = attrs(tag);
        if (a.property === 'og:image' || a.name === 'og:image') pic = absolute(a.content, url);
        if (a.name === 'description') description = a.content || '';
      });
      if (!pic) {
        try { pic = absolute(literal(getHtml(frames[0], url), '\\bpic\\s*:'), frames[0]); }
        catch (e) {}
      }
      return JSON.stringify({ list: [{
        vod_id: url, vod_name: title, vod_pic: pic, vod_content: description,
        vod_play_from: '麻豆',
        vod_play_url: frames.map(function (frame, i) { return '播放' + (i + 1) + '$' + frame; }).join('#')
      }] });
    } catch (e) { return JSON.stringify({ list: [] }); }
  },

  play(flag, id, vipFlags) {
    try {
      const url = absolute(id);
      if (!url) return JSON.stringify({ parse: 0, url: '' });
      const html = getHtml(url, SITE + '/');
      let stream = absolute(literal(html, '\\b(?:var|let|const)\\s+m3u8\\s*='), url);
      if (!stream) return JSON.stringify({ parse: 0, url: '' });
      const token = literal(html, '\\b(?:var|let|const)\\s+token\\s*=');
      if (token) stream += (stream.indexOf('?') < 0 ? '?' : '&') + 'token=' + encodeURIComponent(token);
      return JSON.stringify({ parse: 0, url: stream, header: { 'User-Agent': UA, Referer: url } });
    } catch (e) { return JSON.stringify({ parse: 0, url: '' }); }
  }
};
