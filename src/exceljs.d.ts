import "exceljs";

declare module "exceljs" {
  interface Xlsx {
    load(data: Uint8Array | ArrayBuffer, options?: Partial<XlsxReadOptions>): Promise<Workbook>;
    writeBuffer(): Promise<Uint8Array>;
  }
}
