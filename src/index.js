/**
 * Normalize a Vitest snapshot string for stable comparisons across platforms.
 *
 * @param {string} snapshot
 * @returns {string}
 */
export function normalizeSnapshot(snapshot) {
  if (typeof snapshot !== "string") {
    throw new TypeError("snapshot must be a string");
  }

  return `${snapshot.replace(/\r\n?/g, "\n").trimEnd()}\n`;
}
