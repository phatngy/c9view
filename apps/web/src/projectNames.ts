export interface NamedProject {
  id: string;
  name: string;
  path: string;
}

export interface ProjectNameHint {
  path: string;
  ordinal?: number;
}

function pathParts(path: string) {
  return path.split(/[\\/]+/).filter(Boolean);
}

/** Returns the shortest trailing path hint that distinguishes colliding names. */
export function projectNameHints(projects: NamedProject[]) {
  const groups = new Map<string, NamedProject[]>();
  for (const project of projects) {
    groups.set(project.name, [...(groups.get(project.name) ?? []), project]);
  }

  const hints = new Map<string, ProjectNameHint>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const parts = group.map((project) => pathParts(project.path).slice(0, -1));
    const groupHints = group.map((_, index) => {
      const own = parts[index] ?? [];
      let length = 1;
      while (
        length < Math.min(own.length, 2) &&
        groupHintsCollide(parts, own, length, index)
      ) {
        length += 1;
      }
      return formatHint(own, length);
    });

    const collisions = new Map<string, number[]>();
    groupHints.forEach((hint, index) => {
      collisions.set(hint, [...(collisions.get(hint) ?? []), index]);
    });
    for (const [base, indexes] of collisions) {
      if (indexes.length === 1) {
        hints.set(group[indexes[0]!]!.id, { path: base });
        continue;
      }
      const ordered = indexes
        .map((index) => group[index]!)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      ordered.forEach((project, index) => {
        hints.set(project.id, { path: base, ordinal: index + 1 });
      });
    }
  }
  return hints;
}

export function formatProjectNameHint(hint: ProjectNameHint) {
  return `${hint.path}${hint.path && hint.ordinal ? ' ' : ''}${hint.ordinal ? `#${hint.ordinal}` : ''}`;
}

function groupHintsCollide(
  parts: string[][],
  own: string[],
  length: number,
  index: number,
) {
  const hint = formatHint(own, length);
  return parts.some(
    (other, otherIndex) =>
      otherIndex !== index && formatHint(other, length) === hint,
  );
}

function formatHint(parts: string[], length: number) {
  const hint = parts.slice(-length).join('/');
  return length === 2 && parts.length > 2 ? `…/${hint}` : hint;
}
