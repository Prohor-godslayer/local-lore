import './shell.js';
import './engine.js';
import './app.js';
import { createSillyHost } from './st-host.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { loadWorldInfo } from '../../../world-info.js';

const host = createSillyHost('lore');

function pushName(list, name) {
  if (typeof name === 'string' && name.trim()) list.push(name.trim());
}

host.loreDepth = function loreDepth() {
  const wi = extension_settings.world_info || {};
  const n = Number(wi.world_info_depth ?? wi.depth);
  return Number.isFinite(n) && n > 0 ? n : 4;
};

host.lorebooks = async function lorebooks() {
  const ctx = getContext();
  const names = [];
  const meta = ctx.chatMetadata || {};
  pushName(names, meta.world_info);
  if (Array.isArray(meta.world_info)) meta.world_info.forEach((n) => pushName(names, n));
  const ch = ctx.characters && ctx.characters[ctx.characterId];
  if (ch && ch.data && ch.data.extensions) pushName(names, ch.data.extensions.world);
  const wi = extension_settings.world_info || {};
  [wi.globalSelect, wi.world_info && wi.world_info.globalSelect, wi.selectedWorlds].forEach((bucket) => {
    if (Array.isArray(bucket)) bucket.forEach((n) => pushName(names, n));
  });
  const books = [];
  const embedded = ch && ch.data && ch.data.character_book;
  if (embedded && Array.isArray(embedded.entries)) {
    books.push({ id: 'embedded', name: 'Книга в карточке', entries: embedded.entries });
  }
  const seen = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (seen[name]) continue;
    seen[name] = 1;
    try {
      const data = await loadWorldInfo(name);
      if (!data) continue;
      const entries = Array.isArray(data.entries) ? data.entries : Object.values(data.entries || {});
      books.push({ id: name, name, entries });
    } catch (e) { /* книга недоступна — пропускаем */ }
  }
  return books;
};

globalThis.LocalLoreApp.boot(host);
