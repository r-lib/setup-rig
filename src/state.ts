/** Names of the values the main step passes to the post step. */
export const STATE = {
  rigPath: "rig-path",
  enabled: "cache-enabled",
  saveMode: "save-cache",
  prune: "prune-cache",
  cacheDir: "cache-dir",
  key: "cache-key",
  matchedKey: "cache-matched-key",
  restoredInfo: "cache-restored-info",
} as const;
