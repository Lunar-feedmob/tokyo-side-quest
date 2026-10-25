import { route, ensureVisitor } from "@/lib/server/api";

export const POST = route(async () => {
  const { visitor, created } = await ensureVisitor();
  return { status: created ? 201 : 200, data: { visitor: { createdNow: created }, storageNote: "记录保存在本设备访客身份下；清除浏览器数据后可能无法找回。", id: visitor.id.slice(0, 8) } };
});
