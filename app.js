function bootLore(host) {
  const shell = globalThis.LocalShell;
  const engine = globalThis.LocalLoreEngine;
  const ui = shell.mount({
    id: 'lore',
    glyph: '⊹',
    label: 'Локальный лор',
    title: 'Лор',
    accent: '#e09a6a',
    bottom: 96,
    right: 16,
  });
  ui.setTitle('на устройстве', 'Лор');
  let report = null;
  let view = 'list';
  let current = null;
  let query = '';
  let selected = null;

  async function loadSelected() {
    selected = await host.loadChat('books');
    if (selected != null && !Array.isArray(selected)) selected = null;
  }

  async function refresh() {
    ui.toast('Смотрю книги…');
    await loadSelected();
    let books = [];
    try { books = await host.lorebooks(); } catch (e) { books = []; }
    const messages = await host.messages();
    const cardText = await host.cardText();
    const depth = typeof host.loreDepth === 'function' ? host.loreDepth() : 4;
    report = engine.scanLore(books, messages, {
      depth,
      selectedIds: selected && selected.length ? selected : null,
      cardText,
    });
    const prev = (await host.loadChat('fired')) || [];
    const now = report.rows.filter((r) => r.fired && !r.dropped).map((r) => r.bookId + ':' + r.uid);
    const prevSet = {};
    prev.forEach((id) => { prevSet[id] = 1; });
    report.rows.forEach((r) => { r.isNew = !!(r.fired && !r.dropped && !prevSet[r.bookId + ':' + r.uid]); });
    report.diff = {
      added: now.filter((id) => !prevSet[id]).length,
      gone: prev.filter((id) => now.indexOf(id) === -1).length,
    };
    await host.saveChat('fired', now);
    ui.toast('');
    render();
  }

  function groups(rows) {
    const g = { constant: [], key: [], vector: [], near: [], miss: [], off: [] };
    rows.forEach((r) => {
      if (r.type === 'off') g.off.push(r);
      else if (r.type === 'vector') g.vector.push(r);
      else if (r.fired && !r.dropped && r.type === 'constant') g.constant.push(r);
      else if (r.fired && !r.dropped) g.key.push(r);
      else if (r.near) g.near.push(r);
      else g.miss.push(r);
    });
    return g;
  }

  function rowHtml(r) {
    const esc = shell.esc;
    const dim = !r.fired || r.dropped;
    return '<button type="button" class="lx-card" data-act="open" data-id="' + esc(r.bookId + ':' + r.uid) + '" style="text-align:left;width:100%;' + (dim ? 'opacity:.62' : '') + '">' +
      '<div class="lx-row"><strong class="lx-grow">' + (r.isNew ? 'новое · ' : '') + esc(r.title) + '</strong><span class="lx-muted">≈' + r.tokens + '</span></div>' +
      '<div class="lx-muted">' + esc(r.book) + ' · ' + esc(r.reason) + '</div>' +
      (r.fired && !r.dropped ? '<div class="lx-bar" style="margin-top:6px"><span style="width:' + Math.round((r.strength || (r.type === 'constant' ? 1 : 0)) * 100) + '%"></span></div>' : '') +
      '</button>';
  }

  function section(title, rows) {
    if (!rows.length) return '';
    return '<div class="lx-muted">' + shell.esc(title) + ' · ' + rows.length + '</div>' + rows.map(rowHtml).join('');
  }

  function renderList() {
    ui.setBack(null);
    ui.setTitle('на устройстве', 'Лор');
    if (!report) {
      ui.body.innerHTML = '<div class="lx-empty">Открой чат и нажми «Обновить».</div>';
      return;
    }
    const esc = shell.esc;
    let rows = report.rows.slice();
    if (query) {
      const q = query.toLowerCase();
      rows = rows.filter((r) => (r.title + ' ' + r.reason + ' ' + r.book + ' ' + r.keys.join(' ')).toLowerCase().indexOf(q) !== -1);
    }
    const g = groups(rows);
    const diff = report.diff && (report.diff.added || report.diff.gone)
      ? (' · +' + report.diff.added + ' −' + report.diff.gone) : '';
    ui.body.innerHTML =
      '<div class="lx-row"><button type="button" class="lx-btn primary" data-act="refresh">Обновить</button>' +
      '<button type="button" class="lx-btn" data-act="books">Книги</button>' +
      '<button type="button" class="lx-btn" data-act="copy">Отчёт</button></div>' +
      '<div class="lx-muted">Активно ' + report.activeCount + ' из ' + report.rows.length + ' · ≈' + report.tokens + ' ток.' + diff + ' · глубина ' + report.depth + '</div>' +
      '<label class="lx-field">Поиск<input id="lx-lore-q" value="' + esc(query) + '" placeholder="имя или ключ"></label>' +
      '<div class="lx-list">' +
        section('Постоянные', g.constant) +
        section('Сработало по ключу', g.key) +
        section('По смыслу — заранее не видно', g.vector) +
        section('Почти', g.near) +
        section('Молчат', g.miss) +
        section('Выключено', g.off) +
      '</div>' +
      (report.rows.length ? '' : '<div class="lx-empty">Книг нет. Привяжи лорбук к чату или выбери его в «Книгах».</div>');
    const qel = ui.body.querySelector('#lx-lore-q');
    if (qel) qel.addEventListener('input', () => { query = qel.value; renderList(); const again = ui.body.querySelector('#lx-lore-q'); if (again) { again.focus(); again.setSelectionRange(query.length, query.length); } });
  }

  function renderBooks() {
    ui.setBack(() => { view = 'list'; render(); });
    ui.setTitle('какие учитывать', 'Книги');
    const books = (report && report.books) || [];
    const esc = shell.esc;
    ui.body.innerHTML = '<div class="lx-muted">Пустой выбор значит «все найденные». Отметь книги, если хочешь сузить чат.</div>' +
      '<div class="lx-list">' + books.map((b) => {
        const on = !selected || !selected.length || selected.indexOf(String(b.id)) !== -1;
        return '<button type="button" class="lx-card" data-act="toggle" data-id="' + esc(b.id) + '" style="text-align:left;width:100%">' +
          '<strong>' + (on ? '✓ ' : '○ ') + esc(b.name) + '</strong><div class="lx-muted">' + b.count + ' записей</div></button>';
      }).join('') + '</div>' +
      (books.length ? '' : '<div class="lx-empty">Клиент не отдал ни одной книги.</div>') +
      '<button type="button" class="lx-btn" data-act="all">Считать все</button>';
  }

  function renderDetail() {
    const row = current;
    ui.setBack(() => { view = 'list'; render(); });
    ui.setTitle(row.book, row.title);
    const esc = shell.esc;
    ui.body.innerHTML =
      '<div class="lx-muted">' + esc(row.reason) + '</div>' +
      '<div>≈ ' + row.tokens + ' ток. · шанс ' + row.probability + '%</div>' +
      '<div class="lx-muted">Ключи</div><div>' + (row.keys.length ? row.keys.map((k) => '<span class="lx-chip">' + esc(k) + '</span>').join(' ') : '—') + '</div>' +
      (row.keysSec.length ? '<div class="lx-muted">Вторичные</div><div>' + row.keysSec.map((k) => '<span class="lx-chip">' + esc(k) + '</span>').join(' ') + '</div>' : '') +
      (row.snippets.length ? '<div class="lx-muted">Где совпало</div>' + row.snippets.map((s) => '<div class="lx-card">' + esc(s.pre) + '<b>' + esc(s.hit) + '</b>' + esc(s.post) + '</div>').join('') : '') +
      '<div class="lx-muted">Текст записи</div><div class="lx-card" style="white-space:pre-wrap">' + esc(row.content || '—') + '</div>';
  }

  function render() {
    if (view === 'books') return renderBooks();
    if (view === 'detail' && current) return renderDetail();
    return renderList();
  }

  function reportText() {
    if (!report) return '';
    const lines = ['Локальный лор', 'Активно ' + report.activeCount + ' · ≈' + report.tokens + ' ток.', ''];
    report.rows.filter((r) => r.fired && !r.dropped).forEach((r) => {
      lines.push('• ' + r.title + ' (' + r.book + ') — ' + r.reason + ' — ≈' + r.tokens);
    });
    return lines.join('\n');
  }

  ui.body.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.getAttribute('data-act');
    if (act === 'refresh') { await refresh(); return; }
    if (act === 'books') { view = 'books'; render(); return; }
    if (act === 'copy') {
      const text = reportText();
      try { await navigator.clipboard.writeText(text); ui.toast('Отчёт скопирован'); }
      catch (err) { ui.toast('Скопируй вручную'); }
      return;
    }
    if (act === 'all') { selected = []; await host.saveChat('books', []); await refresh(); return; }
    if (act === 'toggle') {
      const id = el.getAttribute('data-id');
      const all = (report.books || []).map((b) => String(b.id));
      let cur = selected && selected.length ? selected.slice() : all.slice();
      if (cur.indexOf(id) === -1) cur.push(id);
      else cur = cur.filter((x) => x !== id);
      selected = cur.length === all.length ? [] : cur;
      await host.saveChat('books', selected);
      await refresh();
      view = 'books';
      render();
      return;
    }
    if (act === 'open') {
      const id = el.getAttribute('data-id');
      current = report.rows.find((r) => (r.bookId + ':' + r.uid) === id) || null;
      if (current) { view = 'detail'; render(); }
    }
  });

  host.on('chat', () => { report = null; view = 'list'; if (!ui.body.closest('section').hidden) refresh(); });
  host.on('message', () => { if (!ui.body.closest('section').hidden) refresh(); });
  const open = () => { ui.open(); refresh(); };
  host.addMenu('Локальный лор', open);
  shell.listen(shell.win(), 'open-lore', 'local-lore-open', open);
  return { open, close: () => ui.close() };
}

const LocalLoreApp = { boot: bootLore };
globalThis.LocalLoreApp = LocalLoreApp;
export { LocalLoreApp };
