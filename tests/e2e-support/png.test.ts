import { deflateSync } from "node:zlib";
import { expect, test } from "vitest";
import { pngSize } from "../../e2e/support/png";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  // pngSize never checks the CRC, so zeros are enough here.
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
}

function png(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc(1))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("reads width and height from IHDR, also when they differ", () => {
  expect(pngSize(png(180, 180))).toEqual({ width: 180, height: 180 });
  expect(pngSize(png(1024, 37))).toEqual({ width: 1024, height: 37 });
});

test("rejects anything that is not a PNG", () => {
  expect(() => pngSize(Buffer.from("GIF89a not a png at all, really"))).toThrow("Not a PNG");
  expect(() => pngSize(SIGNATURE)).toThrow("Not a PNG");
});

test("rejects a PNG whose first chunk is not IHDR", () => {
  const broken = Buffer.concat([SIGNATURE, chunk("tEXt", Buffer.alloc(13))]);
  expect(() => pngSize(broken)).toThrow("PNG without IHDR first");
});
