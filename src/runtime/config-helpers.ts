export function readRequiredString(...values: Array<unknown>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

export function readOptionalString(...values: Array<unknown>): string | undefined {
  const value = readRequiredString(...values);
  return value || undefined;
}

export function readBoolean(...values: Array<unknown>): boolean {
  for (const value of values) {
    if (typeof value === "boolean") {
      return value;
    }
  }

  return false;
}

export function readNumber(...values: Array<unknown>): number {
  const fallbackValue = values[values.length - 1];
  const candidates = values.slice(0, -1);

  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return typeof fallbackValue === "number" ? fallbackValue : 0;
}

export function readStringArray(...values: Array<unknown>): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) {
      continue;
    }

    return value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  return [];
}
