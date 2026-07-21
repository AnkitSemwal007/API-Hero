/**
 * `api-hero.collection.json` schema helpers (parse / serialize / order maps).
 * Shared by discovery (read) and mutation (write). No VS Code imports.
 */

/** Marker key for collection-root sibling lists (`folderOrder` / `requestOrder`). */
export const MARKER_ROOT_ORDER_KEY = '.';

/**
 * Parsed fields from `api-hero.collection.json` (unknown keys ignored).
 *
 * Sibling order uses name arrays (folder directory names / `.api` basenames).
 * `folderOrder` may be a root-only array or a map keyed by parent relative path
 * (`.` = collection root). `requestOrder` is always a map with the same keys.
 * Numeric `order` sorts collections among siblings under `Collections/`.
 */
export interface CollectionMarkerDocument {
  readonly name?: string;
  readonly description?: string;
  /** Collection sibling order among `Collections/*` (lower first). */
  readonly order?: number;
  /**
   * Folder sibling order. Array form applies to the collection root only;
   * record form keys are parent relative paths (`.` = root).
   */
  readonly folderOrder?: readonly string[] | Readonly<Record<string, readonly string[]>>;
  /** Request file sibling order keyed by parent folder relative path (`.` = root). */
  readonly requestOrder?: Readonly<Record<string, readonly string[]>>;
}

/** Mutable marker used while applying filesystem mutations. */
export interface MutableCollectionMarker {
  name?: string;
  description?: string;
  order?: number;
  folderOrder?: string[] | Record<string, string[]>;
  requestOrder?: Record<string, string[]>;
}

/** Parses collection marker JSON; returns undefined when shape is invalid. */
export function parseCollectionMarker(
  text: string,
): CollectionMarkerDocument | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const name =
    typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name.trim()
      : undefined;
  const description =
    typeof record.description === 'string' ? record.description : undefined;
  const order =
    typeof record.order === 'number' && Number.isFinite(record.order)
      ? record.order
      : undefined;
  const folderOrder = parseFolderOrder(record.folderOrder);
  const requestOrder = parseRequestOrder(record.requestOrder);
  return {
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(folderOrder !== undefined ? { folderOrder } : {}),
    ...(requestOrder !== undefined ? { requestOrder } : {}),
  };
}

/** Serializes a marker document with stable pretty-print formatting. */
export function serializeCollectionMarker(
  document: CollectionMarkerDocument | MutableCollectionMarker,
): string {
  const payload: Record<string, unknown> = {};
  if (typeof document.name === 'string') {
    payload.name = document.name;
  }
  if (typeof document.description === 'string') {
    payload.description = document.description;
  }
  if (typeof document.order === 'number' && Number.isFinite(document.order)) {
    payload.order = document.order;
  }
  if (document.folderOrder !== undefined) {
    payload.folderOrder = compactFolderOrder(document.folderOrder);
  }
  if (document.requestOrder !== undefined) {
    const compact = compactOrderRecord(document.requestOrder);
    if (Object.keys(compact).length > 0) {
      payload.requestOrder = compact;
    }
  }
  return `${JSON.stringify(payload, undefined, 2)}\n`;
}

/** Normalizes folder/request order inputs to a parent-path → names map. */
export function normalizeOrderMap(
  value:
    | readonly string[]
    | Readonly<Record<string, readonly string[]>>
    | undefined,
): Record<string, string[]> {
  if (value === undefined) {
    return {};
  }
  if (Array.isArray(value)) {
    return {
      [MARKER_ROOT_ORDER_KEY]: value.map(String).filter((name) => name.length > 0),
    };
  }
  const result: Record<string, string[]> = {};
  for (const [key, names] of Object.entries(value)) {
    if (!Array.isArray(names)) {
      continue;
    }
    const normalizedKey = normalizeOrderKey(key);
    result[normalizedKey] = names.map(String).filter((name) => name.length > 0);
  }
  return result;
}

/** Normalizes a folder-order parent key (`.` for collection root). */
export function normalizeOrderKey(relativePath: string): string {
  const trimmed = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return trimmed.length === 0 ? MARKER_ROOT_ORDER_KEY : trimmed;
}

/**
 * Orders ids by an optional name list, then locale-sorts the remainder.
 * Names that do not match any id are ignored.
 */
export function orderIdsByNames(
  ids: readonly string[],
  nameForId: (id: string) => string,
  orderedNames: readonly string[] | undefined,
): string[] {
  if (orderedNames === undefined || orderedNames.length === 0) {
    return [...ids].sort((left, right) =>
      nameForId(left).localeCompare(nameForId(right)),
    );
  }

  const byName = new Map<string, string>();
  for (const id of ids) {
    const name = nameForId(id);
    if (!byName.has(name)) {
      byName.set(name, id);
    }
  }

  const result: string[] = [];
  const used = new Set<string>();
  for (const name of orderedNames) {
    const id = byName.get(name);
    if (id !== undefined && !used.has(id)) {
      result.push(id);
      used.add(id);
    }
  }

  const rest = ids
    .filter((id) => !used.has(id))
    .sort((left, right) => nameForId(left).localeCompare(nameForId(right)));
  return [...result, ...rest];
}

/** Inserts `name` into an order list (append when missing). */
export function upsertOrderName(
  names: readonly string[] | undefined,
  name: string,
  position?: number,
): string[] {
  const next = (names ?? []).filter((entry) => entry !== name);
  if (position === undefined || position < 0 || position >= next.length) {
    next.push(name);
  } else {
    next.splice(position, 0, name);
  }
  return next;
}

/** Removes a name from an order list. */
export function removeOrderName(
  names: readonly string[] | undefined,
  name: string,
): string[] {
  return (names ?? []).filter((entry) => entry !== name);
}

/** Renames an entry inside an order list (no-op when absent). */
export function renameOrderName(
  names: readonly string[] | undefined,
  oldName: string,
  newName: string,
): string[] {
  return (names ?? []).map((entry) => (entry === oldName ? newName : entry));
}

/**
 * Reorders `names` so they match `orderedNames` first, then any leftovers
 * in their previous relative order.
 */
export function applyExplicitOrder(
  existing: readonly string[],
  orderedNames: readonly string[],
): string[] {
  const existingSet = new Set(existing);
  const result: string[] = [];
  const used = new Set<string>();
  for (const name of orderedNames) {
    if (existingSet.has(name) && !used.has(name)) {
      result.push(name);
      used.add(name);
    }
  }
  for (const name of existing) {
    if (!used.has(name)) {
      result.push(name);
    }
  }
  return result;
}

function parseFolderOrder(
  value: unknown,
): CollectionMarkerDocument['folderOrder'] | undefined {
  if (Array.isArray(value)) {
    const names = value.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
    return names.length > 0 ? names : undefined;
  }
  const record = parseRequestOrder(value);
  return record;
}

function parseRequestOrder(
  value: unknown,
): Readonly<Record<string, readonly string[]>> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, string[]> = {};
  for (const [key, names] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(names)) {
      continue;
    }
    const filtered = names.filter(
      (entry): entry is string => typeof entry === 'string' && entry.length > 0,
    );
    if (filtered.length > 0) {
      result[normalizeOrderKey(key)] = filtered;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function compactFolderOrder(
  value: readonly string[] | Readonly<Record<string, readonly string[]>>,
): string[] | Record<string, string[]> {
  if (Array.isArray(value)) {
    return [...value];
  }
  const record = compactOrderRecord(
    value as Readonly<Record<string, readonly string[]>>,
  );
  const keys = Object.keys(record);
  if (keys.length === 1 && keys[0] === MARKER_ROOT_ORDER_KEY) {
    return record[MARKER_ROOT_ORDER_KEY] ?? [];
  }
  return record;
}

function compactOrderRecord(
  value: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, names] of Object.entries(value)) {
    if (names.length === 0) {
      continue;
    }
    result[normalizeOrderKey(key)] = [...names];
  }
  return result;
}
