// watch-view.js — Follow buttons and the profile's watchlist. account.js
// hands over the member's store (watchlist_items, migration 0017) when
// watchlists are switched on; until then every button is left out.
import { WATCH_LIMIT, addProblem, countLine, itemKey, itemLabel } from './watch.js';

let store = null;
let items = [];
const listeners = new Set();

/** Called by account.js with { list, add, remove } once the feed is in, or null to switch it off. */
export async function setWatchStore(next) {
  store = next;
  items = [];
  if (store) {
    try {
      items = await store.list();
    } catch (error) {
      console.error(error);
      store = null;
    }
  }
  changed();
}

export function watchOn() {
  return Boolean(store);
}

export function watchItems() {
  return items;
}

export function onWatchChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed() {
  for (const listener of listeners) listener(items);
}

function find(item) {
  return items.find((i) => itemKey(i) === itemKey(item));
}

export async function follow(item) {
  if (!store) return 'Sign in to follow.';
  if (find(item)) return null;
  if (items.length >= WATCH_LIMIT) return addProblem('up to 25 items');
  try {
    items = [...items, await store.add(item)];
  } catch (error) {
    return addProblem(error instanceof Error ? error.message : String(error));
  }
  changed();
  return null;
}

export async function unfollow(item) {
  const found = find(item);
  if (!store || !found) return null;
  try {
    await store.remove(found.id);
  } catch (error) {
    return `Couldn't remove it: ${error instanceof Error ? error.message : error}`;
  }
  items = items.filter((i) => i !== found);
  changed();
  return null;
}

/** A Follow / Following toggle for one item, or null while watchlists are off. */
export function followButton(item, label = 'Follow') {
  if (!store) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chip follow';
  const status = document.createElement('span');
  status.className = 'follow-status';
  status.setAttribute('aria-live', 'polite');
  const wrap = document.createElement('span');
  wrap.className = 'follow-wrap';
  wrap.append(button, status);
  const draw = () => {
    const on = Boolean(find(item));
    button.textContent = on ? 'Following' : label;
    button.setAttribute('aria-pressed', String(on));
  };
  button.addEventListener('click', async () => {
    button.disabled = true;
    const problem = find(item) ? await unfollow(item) : await follow(item);
    button.disabled = false;
    status.textContent = problem ?? '';
    draw();
  });
  const stop = onWatchChange(() => (wrap.isConnected ? draw() : stop()));
  draw();
  return wrap;
}

/** The profile's list: each item with a Remove button, and the count. */
export function drawWatchList(list, count, metricLabel) {
  count.textContent = countLine(items.length);
  list.replaceChildren(
    ...items.map((item) => {
      const li = document.createElement('li');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'link';
      remove.textContent = 'Remove';
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        const problem = await unfollow(item);
        if (problem) {
          remove.disabled = false;
          count.textContent = problem;
        }
      });
      li.append(itemLabel(item, metricLabel), ' ', remove);
      return li;
    })
  );
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = 'Nothing followed yet.';
    list.append(li);
  }
}
