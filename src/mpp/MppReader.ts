import CFB from "cfb";

import type { ProjectFile } from "../model/Project.ts";
import { Mpp14Reader, type MppContainer, type MppInspection } from "./Mpp14Reader.ts";
import { detectMppVariant } from "./MppVariant.ts";

export class MppReader {
  inspect(data: Uint8Array | ArrayBuffer): MppInspection {
    const container = parseMppBuffer(data);
    return this.inspectContainer(container);
  }

  read(data: Uint8Array | ArrayBuffer): ProjectFile {
    const container = parseMppBuffer(data);
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

export function parseMppBuffer(data: Uint8Array | ArrayBuffer): MppContainer {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);

  if (bytes.byteLength === 0) {
    throw new Error("Failed to read MPP data: the buffer is empty and not a valid MPP document.");
  }

  let cfb: { FullPaths: string[]; FileIndex: Array<{ type: number; content?: Uint8Array }> };
  try {
    cfb = CFB.read(bytes, { type: "array" }) as typeof cfb;
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to read MPP data: the buffer is not a valid OLE2/MPP document. (${detail})`,
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
      "Unsupported MPP data: no readable streams found. " +
        "The data may use an older format that is not supported.",
    );
  }

  return { streams };
}
