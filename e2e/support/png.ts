const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk (always the first one), without decoding the image. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("Not a PNG");
  }
  if (png.toString("ascii", 12, 16) !== "IHDR") throw new Error("PNG without IHDR first");
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}
