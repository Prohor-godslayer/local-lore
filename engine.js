// Сканер лорбуков. Предсказывает, какие записи попадут в ответ:
// по ключу, из какого сообщения и сколько токенов займут.
// Векторный поиск не воспроизводится — такие записи помечаются отдельно.

function loreTokens(text) {
  const s = String(text || '');
  let lat = 0; let cyr = 0; let cjk = 0; let oth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) lat++;
    else if (c >= 0x0400 && c <= 0x04FF) cyr++;
    else if (c >= 0x3040 && c <= 0x9FFF) cjk++;
    else oth++;
  }
  return Math.ceil(lat / 4.3 + cyr / 2.4 + cjk / 1.2 + oth / 3.2);
}

function asKeys(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 256).map((x) => x.slice(0, 512));
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeEntry(raw, book) {
  const content = String(raw.content || raw.comment || '').slice(0, 100000);
  const strat = String(raw.strategy || '').toLowerCase();
  const sec = asKeys(raw.secondaryKeywords || raw.keysecondary || raw.keysSec);
  const logicMap = { and_any: 0, not_all: 1, not_any: 2, and_all: 3 };
  const lgs = String(raw.secondaryKeywordStrategy || '').toLowerCase();
  const whole = raw.matchWholeWord != null ? !!raw.matchWholeWord
    : (raw.matchWholeWords != null ? !!raw.matchWholeWords : false);
  return {
    uid: String(raw.uid != null ? raw.uid : (raw.identifier != null ? raw.identifier : (raw.id != null ? raw.id : ''))),
    bookId: String(book.id),
    book: String(book.name || 'Книга'),
    title: String(raw.comment || raw.name || raw.title || '(без имени)').slice(0, 200),
    content,
    tokens: num(raw.tokens, 0) > 0 ? num(raw.tokens, 0) : loreTokens(content),
    keys: asKeys(raw.key || raw.keys || raw.keywords),
    keysSec: sec,
    constant: strat === 'constant' || !!raw.constant,
    selective: (lgs && lgs !== 'none' && sec.length > 0) || !!raw.selective,
    logic: logicMap[lgs] != null ? logicMap[lgs] : num(raw.selectiveLogic, 0),
    disabled: raw.enabled === false || !!(raw.disable || raw.disabled),
    caseSensitive: !!raw.caseSensitive,
    wholeWords: whole,
    scanDepth: raw.scanDepth == null ? null : num(raw.scanDepth, null),
    order: num(raw.order, 100),
    group: String(raw.group || '').trim(),
    groupWeight: num(raw.groupWeight, 100),
    probability: num(raw.probability, 100),
    vectorized: !!raw.vectorized,
    forced: /^\s*@@activate\b/m.test(content),
    suppressed: /^\s*@@dont_activate\b/m.test(content),
  };
}

function isRegexKey(key) {
  return key.length > 2 && key[0] === '/' && key.lastIndexOf('/') > 0;
}

function compileKey(key) {
  if (!isRegexKey(key)) return null;
  const cut = key.lastIndexOf('/');
  const body = key.slice(1, cut);
  const flags = key.slice(cut + 1).replace(/[^gimsuy]/g, '');
  if (/(\([^)]*[+*]\)[+*])|(\.\*\)\+)/.test(body)) return null;
  try { return new RegExp(body, flags); } catch (e) { return null; }
}

function wordChar(ch) {
  if (!ch) return false;
  try { return /[\p{L}\p{N}]/u.test(ch); } catch (e) { return /[0-9A-Za-zА-Яа-яЁё]/.test(ch); }
}

function tailOk(buf, idx, len) {
  let t = 0;
  while (t < 6 && wordChar(buf[idx + len + t])) t++;
  return t <= 3;
}

function scanKey(key, buf, caseSensitive, wholeWords) {
  if (!key || !buf) return 0;
  if (isRegexKey(key)) {
    const re = compileKey(key);
    if (!re) return 0;
    const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
    const rg = new RegExp(re.source, flags);
    let m;
    let best = 0;
    while ((m = rg.exec(buf))) {
      if (!m[0]) { rg.lastIndex++; continue; }
      if (wholeWords && !tailOk(buf, m.index, m[0].length)) continue;
      if (!wordChar(buf[m.index - 1])) return 1;
      best = 2;
    }
    return best;
  }
  const hay = caseSensitive ? buf : buf.toLowerCase();
  const n = caseSensitive ? key : key.toLowerCase();
  if (!wholeWords) return hay.indexOf(n) === -1 ? 0 : 1;
  let i = -1;
  let best = 0;
  while ((i = hay.indexOf(n, i + 1)) !== -1) {
    if (!tailOk(hay, i, n.length)) continue;
    if (!wordChar(hay[i - 1])) return 1;
    best = 2;
  }
  return best;
}

function hitsOf(keys, buf, cs, ww) {
  const out = [];
  keys.forEach((k) => {
    const kind = scanKey(k, buf, cs, ww);
    if (kind > 0) out.push({ key: k, clean: kind === 1 });
  });
  return out;
}

function selectivePass(logic, primary, secondary, secHits) {
  if (!primary) return false;
  if (!secondary.length) return true;
  const any = secHits.length > 0;
  const all = secHits.length === secondary.length;
  if (logic === 3) return all;
  if (logic === 2) return !any;
  if (logic === 1) return !all;
  return any;
}

function bufferFor(messages, depth, cardText) {
  const d = depth > 0 ? depth : 4;
  const slice = messages.slice(-d).map((m) => m.text || '');
  if (cardText) slice.unshift(String(cardText).slice(0, 4000));
  return slice.join('\n');
}

function sourceOf(entry, messages, depth) {
  const d = entry.scanDepth > 0 ? entry.scanDepth : depth;
  const slice = messages.slice(-d);
  for (let i = slice.length - 1; i >= 0; i--) {
    const text = slice[i].text || '';
    for (let j = 0; j < entry.keys.length; j++) {
      if (scanKey(entry.keys[j], text, entry.caseSensitive, entry.wholeWords) > 0) {
        return {
          role: slice[i].role,
          name: slice[i].name || '',
          back: slice.length - 1 - i,
          key: entry.keys[j],
        };
      }
    }
  }
  return null;
}

function snippets(buf, entry) {
  const found = [];
  const keys = entry.keys.concat(entry.keysSec);
  keys.forEach((key) => {
    const hay = entry.caseSensitive ? buf : buf.toLowerCase();
    const n = isRegexKey(key) ? null : (entry.caseSensitive ? key : key.toLowerCase());
    if (n) {
      const i = hay.indexOf(n);
      if (i === -1) return;
      const s = Math.max(0, i - 42);
      const t = Math.min(buf.length, i + n.length + 42);
      found.push({
        pre: (s > 0 ? '…' : '') + buf.slice(s, i),
        hit: buf.slice(i, i + n.length),
        post: buf.slice(i + n.length, t) + (t < buf.length ? '…' : ''),
      });
    }
  });
  return found.slice(0, 3);
}

function classify(entry, buf) {
  if (entry.disabled) return { type: 'off', fired: false, reason: 'выключена' };
  if (entry.suppressed) return { type: 'off', fired: false, reason: '@@dont_activate' };
  if (entry.forced) return { type: 'forced', fired: true, reason: '@@activate' };
  if (entry.constant) return { type: 'constant', fired: true, reason: 'постоянная' };
  if (entry.vectorized) return { type: 'vector', fired: false, reason: 'по смыслу, ключи не решают' };
  if (!entry.keys.length) return { type: 'miss', fired: false, reason: 'ключей нет' };
  const pri = hitsOf(entry.keys, buf, entry.caseSensitive, entry.wholeWords);
  const sec = entry.keysSec.length ? hitsOf(entry.keysSec, buf, entry.caseSensitive, entry.wholeWords) : [];
  const fired = entry.selective
    ? selectivePass(entry.logic, pri.length > 0, entry.keysSec, sec)
    : pri.length > 0;
  const near = !fired && pri.length > 0 && entry.selective && entry.keysSec.length > 0;
  const shown = pri.slice(0, 3).map((h) => h.key).join(', ');
  let reason = fired ? ('ключ: ' + shown) : (near ? 'ключ есть, логика не пустила' : 'нет совпадений');
  if (fired && entry.probability < 100) reason += ' · шанс ' + entry.probability + '%';
  const partial = pri.some((h) => !h.clean);
  if (fired && partial && entry.wholeWords) reason += ' · кусок слова';
  return {
    type: fired ? 'key' : (near ? 'near' : 'miss'),
    fired,
    near,
    reason,
    keysHit: pri.map((h) => h.key),
    strength: entry.keys.length ? pri.length / entry.keys.length : 0,
  };
}

function scanLore(books, messages, opts) {
  const depth = (opts && opts.depth > 0) ? opts.depth : 4;
  const selected = opts && Array.isArray(opts.selectedIds) ? opts.selectedIds.map(String) : null;
  const cardText = (opts && opts.cardText) || '';
  const msgs = Array.isArray(messages) ? messages : [];
  const list = [];
  (books || []).forEach((book) => {
    if (selected && selected.length && selected.indexOf(String(book.id)) === -1) return;
    (book.entries || []).forEach((raw) => {
      list.push(normalizeEntry(raw, book));
    });
  });
  const cache = {};
  function buf(d) {
    const n = d > 0 ? d : depth;
    if (!cache[n]) cache[n] = bufferFor(msgs, n, cardText);
    return cache[n];
  }
  const rows = list.map((entry) => {
    const b = buf(entry.scanDepth);
    const c = classify(entry, b);
    const src = c.fired && c.type === 'key' ? sourceOf(entry, msgs, depth) : null;
    let reason = c.reason;
    if (src) {
      const who = src.role === 'user' ? 'из твоего сообщения' : 'из ответа персонажа';
      reason += ' · ' + who + (src.back === 0 ? ' (последнее)' : (' (−' + src.back + ')'));
    }
    return {
      uid: entry.uid,
      bookId: entry.bookId,
      book: entry.book,
      title: entry.title,
      content: entry.content,
      tokens: entry.tokens,
      keys: entry.keys,
      keysSec: entry.keysSec,
      order: entry.order,
      group: entry.group,
      probability: entry.probability,
      type: c.type,
      fired: c.fired,
      near: !!c.near,
      reason,
      strength: c.strength || 0,
      snippets: c.fired ? snippets(b, entry) : [],
      dropped: false,
    };
  });
  const groups = {};
  rows.forEach((row, ix) => {
    if (row.fired && row.group) (groups[row.group] = groups[row.group] || []).push(ix);
  });
  Object.keys(groups).forEach((g) => {
    const arr = groups[g];
    if (arr.length < 2) return;
    arr.sort((a, b) => (list[b].groupWeight - list[a].groupWeight) || (list[a].order - list[b].order));
    arr.slice(1).forEach((ix) => {
      rows[ix].dropped = true;
      rows[ix].reason += ' · вытеснена группой «' + g + '»';
    });
  });
  const active = rows.filter((r) => r.fired && !r.dropped);
  return {
    rows,
    depth,
    activeCount: active.length,
    tokens: active.reduce((s, r) => s + r.tokens, 0),
    books: (books || []).map((b) => ({ id: String(b.id), name: b.name, count: (b.entries || []).length })),
  };
}

const LocalLoreEngine = { scanLore, loreTokens, normalizeEntry };
globalThis.LocalLoreEngine = LocalLoreEngine;
export { LocalLoreEngine };
