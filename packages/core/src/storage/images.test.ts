import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { AppError } from "../http/errors";
import { normalizeImage } from "./images";

async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 32, channels: 3, background: "#c7372f" } })
    .jpeg()
    .withExif({
      IFD0: { Make: "TestCam" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "35/1 43/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "139/1 46/1 0/1" },
    })
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

describe("normalizeImage (I08, I09)", () => {
  it("strips EXIF including GPS and applies orientation", async () => {
    const input = await jpegWithGps();
    const before = await sharp(input).metadata();
    expect(before.exif).toBeDefined();
    expect(before.orientation).toBe(6);

    const out = await normalizeImage(input);
    for (const buf of [out.main, out.model, out.thumb]) {
      const meta = await sharp(buf).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.format).toBe("jpeg");
    }
    // Orientation 6 = rotate 90°, so 64×32 becomes 32×64.
    expect([out.width, out.height]).toEqual([32, 64]);
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects bytes that are not an image even with an image extension or MIME", async () => {
    await expect(normalizeImage(Buffer.from("<html>not an image</html>"))).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
  });

  it("rejects unsupported formats such as GIF", async () => {
    const gif = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } }).gif().toBuffer();
    await expect(normalizeImage(gif)).rejects.toBeInstanceOf(AppError);
    await expect(normalizeImage(gif)).rejects.toMatchObject({ code: "UNSUPPORTED_IMAGE" });
  });

  it("rejects oversize uploads before decoding", async () => {
    await expect(normalizeImage(Buffer.alloc(15 * 1024 * 1024 + 1))).rejects.toMatchObject({
      code: "UPLOAD_TOO_LARGE",
    });
  });

  it("is deterministic for identical input", async () => {
    const input = await jpegWithGps();
    const [a, b] = await Promise.all([normalizeImage(input), normalizeImage(input)]);
    expect(a.sha256).toBe(b.sha256);
  });
});
