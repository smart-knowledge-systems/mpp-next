import CFB from "cfb";

import type { ProjectFile } from "../model/Project.ts";
import {
  Mpp14Reader,
  type MppContainer,
  type MppInspection,
} from "./Mpp14Reader.ts";
import { detectMppVariant } from "./MppVariant.ts";

export interface MppReadOptions {
  fixtureJsonPath?: string;
  allowDefaultFixture?: boolean;
}

export class MppReader {
  async inspect(path: string): Promise<MppInspection> {
    return this.inspectContainer(await loadMppContainer(path));
  }

  async read(path: string, _options?: MppReadOptions): Promise<ProjectFile> {
    void _options;
    return this.readContainer(await loadMppContainer(path));
  }

  inspectContainer(container: MppContainer): MppInspection {
    const reader = new Mpp14Reader(container, detectMppVariant(container));
    return reader.inspect();
  }

  readContainer(container: MppContainer): ProjectFile {
    const reader = new Mpp14Reader(container, detectMppVariant(container));
    return reader.read();
  }
}

export async function loadMppContainer(path: string): Promise<MppContainer> {
  const arrayBuffer = await Bun.file(path).arrayBuffer();
  const cfb = CFB.read(new Uint8Array(arrayBuffer), { type: "array" }) as {
    FullPaths: string[];
    FileIndex: Array<{ type: number; content?: Uint8Array }>;
  };

  const streams = new Map<string, Uint8Array>();
  cfb.FullPaths.forEach((fullPath, index) => {
    const entry = cfb.FileIndex[index];
    if (entry?.type === 2 && entry.content) {
      streams.set(fullPath, new Uint8Array(entry.content));
    }
  });

  if (streams.size === 0) {
    throw new Error(`Unsupported MPP file: no readable streams found in ${path}`);
  }

  return { streams };
}
