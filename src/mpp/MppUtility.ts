import { Duration } from "../model/Duration.ts";
import { TimeUnit } from "../model/types.ts";

export class MppUtility {
  static getInt(buffer: Uint8Array, offset: number): number {
    return new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    ).getInt32(offset, true);
  }

  static getUInt(buffer: Uint8Array, offset: number): number {
    return new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    ).getUint32(offset, true);
  }

  static getShort(buffer: Uint8Array, offset: number): number {
    return new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    ).getInt16(offset, true);
  }

  static getUShort(buffer: Uint8Array, offset: number): number {
    return new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    ).getUint16(offset, true);
  }

  static getDouble(buffer: Uint8Array, offset: number): number {
    return new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    ).getFloat64(offset, true);
  }

  static getUnicodeString(
    buffer: Uint8Array,
    offset: number,
    byteLength: number,
  ): string {
    const slice = buffer.subarray(offset, offset + byteLength);
    const decoded = Buffer.from(slice).toString("utf16le");
    return decoded.replace(/\0+$/u, "");
  }

  static getUnicodeStringToEnd(buffer: Uint8Array, offset = 0): string {
    if (offset >= buffer.length) {
      return "";
    }
    return (
      Buffer.from(buffer.subarray(offset)).toString("utf16le").split("\0")[0] ??
      ""
    );
  }

  static getAnsiString(
    buffer: Uint8Array,
    offset = 0,
    byteLength?: number,
  ): string {
    const slice =
      byteLength === undefined
        ? buffer.subarray(offset)
        : buffer.subarray(offset, offset + byteLength);
    return Buffer.from(slice).toString("latin1").split("\0")[0] ?? "";
  }

  static getTimestampValue(buffer: Uint8Array, offset: number): Date | null {
    if (offset + 4 > buffer.length) {
      return null;
    }

    const time = this.getUShort(buffer, offset);
    const days = this.getUShort(buffer, offset + 2);
    if (days <= 1 || days === 0xffff) {
      return null;
    }

    const result = new Date(1983, 11, 31, 0, 0, 0, 0);
    result.setDate(result.getDate() + days);
    result.setSeconds(result.getSeconds() + time * 6);

    if (days < 100 && result.getSeconds() !== 0) {
      return null;
    }

    return result;
  }

  static durationFromTenthsOfMinutes(
    value: number | null,
    unit: TimeUnit,
  ): Duration | null {
    if (value === null) {
      return null;
    }

    switch (unit) {
      case TimeUnit.Hours:
        return new Duration(value / 600, TimeUnit.Hours);
      case TimeUnit.Days:
        return new Duration(value / 4800, TimeUnit.Days);
      case TimeUnit.Minutes:
      default:
        return new Duration(value / 10, TimeUnit.Minutes);
    }
  }

  static isSameMinute(left: Date | null, right: Date | null): boolean {
    return (
      left?.getFullYear() === right?.getFullYear() &&
      left?.getMonth() === right?.getMonth() &&
      left?.getDate() === right?.getDate() &&
      left?.getHours() === right?.getHours() &&
      left?.getMinutes() === right?.getMinutes()
    );
  }

  static toHex(buffer: Uint8Array, maxBytes = 64): string {
    return Array.from(buffer.subarray(0, Math.min(maxBytes, buffer.length)))
      .map((value) => value.toString(16).padStart(2, "0"))
      .join("");
  }
}
