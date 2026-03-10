import type { MppContainer } from "./Mpp14Reader.ts";

export interface MppVariant {
  family: "modern";
  majorVersion: number;
  rootPath: string;
  formatPropsPath: string | null;
  projectPropsPath: string;
  summaryInformationPath: string | null;
  taskTablePath: string;
  resourceTablePath: string;
  assignmentTablePath: string;
  calendarTablePath: string;
  relationTablePath: string;
}

export function detectMppVariant(container: MppContainer): MppVariant {
  const formatPropsPath = detectFormatPropsPath(container);
  const rootPath = detectRootPath(container);
  const majorVersion =
    parseVersionSuffix(formatPropsPath) ?? inferVersionFromRootPath(rootPath) ?? 14;

  return {
    family: "modern",
    majorVersion,
    rootPath,
    formatPropsPath,
    projectPropsPath: `${rootPath}/Props`,
    summaryInformationPath: findFirstPath(container, (path) =>
      path.endsWith("/\u0005SummaryInformation"),
    ),
    taskTablePath: `${rootPath}/TBkndTask`,
    resourceTablePath: `${rootPath}/TBkndRsc`,
    assignmentTablePath: `${rootPath}/TBkndAssn`,
    calendarTablePath: `${rootPath}/TBkndCal`,
    relationTablePath: `${rootPath}/TBkndCons`,
  };
}

function detectFormatPropsPath(container: MppContainer): string | null {
  return [...container.streams.keys()]
    .filter((path) => /\/Props\d+$/u.test(path))
    .sort(compareVersionedPaths)
    .at(-1) ?? null;
}

function detectRootPath(container: MppContainer): string {
  const candidates = new Map<string, number>();

  for (const path of container.streams.keys()) {
    const match = /^(.*)\/TBknd(Task|Rsc|Assn|Cal|Cons)\/Fixed(?:2)?Data$/u.exec(
      path,
    );
    if (!match) {
      continue;
    }

    const rootPath = match[1];
    if (!rootPath) {
      continue;
    }

    const currentScore = candidates.get(rootPath) ?? 0;
    candidates.set(rootPath, currentScore + 1);
  }

  const ranked = [...candidates.entries()].sort((left, right) => {
    if (left[1] !== right[1]) {
      return left[1] - right[1];
    }

    const leftVersion = inferVersionFromRootPath(left[0]) ?? -1;
    const rightVersion = inferVersionFromRootPath(right[0]) ?? -1;
    if (leftVersion !== rightVersion) {
      return leftVersion - rightVersion;
    }

    return left[0].localeCompare(right[0]);
  });

  const rootPath = ranked.at(-1)?.[0];
  if (!rootPath) {
    throw new Error("Unsupported MPP file: unable to locate a modern TBknd root");
  }

  const requiredTables = [
    "TBkndTask",
    "TBkndRsc",
    "TBkndAssn",
    "TBkndCal",
    "TBkndCons",
  ];
  for (const table of requiredTables) {
    const fixedDataPath = `${rootPath}/${table}/FixedData`;
    if (!container.streams.has(fixedDataPath)) {
      throw new Error(
        `Unsupported MPP file: missing ${fixedDataPath} under detected root ${rootPath}`,
      );
    }
  }

  return rootPath;
}

function findFirstPath(
  container: MppContainer,
  predicate: (path: string) => boolean,
): string | null {
  return [...container.streams.keys()].find(predicate) ?? null;
}

function compareVersionedPaths(left: string, right: string): number {
  const leftVersion = parseVersionSuffix(left) ?? -1;
  const rightVersion = parseVersionSuffix(right) ?? -1;
  if (leftVersion !== rightVersion) {
    return leftVersion - rightVersion;
  }
  return left.localeCompare(right);
}

function parseVersionSuffix(path: string | null): number | null {
  if (!path) {
    return null;
  }
  const match = /Props(\d+)$/u.exec(path);
  return match?.[1] ? Number(match[1]) : null;
}

function inferVersionFromRootPath(path: string): number | null {
  const segment = path.split("/").at(-1)?.trim();
  if (!segment) {
    return null;
  }

  const numericValue = Number(segment);
  if (!Number.isFinite(numericValue)) {
    return null;
  }

  if (numericValue >= 100 && numericValue < 200) {
    return numericValue - 100;
  }

  return null;
}
