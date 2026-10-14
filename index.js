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

function addNames(list, bucket) {
  if (typeof bucket === 'string') pushName(list, bucket);
  else if (Array.isArray(bucket)) {
    bucket.forEach((item) => pushName(list, typeof item === 'string' ? item : (item && (item.name || item.id))));
  }
}

function entryList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') return Object.values(raw);
  return [];
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
  addNames(names, meta.world_info);
  const ch = ctx.characters && ctx.characters[ctx.characterId];
  if (ch && ch.data && ch.data.extensions) addNames(names, ch.data.extensions.world);
  const wi = extension_settings.world_info || {};
  addNames(names, wi.globalSelect);
  addNames(names, wi.selectedWorlds);
  const books = [];
  const embedded = (ch && ch.data && ch.data.character_book) || (ch && ch.character_book);
  const embeddedEntries = entryList(embedded && embedded.entries);
  if (embeddedEntries.length) {
    books.push({ id: 'embedded', name: 'Книга в карточке', entries: embeddedEntries });
  }
  const seen = {};
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    if (seen[name]) continue;
    seen[name] = 1;
    try {
      const data = await loadWorldInfo(name);
      if (!data) continue;
      const entries = entryList(data.entries);
      books.push({ id: name, name, entries });
    } catch (e) { /* книга недоступна — пропускаем */ }
  }
  return books;
};

globalThis.LocalLoreApp.boot(host);
