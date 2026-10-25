import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import { loadFonts } from "./render";

// Promotional assets (spec §14.3): brand poster 1080×1440, share preview
// 1200×630 and the stamp set. Original vector artwork only — no photos and
// no AI-generated imagery. Run: pnpm brand:render

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

type Node = { type: string; props: Record<string, unknown> };
function h(style: Record<string, unknown>, ...children: (Node | string | null)[]): Node {
  const kids = children.filter((c) => c !== null);
  return { type: "div", props: { style: { display: "flex", ...style }, children: kids.length === 1 ? kids[0] : kids } };
}

const STOPS = ["夕阳阶梯", "观音寺筑地塀", "冈仓天心纪念公园", "谷中银座"];

function stamp(label: string, color: string, size: number, rotate = -8): Node {
  // satori sizes the content box, so subtract border + padding to keep a true circle.
  const border = Math.round(size / 22);
  const pad = Math.round(size / 10);
  return h(
    {
      width: size - 2 * (border + pad),
      height: size - 2 * (border + pad),
      borderRadius: size,
      border: `${border}px double ${color}`,
      color,
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
      fontFamily: "Serif",
      fontWeight: 700,
      fontSize: Math.round(size / 6.6),
      lineHeight: 1.15,
      padding: pad,
      transform: `rotate(${rotate}deg)`,
      flexShrink: 0,
    },
    ...label.split("\n").map((line) => h({ whiteSpace: "nowrap" }, line)),
  );
}

function routeLine(width: number): Node {
  return h(
    { flexDirection: "column", width },
    h({ position: "relative", height: 8, backgroundColor: C.green, borderRadius: 4, marginTop: 20 }),
    h(
      { justifyContent: "space-between", marginTop: -24 },
      ...STOPS.map((s, i) =>
        h(
          { flexDirection: "column", alignItems: "center", width: width / STOPS.length },
          h({ width: 32, height: 32, borderRadius: 16, backgroundColor: "#fff", border: `6px solid ${i === STOPS.length - 1 ? C.vermilion : C.green}` }),
          h({ fontSize: 24, marginTop: 12, color: C.ink, textAlign: "center" }, s),
        ),
      ),
    ),
  );
}

function mainPoster(): Node {
  return h(
    { width: 1080, height: 1440, backgroundColor: C.paper, fontFamily: "Sans", color: C.ink, position: "relative" },
    // diagonal line pattern
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) =>
      h({ position: "absolute", left: -200, top: 80 + i * 180, width: 1600, height: 18, backgroundColor: i % 2 ? C.vermilion : C.green, opacity: 0.08, transform: "rotate(-14deg)" }),
    ),
    h(
      {
        position: "absolute",
        left: 60,
        top: 60,
        width: 1080 - 120 - 12 - 120,
        height: 1440 - 120 - 12 - 120,
        border: `6px solid ${C.ink}`,
        borderRadius: 32,
        backgroundColor: "#fff",
        padding: 60,
        flexDirection: "column",
      },
      h(
        { alignItems: "center", justifyContent: "space-between" },
        h(
          { alignItems: "center" },
          h({ width: 84, height: 84, borderRadius: 42, backgroundColor: C.vermilion, color: "#fff", fontFamily: "Serif", fontWeight: 700, fontSize: 46, alignItems: "center", justifyContent: "center" }, "支"),
          h({ flexDirection: "column", marginLeft: 22 }, h({ fontFamily: "Serif", fontWeight: 700, fontSize: 52 }, "东京支线"), h({ fontSize: 24, letterSpacing: 8, color: C.muted }, "TOKYO SIDE QUEST")),
        ),
        h({ fontSize: 26, fontWeight: 700, color: C.green, border: `3px solid ${C.green}`, borderRadius: 999, padding: "8px 24px" }, "城市任务票"),
      ),
      h({ fontFamily: "Serif", fontWeight: 700, fontSize: 112, lineHeight: 1.12, marginTop: 110, flexDirection: "column" }, h({}, "今天在东京，"), h({}, "你想成为谁？")),
      h({ fontSize: 40, color: C.ink, marginTop: 44, lineHeight: 1.5 }, "领取一张任务票，开启你的城市支线。"),
      h({ fontSize: 30, color: C.muted, marginTop: 14 }, "不用做攻略，花一小时，成为一段东京故事的主角。"),
      h({ flexGrow: 1 }),
      h({ fontSize: 24, color: C.muted, letterSpacing: 4, marginBottom: 16 }, "首发街区 · 谷中"),
      routeLine(1080 - 120 - 12 - 120),
      h({ borderTop: `4px dashed ${C.rule}`, marginTop: 56, marginBottom: 36 }),
      h(
        { alignItems: "center", justifyContent: "space-between" },
        h({ alignItems: "center" }, stamp("谷中银座", C.vermilion, 150), h({ width: 24 }), stamp("故事\n完成", C.green, 150, 6)),
        h({ flexDirection: "column", alignItems: "flex-end" }, h({ fontSize: 30, fontWeight: 700 }, "发现 → 探索 → 打卡 → 收藏"), h({ fontSize: 22, color: C.muted, marginTop: 10 }, "原创故事为虚构内容 · 地点资料标注来源")),
      ),
    ),
  );
}

function ogImage(): Node {
  return h(
    { width: 1200, height: 630, backgroundColor: C.paper, fontFamily: "Sans", color: C.ink, position: "relative" },
    ...[0, 1, 2, 3].map((i) =>
      h({ position: "absolute", left: -100, top: 60 + i * 160, width: 1500, height: 14, backgroundColor: i % 2 ? C.vermilion : C.green, opacity: 0.08, transform: "rotate(-10deg)" }),
    ),
    h(
      {
        position: "absolute",
        left: 40,
        top: 40,
        width: 1200 - 80 - 10 - 100,
        height: 630 - 80 - 10 - 100,
        border: `5px solid ${C.ink}`,
        borderRadius: 26,
        backgroundColor: "#fff",
        padding: 50,
        flexDirection: "column",
      },
      h(
        { alignItems: "center" },
        h({ width: 64, height: 64, borderRadius: 32, backgroundColor: C.vermilion, color: "#fff", fontFamily: "Serif", fontWeight: 700, fontSize: 34, alignItems: "center", justifyContent: "center" }, "支"),
        h({ fontFamily: "Serif", fontWeight: 700, fontSize: 40, marginLeft: 18 }, "东京支线"),
        h({ fontSize: 20, letterSpacing: 6, color: C.muted, marginLeft: 16 }, "TOKYO SIDE QUEST"),
      ),
      h(
        { alignItems: "center", justifyContent: "space-between", flexGrow: 1 },
        h(
          { flexDirection: "column" },
          h({ fontFamily: "Serif", fontWeight: 700, fontSize: 78, lineHeight: 1.15 }, "今天在东京，你想成为谁？"),
          h({ fontSize: 30, color: C.muted, marginTop: 18 }, "领取一张任务票，开启你的城市支线。"),
        ),
      ),
      h({ alignItems: "center", justifyContent: "space-between" }, h({ fontSize: 24, color: C.green, fontWeight: 700 }, "谷中 · 原创故事《猫店长的失落明信片》"), stamp("城市\n任务", C.vermilion, 110)),
    ),
  );
}

function stampSheet(): Node {
  const place = ["夕阳阶梯", "观音寺筑地塀", "冈仓天心纪念公园", "谷中银座", "夜店通", "根津神社"];
  return h(
    { width: 1200 - 120, height: 800 - 120, backgroundColor: C.paper, fontFamily: "Sans", color: C.ink, flexDirection: "column", padding: 60 },
    h({ fontFamily: "Serif", fontWeight: 700, fontSize: 44 }, "东京支线 · 印章设计"),
    h({ fontSize: 22, color: C.muted, marginTop: 8 }, "地点探索章（朱红）· 故事完成章（线路绿）· 试玩章（灰色虚线）"),
    h(
      { flexWrap: "wrap", marginTop: 30, justifyContent: "space-between", width: 1080 },
      ...place.map((p, i) => h({ width: 170, height: 190, alignItems: "center", justifyContent: "center" }, stamp(p.length > 4 ? `${p.slice(0, Math.ceil(p.length / 2))}\n${p.slice(Math.ceil(p.length / 2))}` : p, C.vermilion, 160, i % 2 ? 6 : -8))),
    ),
    h(
      { justifyContent: "center", marginTop: 50 },
      stamp("故事\n完成", C.green, 170, 4),
      h({ width: 80 }),
      h(
        {
          width: 170 - 16,
          height: 170 - 16,
          borderRadius: 170,
          border: `8px dashed ${C.muted}`,
          color: C.muted,
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "Serif",
          fontWeight: 700,
          fontSize: 32,
          transform: "rotate(-6deg)",
        },
        "试玩",
      ),
    ),
  );
}

async function render(node: Node, width: number, height: number): Promise<Buffer> {
  const fonts = await loadFonts();
  const svg = await satori(node as unknown as Parameters<typeof satori>[0], { width, height, fonts: fonts.data });
  return Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng());
}

export async function renderBrandAssets(outDir: string) {
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "brand-poster-1080x1440.png"), await render(mainPoster(), 1080, 1440));
  await writeFile(path.join(outDir, "og-1200x630.png"), await render(ogImage(), 1200, 630));
  await writeFile(path.join(outDir, "stamps-1200x800.png"), await render(stampSheet(), 1200, 800));
}

if (process.argv[1]?.endsWith("brand.ts")) {
  const out = process.argv[2] ?? path.join(process.cwd(), "../../apps/web/public/brand");
  await renderBrandAssets(out);
  console.log(`品牌素材已生成：${out}`);
}
