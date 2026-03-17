type ModuleCacheEntry<T> = {
  data: T;
  updatedAt: number;
};

const moduleDataCache = new Map<string, ModuleCacheEntry<unknown>>();

export const MODULE_CACHE_TTL_MS = 2 * 60 * 1000;

export function getModuleCacheEntry<T>(key: string) {
  const entry = moduleDataCache.get(key);
  return (entry as ModuleCacheEntry<T> | undefined) ?? null;
}

export function setModuleCacheEntry<T>(key: string, data: T) {
  const entry: ModuleCacheEntry<T> = {
    data,
    updatedAt: Date.now(),
  };
  moduleDataCache.set(key, entry as ModuleCacheEntry<unknown>);
  return entry;
}

export function isModuleCacheFresh(
  entry: Pick<ModuleCacheEntry<unknown>, 'updatedAt'> | null | undefined,
  ttlMs: number = MODULE_CACHE_TTL_MS,
) {
  if (!entry) {
    return false;
  }
  return Date.now() - entry.updatedAt < ttlMs;
}
