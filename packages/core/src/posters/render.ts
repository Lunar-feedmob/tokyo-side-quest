import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import QRCode from "qrcode";
import satori from "satori";
import sharp from "sharp";
import type { PosterSnapshot } from "../db/schema";

// Personal keepsake poster, 1080×1440 PNG (spec §14.1). Fixed server-side
// template; never includes coordinates, EXIF, internal ids or private URLs.

export const POSTER_TEMPLATE_VERSION = "ticket-v1";
export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1440;

const C = {
  paper: "#FAFAF7",
  paper2: "#F2F0E8",
  ink: "#202522",
  muted: "#5D6762",
  vermilion: "#C7372F",
  green: "#246B58",
  blue: "#295C89",
  rule: "#D9D6CC",
};

type Node = { type: string; props: Record<string, unknown> & { children?: unknown } };
type Child = Node | string | null | false | undefined;
function h(type: string, style: Record<string, unknown>, ...children: Child[]): Node {
  const kids = children.filter((c) => c !== null && c !== false && c !== undefined);
  return { type, props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}
function img(src: string, style: Record<string, unknown>, width: number, height: number): Node {
  return { type: "img", props: { src, width, height, style } };
}

interface Fonts {
  data: { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[];
}

/** Resolved at runtime (not via import.meta.url) so bundled web code finds the same files. */
async function fontDir(): Promise<string> {
  const candidates = [
    process.env.POSTER_FONT_DIR,
    path.join(process.cwd(), "packages/core/assets/fonts"),
    path.join(process.cwd(), "../../packages/core/assets/fonts"),
    path.join(process.cwd(), "../core/assets/fonts"),
    path.join(process.cwd(), "assets/fonts"),
  ].filter((p): p is string => Boolean(p));
  for (const dir of candidates) {
    try {
      await access(path.join(dir, "NotoSansSC-Regular.otf"));
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error("找不到海报字体目录，请运行 pnpm fonts:fetch 或设置 POSTER_FONT_DIR");
}

let fontsPromise: Promise<Fonts> | null = null;
export function loadFonts(): Promise<Fonts> {
  fontsPromise ??= (async () => {
    const dir = await fontDir();
    const read = (f: string) =>
      readFile(path.join(dir, f)).catch(() => {
        throw new Error(`缺少海报字体 ${f}，请运行 pnpm fonts:fetch`);
      });
    const [sans400, sans700, serif700] = await Promise.all([
      read("NotoSansSC-Regular.otf"),
      read("NotoSansSC-Bold.otf"),
      read("NotoSerifSC-Bold.otf"),
    ]);
    return {
      data: [
        { name: "Sans", data: sans400, weight: 400, style: "normal" },
        { name: "Sans", data: sans700, weight: 700, style: "normal" },
        { name: "Serif", data: serif700, weight: 700, style: "normal" },
      ],
    };
  })();
  fontsPromise.catch(() => {
    fontsPromise = null;
  });
  return fontsPromise;
}

/** Shrinks headline size for long names so they never overflow (spec §14.1). */
export function titleSize(title: string): number {
  const len = [...title].length;
  if (len <= 6) return 104;
  if (len <= 9) return 88;
  if (len <= 13) return 70;
  if (len <= 18) return 56;
  return 46;
}

function clampText(text: string, max: number): string {
  const chars = [...text];
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}

export interface PosterInput {
  snapshot: PosterSnapshot;
  coverJpeg: Buffer | null;
  shareUrl: string | null;
  sample?: boolean;
}

async function coverDataUri(jpeg: Buffer): Promise<string> {
  const out = await sharp(jpeg).resize(936, 560, { fit: "cover", position: "attention" }).jpeg({ quality: 86 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

function brandCover(s: PosterSnapshot): Node {
  // Legal, original brand background used when no matched photo is chosen.
  const lines = [0, 1, 2, 3, 4, 5].map((i) =>
    h("div", {
      position: "absolute",
      left: -80,
      top: 60 + i * 96,
      width: 1200,
      height: 14,
      backgroundColor: i % 2 === 0 ? C.green : C.vermilion,
      opacity: 0.16,
      transform: "rotate(-12deg)",
    }),
  );
  return h(
    "div",
    { position: "relative", width: 936, height: 560, borderRadius: 24, backgroundColor: C.paper2, overflow: "hidden", alignItems: "center", justifyContent: "center" },
    ...lines,
    h(
      "div",
      { flexDirection: "column", alignItems: "center" },
      h("div", { fontFamily: "Serif", fontSize: 150, fontWeight: 700, color: C.ink }, "支线"),
      h("div", { fontSize: 30, letterSpacing: 10, color: C.muted, marginTop: 8 }, s.kind === "quest" ? "STORY COMPLETE" : "TOKYO SIDE QUEST"),
    ),
  );
}

function stampNode(label: string, color: string, dashed: boolean): Node {
  return h(
    "div",
    {
      width: 132,
      height: 132,
      flexShrink: 0,
      marginLeft: 14,
      borderRadius: 66,
      border: `6px ${dashed ? "dashed" : "double"} ${color}`,
      color,
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      fontFamily: "Serif",
      fontWeight: 700,
      fontSize: 26,
      lineHeight: 1.15,
      padding: 12,
      transform: "rotate(-8deg)",
    },
    clampText(label, 8),
  );
}

export function posterTree(s: PosterSnapshot, cover: string | null, qr: string | null, sample: boolean): Node {
  const demo = s.mode === "demo";
  const stampColor = demo ? C.muted : C.vermilion;
  return h(
    "div",
    {
      width: POSTER_WIDTH,
      height: POSTER_HEIGHT,
      backgroundColor: C.paper,
      fontFamily: "Sans",
      color: C.ink,
      position: "relative",
    },
    h(
      "div",
      {
        flexDirection: "column",
        position: "absolute",
        left: 36,
        top: 36,
        // satori sizes the content box: subtract the 6px border and padding.
        width: POSTER_WIDTH - 72 - 12 - 60,
        height: POSTER_HEIGHT - 72 - 12 - 60,
        border: `6px solid ${C.ink}`,
        borderRadius: 28,
        backgroundColor: "#FFFFFF",
        padding: "32px 30px 28px",
        overflow: "hidden",
      },
      // notches
      h("div", { position: "absolute", left: -34, top: 1082, width: 56, height: 56, borderRadius: 28, backgroundColor: C.paper, border: `6px solid ${C.ink}` }),
      h("div", { position: "absolute", right: -34, top: 1082, width: 56, height: 56, borderRadius: 28, backgroundColor: C.paper, border: `6px solid ${C.ink}` }),
      // header
      h(
        "div",
        { justifyContent: "space-between", alignItems: "center", padding: "0 6px 22px", height: 100, flexShrink: 0 },
        h(
          "div",
          { alignItems: "center" },
          h("div", { width: 64, height: 64, borderRadius: 32, backgroundColor: C.vermilion, color: "#fff", fontFamily: "Serif", fontWeight: 700, fontSize: 34, alignItems: "center", justifyContent: "center" }, "支"),
          h("div", { flexDirection: "column", marginLeft: 18 }, h("div", { fontFamily: "Serif", fontWeight: 700, fontSize: 40 }, "东京支线"), h("div", { fontSize: 20, letterSpacing: 6, color: C.muted }, "TOKYO SIDE QUEST")),
        ),
        demo || sample
          ? null
          : h(
          "div",
          { fontSize: 24, fontWeight: 700, color: demo ? C.muted : C.green, border: `3px solid ${demo ? C.muted : C.green}`, borderRadius: 999, padding: "6px 20px" },
          sample ? "样例" : demo ? "试玩纪念" : s.kind === "quest" ? "故事票根" : "城市任务票",
        ),
      ),
      // cover
      h(
        "div",
        { justifyContent: "center", flexShrink: 0 },
        cover ? img(cover, { width: 936, height: 560, borderRadius: 24, objectFit: "cover" }, 936, 560) : brandCover(s),
      ),
      // title block
      h(
        "div",
        { flexDirection: "column", padding: "26px 12px 0", flexGrow: 1, minHeight: 0, overflow: "hidden" },
        h("div", { fontSize: 24, color: C.muted, letterSpacing: 2 }, clampText(s.subtitle, 30)),
        h("div", { fontFamily: "Serif", fontWeight: 700, fontSize: titleSize(s.title), lineHeight: 1.12, marginTop: 6 }, clampText(s.title, 24)),
        s.nameJa ? h("div", { fontSize: 30, color: C.muted, marginTop: 6 }, clampText(s.nameJa, 28)) : null,
        s.caption ? h("div", { fontSize: 30, marginTop: 18, color: C.ink }, `“${clampText(s.caption, 40)}”`) : null,
      ),
      // perforation
      h("div", { borderTop: `4px dashed ${C.rule}`, margin: "0 0 22px", flexShrink: 0 }),
      // footer row
      h(
        "div",
        { alignItems: "center", justifyContent: "space-between", padding: "0 12px", height: 196, flexShrink: 0 },
        h(
          "div",
          { alignItems: "center" },
          s.grade
            ? h(
                "div",
                { flexDirection: "column", alignItems: "center", marginRight: 26 },
                h("div", { fontFamily: "Serif", fontWeight: 700, fontSize: 92, lineHeight: 1, color: demo ? C.muted : C.vermilion }, s.grade),
                h("div", { fontSize: 20, color: C.muted, marginTop: 4 }, demo ? "试玩样例评级" : "摄影评级 · AI 建议"),
              )
            : null,
          ...s.stamps.slice(0, 2).map((label) => stampNode(label, s.questCompleted && label.includes("完成") ? (demo ? C.muted : C.green) : stampColor, demo)),
        ),
        h(
          "div",
          { flexDirection: "column", alignItems: "flex-end" },
          qr ? img(qr, { width: 150, height: 150 }, 150, 150) : null,
          h("div", { fontSize: 24, color: C.muted, marginTop: qr ? 8 : 0 }, `${s.dateTokyo} · 东京`),
        ),
      ),
    ),
    demo || sample
      ? h(
          "div",
          {
            position: "absolute",
            top: 70,
            right: -170,
            width: 560,
            height: 64,
            backgroundColor: C.ink,
            color: "#fff",
            fontSize: 28,
            fontWeight: 700,
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(35deg)",
            letterSpacing: 4,
          },
          sample ? "模板样例" : "试玩纪念 · DEMO",
        )
      : null,
  );
}

export async function renderPosterPng(input: PosterInput): Promise<Buffer> {
  const fonts = await loadFonts();
  const cover = input.coverJpeg ? await coverDataUri(input.coverJpeg) : null;
  const qr = input.shareUrl
    ? `data:image/svg+xml;base64,${Buffer.from(await QRCode.toString(input.shareUrl, { type: "svg", margin: 0, color: { dark: C.ink, light: "#FFFFFF" } })).toString("base64")}`
    : null;
  const svg = await satori(posterTree(input.snapshot, cover, qr, Boolean(input.sample)) as unknown as Parameters<typeof satori>[0], {
    width: POSTER_WIDTH,
    height: POSTER_HEIGHT,
    fonts: fonts.data,
  });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: POSTER_WIDTH } }).render().asPng();
  return Buffer.from(png);
}

export function tokyoDateLabel(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", year: "numeric", month: "numeric", day: "numeric" }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}年${get("month")}月${get("day")}日`;
}

export const SAMPLE_SNAPSHOT: PosterSnapshot = {
  templateVersion: POSTER_TEMPLATE_VERSION,
  mode: "live",
  kind: "quest",
  title: "猫店长的失落明信片",
  subtitle: "谷中 · 原创故事",
  nameJa: "谷中",
  dateTokyo: "2026年10月23日",
  caption: "四块画面，拼回一张傍晚的明信片。",
  grade: "S",
  stamps: ["谷中银座", "故事完成"],
  questCompleted: true,
  coverAssetId: null,
  coverAttemptId: null,
};
