// Downloads the Noto CJK (SIL OFL 1.1) fonts used for server-side poster
// rendering and verifies their checksums. Run: pnpm fonts:fetch
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const dir = new URL("../packages/core/assets/fonts/", import.meta.url);
const BASE = "https://github.com/notofonts/noto-cjk/raw/main/";
const FONTS = [
  ["Sans/SubsetOTF/SC/NotoSansSC-Regular.otf", "faa6c9df652116dde789d351359f3d7e5d2285a2b2a1f04a2d7244df706d5ea9"],
  ["Sans/SubsetOTF/SC/NotoSansSC-Bold.otf", "c6cb5a93abaa9edc8ee7463b7ebb7f42d618d40e6ed2f7a5371c97b0b64767c0"],
  ["Serif/SubsetOTF/SC/NotoSerifSC-Bold.otf", "24693d48bdb9152f0a06b02af625638a1097abd6de4010ebba027f6e82710527"],
];

await mkdir(dir, { recursive: true });
for (const [path, sha] of FONTS) {
  const target = new URL(path.split("/").pop(), dir);
  const existing = await readFile(target).catch(() => null);
  if (existing && createHash("sha256").update(existing).digest("hex") === sha) {
    console.log(`ok   ${path}`);
    continue;
  }
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`download failed ${res.status} ${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = createHash("sha256").update(buf).digest("hex");
  if (got !== sha) throw new Error(`checksum mismatch for ${path}: ${got}`);
  await writeFile(target, buf);
  console.log(`got  ${path}`);
}
