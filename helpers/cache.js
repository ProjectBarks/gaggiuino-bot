import NodeCache from 'node-cache';
export const Cache = new NodeCache();

export const CacheKeys = Object.freeze({
  BRANCHES: 'BRANCHES',
});
