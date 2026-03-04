import { addDays, endOfDay, parseISO } from "date-fns";

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseDueInput(input: string | undefined): string | null {
  if (!input) {
    return null;
  }

  const normalized = input.trim().toLowerCase();
  const now = new Date();

  if (normalized === "today") {
    return endOfDay(now).toISOString();
  }
  if (normalized === "tomorrow") {
    return endOfDay(addDays(now, 1)).toISOString();
  }
  if (normalized === "next week") {
    return endOfDay(addDays(now, 7)).toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return endOfDay(parseISO(normalized)).toISOString();
  }

  const parsed = new Date(input);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return null;
}
