// FongMi / 影视仓 QuickJS Spider；导航和子分类从页面动态读取。
const SITE = 'https://missav.ai';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const TIMEOUT = 15000;
let navigation = null;
let landingHtml = '';


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

function getHtml(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = req(url, {
      method: 'get', timeout: TIMEOUT,
      headers: {
        'User-Agent': UA, Referer: SITE + '/',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });
    const html = r && typeof r.content === 'string' ? r.content : '';
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const challenge = !!(title && /Just a moment|请稍候|請稍候/i.test(title[1])) ||
      (Number(r && r.code) === 403 && /cloudflare|cf-chl-/i.test(html));
    if (!challenge && r && Number(r.code) >= 200 && Number(r.code) < 300 && html) return html;
    if (!attempt && (challenge || Number(r && r.code) >= 500)) continue;
    throw new Error(challenge ? 'Cloudflare 验证未通过，请稍后重新加载' : 'MissAV HTTP ' + (r && r.code));
  }
}

function pageNumber(value) { return Math.max(1, parseInt(value, 10) || 1); }
function emptyPage(page) { return { list: [], page: page, pagecount: page, limit: 0, total: 0 }; }
function canonical(path) { return path.replace(/%[\da-f]{2}/gi, function (s) { return s.toUpperCase(); }).replace(/\/$/, ''); }
function content(html) {
  const start = html.search(/<h1\b/i);
  return start < 0 ? '' : html.slice(start).split(/<footer\b/i)[0].replace(/<template\b[\s\S]*?<\/template>/gi, '');
}
function anchors(html) { return html.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) || []; }
function opening(html) { return (html.match(/^<\w+\b[^>]*>/i) || [''])[0]; }
function image(html) {
  const tag = (html.match(/<img\b[^>]*>/i) || [''])[0];
  const a = attrs(tag);
  return absolute(a['data-src'] || a.src);
}

function menu(html) {
  const nav = block(html, 'nav', 'xl:flex');
  const roots = [];
  const re = /<div\b[^>]*>|<\/div\s*>|<a\b[^>]*>[\s\S]*?<\/a\s*>/gi;
  let depth = 0;
  let group = null;
  let m;
  while ((m = re.exec(nav))) {
    if (/^<div\b/i.test(m[0])) {
      if (depth === 0) group = { id: '', name: '', children: [] };
      depth++;
    } else if (/^<\/div/i.test(m[0])) {
      depth--;
      if (depth === 0 && group) {
        if (group.id && group.id !== 'group:saved' && group.name && group.children.length) roots.push(group);
        group = null;
      }
    } else {
      const a = attrs(opening(m[0]));
      const path = sitePath(a.href);
      const name = text(m[0]);
      const dropdown = (a['@click.prevent'] || '').match(/^showDropdown\s*=\s*'([\w-]+)'$/);
      if (group && dropdown) { group.id = 'group:' + dropdown[1]; group.name = name; }
      else if (group && path && name) {
        if (!group.children.some(function (n) { return canonical(n.id) === canonical(path); })) group.children.push({ id: path, name: name });
      } else if (!depth && /\/(?:dm\d+\/)?chinese-subtitle$/.test(path)) roots.push({ id: path, name: name, children: [] });
    }
  }
  return roots;
}

function withPage(path, page) {
  const parts = path.split('?');
  const query = (parts[1] || '').split('&').filter(function (q) { return q && !/^page=/.test(q); });
  if (page > 1) query.push('page=' + page);
  return SITE + parts[0] + (query.length ? '?' + query.join('&') : '');
}

function help(list) {
  // 影视仓 3.3.1 按首项是否 folder 选择布局，普通操作卡片保留三列网格。
  if (list.length) list.unshift({ vod_id: 'directory:help', vod_name: SITE, vod_pic: '', vod_remarks: '分类目录', action: 'directory:help' });
  return list;
}
function folder(id, name, pic, remarks) {
  return { vod_id: id, vod_name: name, vod_pic: pic || '', vod_remarks: remarks || '子分类', vod_tag: 'folder' };
}
function localPage(list, page) {
  help(list);
  return { list: list.slice((page - 1) * 30, page * 30), page: page, pagecount: Math.max(1, Math.ceil(list.length / 30)), limit: 30, total: list.length };
}

function cards(html) {
  const scope = content(html);
  const list = [];
  const seen = Object.create(null);
  // thumbnail 自身包含图片、时长和标题，用边界栈保留嵌套 div。
  const re = /<div\b[^>]*>/gi;
  let m;
  while ((m = re.exec(scope))) {
    if (!hasClass(m[0], 'thumbnail')) continue;
    const card = block(scope.slice(m.index), 'div', 'thumbnail');
    re.lastIndex = m.index + (card.length || m[0].length);
    const title = block(card, 'div', 'truncate');
    const link = anchors(title)[0];
    const path = link && sitePath(attrs(opening(link)).href);
    const name = link && text(link);
    if (!path || !name || seen[path]) continue;
    seen[path] = true;
    const duration = text(card).match(/\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b/);
    list.push({ vod_id: SITE + path, vod_name: name, vod_pic: image(card), vod_remarks: duration ? duration[0] : '' });
  }
  return list;
}

function directory(html, kind) {
  const list = [];
  const seen = Object.create(null);
  const scope = content(html);
  const entries = kind === 'actresses' ? scope.match(/<li\b[^>]*>[\s\S]*?<\/li\s*>/gi) || [] : anchors(scope);
  entries.forEach(function (entry) {
    const a = kind === 'actresses' ? anchors(entry)[0] : entry;
    const path = a && sitePath(attrs(opening(a)).href);
    if (!path || !new RegExp('^/(?:dm\\d+/)?' + kind + '/[^/?#]+/?$').test(path)) return;
    const key = canonical(path);
    const name = kind === 'actresses' ? text((entry.match(/<h4\b[^>]*>[\s\S]*?<\/h4>/i) || [''])[0]) : text(entry);
    if (!name || /條影片$/.test(name) || seen[key]) return;
    seen[key] = true;
    list.push(folder(path, name, kind === 'actresses' ? image(entry) : '', kind === 'actresses' ? '演员' : '子分类'));
  });
  return list;
}

function pageResult(html, page, list) {
  let pagecount = page;
  const nav = block(content(html), 'nav', 'mt-6');
  anchors(nav).forEach(function (a) {
    const path = sitePath(attrs(opening(a)).href);
    const n = path.match(/[?&]page=(\d+)/);
    if (n) pagecount = Math.max(pagecount, Number(n[1]));
  });
  const last = text(nav).match(/\/\s*(\d+)/);
  if (last) pagecount = Math.max(pagecount, Number(last[1]));
  if (!list.length) pagecount = page;
  return { list: list, page: page, pagecount: pagecount, limit: list.length };
}

function errorPage(page, error) {
  const message = String(error.message || error);
  return { list: [{ vod_id: 'error:' + message, vod_name: message, vod_pic: '', vod_remarks: '加载失败', action: 'error:' + message }], page: page, pagecount: page, limit: 1 };
}

function meta(html, key) {
  const tags = html.match(/<meta\b[^>]*>/gi) || [];
  for (let i = 0; i < tags.length; i++) {
    const a = attrs(tags[i]);
    if (a.property === key || a.name === key) return a.content || '';
  }
  return '';
}

// 只读取 P.A.C.K.E.R 的字符串参数并作 token 替换，绝不 eval 网页代码。
const STRING = '(?:\'(?:\\\\.|[^\'\\\\])*\'|"(?:\\\\.|[^"\\\\])*")';
function unquote(value) {
  return value.slice(1, -1).replace(/\\(?:u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi, function (all, u, x, c) {
    return u || x ? String.fromCharCode(parseInt(u || x, 16)) : ({ n: '\n', r: '\r', t: '\t' }[c] || c);
  });
}
function streams(html) {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/gi) || [];
  let code = scripts.join('\n');
  const packed = new RegExp('\\}\\(\\s*(' + STRING + ')\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(' + STRING + ')\\.split\\(\'\\|\'\\)', 'g');
  let m;
  while ((m = packed.exec(html))) {
    const radix = Number(m[2]);
    const count = Number(m[3]);
    if (radix < 2 || radix > 62 || count > 10000) continue;
    const words = unquote(m[4]).split('|');
    const dict = Object.create(null);
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (let i = 0; i < count; i++) {
      let n = i;
      let key = '';
      do { key = alphabet[n % radix] + key; n = Math.floor(n / radix); } while (n);
      dict[key] = words[i] || key;
    }
    code += '\n' + unquote(m[1]).replace(/\b[\da-zA-Z]+\b/g, function (key) { return dict[key] || key; });
  }
  const list = [];
  const assignment = new RegExp('\\b(source(?:\\d+)?)\\s*=\\s*(' + STRING + ')', 'g');
  while ((m = assignment.exec(code))) {
    const url = absolute(unquote(m[2]));
    if (/^https:\/\/[^\s]+\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url)) list.push({ name: m[1], url: url });
  }
  const video = block(html, 'video', 'player');
  (video.match(/<source\b[^>]*>/gi) || []).forEach(function (tag) {
    const url = absolute(attrs(tag).src);
    if (/^https:\/\/[^\s]+\.(?:m3u8|mp4)(?:[?#]|$)/i.test(url)) list.push({ name: 'source', url: url });
  });
  return list;
}

export default {
  init(ext) { navigation = null; landingHtml = ''; },

  home(filter) {
    try {
      landingHtml = getHtml(SITE + '/');
      navigation = menu(landingHtml);
      return JSON.stringify({ class: navigation.map(function (node) { return { type_id: node.id, type_name: node.name }; }) });
    } catch (e) {
      navigation = null;
      landingHtml = '';
      return JSON.stringify({ class: [{ type_id: 'status', type_name: '站点状态' }] });
    }
  },

  homeVod() {
    try {
      const html = landingHtml || getHtml(SITE + '/');
      landingHtml = '';
      return JSON.stringify({ list: cards(html) });
    }
    catch (e) { return JSON.stringify(errorPage(1, e)); }
  },

  action(id) {
    if (id === 'directory:help') return JSON.stringify({ toast: SITE });
    if (String(id).indexOf('error:') === 0) return JSON.stringify({ toast: String(id).slice(6) + '；请重新加载分类。Spider 无法自动完成人机验证。' });
    return '{}';
  },

  category(tid, pg, filter, extend) {
    const page = pageNumber(pg);
    try {
      if (String(tid).indexOf('group:') === 0) {
        if (!navigation) navigation = menu(getHtml(SITE + '/'));
        const selected = navigation.filter(function (n) { return n.id === tid; })[0];
        return JSON.stringify(localPage(selected ? selected.children.map(function (n) { return folder(n.id, n.name); }) : [], page));
      }
      if (tid === 'status') {
        const html = getHtml(SITE + '/');
        return JSON.stringify(pageResult(html, page, cards(html)));
      }
      const path = sitePath(tid);
      if (!path) return JSON.stringify(emptyPage(page));
      const kind = path.split('?')[0].match(/^\/(?:dm\d+\/)?(genres|makers|actresses)(?:\/ranking)?\/?$/);
      const local = kind && kind[1] !== 'actresses';
      const html = getHtml(withPage(path, local ? 1 : page));
      if (kind) {
        const list = directory(html, kind[1]);
        if (local) return JSON.stringify(localPage(list, page));
        const result = pageResult(html, page, list);
        if (page === 1) help(result.list);
        return JSON.stringify(result);
      }
      return JSON.stringify(pageResult(html, page, cards(html)));
    } catch (e) { return JSON.stringify(errorPage(page, e)); }
  },

  search(wd, quick, pg) {
    const page = pageNumber(pg);
    const keyword = String(wd || '').trim();
    if (!keyword) return JSON.stringify(emptyPage(page));
    try {
      const html = getHtml(withPage('/search/' + encodeURIComponent(keyword), page));
      return JSON.stringify(pageResult(html, page, cards(html)));
    } catch (e) { return JSON.stringify(errorPage(page, e)); }
  },

  detail(id) {
    const path = sitePath(id);
    if (!path) return JSON.stringify({ list: [] });
    const html = getHtml(SITE + path);
    const title = text((html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/i) || [''])[0]);
    if (!title) return JSON.stringify({ list: [] });
    return JSON.stringify({ list: [{
      vod_id: SITE + path, vod_name: title, vod_pic: absolute(meta(html, 'og:image')),
      vod_content: meta(html, 'description'),
      vod_play_from: 'MissAV', vod_play_url: '播放$' + SITE + path
    }] });
  },

  play(flag, id, vipFlags) {
    const path = sitePath(id);
    if (!path) return JSON.stringify({ parse: 0, url: '' });
    const list = streams(getHtml(SITE + path));
    const selected = list.filter(function (s) { return s.name === 'source'; })[0] || list[0];
    if (!selected) throw new Error('MissAV 未找到可识别的媒体地址');
    return JSON.stringify({ parse: 0, url: selected.url, header: { 'User-Agent': UA, Referer: SITE + path } });
  }
};
