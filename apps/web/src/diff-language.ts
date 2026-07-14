const JSON_HIGHLIGHT_LIMIT = 250_000;

function isJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

export function inferSnapshotLanguage(
  baseline: string,
  candidate: string,
): "json" | undefined {
  const populatedSides = [baseline, candidate].filter(
    (contents) => contents.trim().length > 0,
  );
  if (
    populatedSides.length === 0 ||
    populatedSides.some((contents) => contents.length > JSON_HIGHLIGHT_LIMIT)
  ) {
    return undefined;
  }
  return populatedSides.every(isJson) ? "json" : undefined;
}
