import CFB from "cfb";

import type { ProjectFile } from "../model/Project.ts";
import { Mpp14Reader, type MppContainer, type MppInspection } from "./Mpp14Reader.ts";
import { detectMppVariant } from "./MppVariant.ts";

export interface MppReadOptions {
  fixtureJsonPath?: string;
  allowDefaultFixture?: boolean;
}

export class MppReader {
  async inspect(path: string): Promise<MppInspection> {
    const container = await safeMppLoad(path);
    return this.inspectContainer(container);
  }

  async read(path: string, _options?: MppReadOptions): Promise<ProjectFile> {
    void _options;
    const container = await safeMppLoad(path);
    return this.readContainer(container);
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

async function safeMppLoad(path: string): Promise<MppContainer> {
  try {
    return await loadMppContainer(path);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);

    if (
      message.includes("ENOENT") ||
      message.includes("No such file") ||
      message.includes("no such file")
    ) {
      throw new Error(`MPP file not found: ${path}`, { cause: error });
    }

    if (message.includes("Unsupported MPP file")) {
      throw error;
    }

    throw new Error(
      `Failed to read MPP file: ${path}. ` +
        `The file may be corrupted or not a valid OLE2/MPP document. (${message})`,
      { cause: error },
    );
  }
}

export async function loadMppContainer(path: string): Promise<MppContainer> {
  const file = Bun.file(path);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`MPP file not found: ${path}`);
  }

  const arrayBuffer = await file.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error(
      `Failed to read MPP file: ${path}. The file is empty and not a valid MPP document.`,
    );
  }

  let cfb: { FullPaths: string[]; FileIndex: Array<{ type: number; content?: Uint8Array }> };
  try {
    cfb = CFB.read(new Uint8Array(arrayBuffer), { type: "array" }) as typeof cfb;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read MPP file: ${path}. ` +
        `The file is not a valid OLE2/MPP document. (${detail})`,
      { cause: error },
    );
  }

  const streams = new Map<string, Uint8Array>();
  cfb.FullPaths.forEach((fullPath, index) => {
    const entry = cfb.FileIndex[index];
    if (entry?.type === 2 && entry.content) {
      streams.set(fullPath, new Uint8Array(entry.content));
    }
  });

  if (streams.size === 0) {
    throw new Error(
      `Unsupported MPP file: no readable streams found in ${path}. ` +
        `The file may use an older format that is not supported.`,
    );
  }

  return { streams };
}
