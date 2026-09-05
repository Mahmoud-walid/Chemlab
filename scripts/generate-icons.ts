import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

/**
 * Draws Chemlab's app icons.
 *
 *   pnpm icons:generate
 *
 * These are PLACEHOLDERS. #17's first open question asks whether the owner has
 * a source logo at 512 px; until one exists, an installable app needs icons of
 * the right sizes more than it needs the right artwork — without them iOS
 * cannot install the site to the Home Screen, and without that iOS can never
 * receive a push at all.
 *
 * Written by hand rather than with an image library: adding a native
 * dependency (sharp) to a build in order to draw two rectangles and a
 * trapezoid is a poor trade, and this runs once.
 *
 * The shape is a flask: a neck and a tapered body, in the site's primary
 * colour. Replace `public/icons/*` with real artwork and this script becomes
 * unnecessary.
 */

/** The site's `--primary` in light mode, converted from oklch. */
const BRAND: RGB = [93, 42, 92];
const INK: RGB = [255, 255, 255];

type RGB = [number, number, number];

interface IconSpec {
  file: string;
  size: number;
  /** Maskable icons must keep their art inside a safe circle, because the
   * platform crops them to whatever shape it likes. */
  maskable: boolean;
}

const ICONS: IconSpec[] = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
  // Monochrome, small, and shown in the status bar on Android.
  { file: "badge-72.png", size: 72, maskable: false },
];

function draw(size: number, maskable: boolean): Buffer {
  const pixels = Buffer.alloc(size * size * 4);

  // A maskable icon is cropped by the platform, so the art is drawn smaller
  // and centred inside the safe zone rather than filling the canvas.
  const scale = maskable ? 0.6 : 0.78;
  const cx = size / 2;
  const radius = size * 0.18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;

      const inBackground = maskable
        ? true
        : insideRoundedSquare(x, y, size, radius);

      let colour: RGB | null = inBackground ? BRAND : null;
      if (maskable) colour = BRAND;

      if (colour && insideFlask(x, y, size, cx, scale)) colour = INK;

      if (colour) {
        pixels[offset] = colour[0];
        pixels[offset + 1] = colour[1];
        pixels[offset + 2] = colour[2];
        pixels[offset + 3] = 255;
      }
    }
  }

  return encodePng(size, size, pixels);
}

function insideRoundedSquare(
  x: number,
  y: number,
  size: number,
  radius: number,
): boolean {
  const nx = Math.min(x, size - 1 - x);
  const ny = Math.min(y, size - 1 - y);
  if (nx >= radius || ny >= radius) return true;
  const dx = radius - nx;
  const dy = radius - ny;
  return dx * dx + dy * dy <= radius * radius;
}

/** A conical flask: a narrow neck above a body that widens toward the base. */
function insideFlask(
  x: number,
  y: number,
  size: number,
  cx: number,
  scale: number,
): boolean {
  const top = size * (0.5 - scale / 2);
  const height = size * scale;
  const t = (y - top) / height;
  if (t < 0 || t > 1) return false;

  const neckHalf = size * scale * 0.09;
  const baseHalf = size * scale * 0.36;

  // The neck runs for the first third, then the body tapers outward.
  const half =
    t < 0.34
      ? neckHalf
      : neckHalf + (baseHalf - neckHalf) * ((t - 0.34) / 0.66);

  // A collar at the very top, so the neck reads as a flask and not a stick.
  if (t < 0.06) return Math.abs(x - cx) <= neckHalf * 1.9;

  return Math.abs(x - cx) <= half;
}

/** A minimal PNG: one IHDR, one deflated IDAT, one IEND. */
function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    // Filter byte 0 (None) per scanline. Filtering would shrink the file; the
    // icons are a few kilobytes either way.
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function main() {
  const dir = path.join(process.cwd(), "public", "icons");
  await mkdir(dir, { recursive: true });

  for (const icon of ICONS) {
    await writeFile(path.join(dir, icon.file), draw(icon.size, icon.maskable));
    console.log(`icons: wrote ${icon.file} (${icon.size}px)`);
  }

  console.log("These are placeholders. Replace them with real artwork.");
}

void main();
