import changelogRaw from "../../CHANGELOG.md?raw";

export interface ChangelogEntry {
  version: string;
  date: string;
  items: string[];
}

export function parseChangelog(raw: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const versionRegex = /^## \[(.+?)\] - (\d{4}-\d{2}-\d{2})/;

  let current: ChangelogEntry | null = null;

  for (const line of raw.split("\n")) {
    const match = line.match(versionRegex);
    if (match) {
      if (current) entries.push(current);
      current = { version: match[1], date: match[2], items: [] };
    } else if (current && line.startsWith("- ")) {
      current.items.push(line.slice(2).trim());
    }
  }
  if (current) entries.push(current);

  return entries;
}

export const changelogEntries = parseChangelog(changelogRaw);
export const latestVersion = changelogEntries[0]?.version ?? "0.0.0";
