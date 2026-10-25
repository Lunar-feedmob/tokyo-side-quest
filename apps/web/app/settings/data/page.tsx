import type { Metadata } from "next";
import { DataSettings } from "@/components/me/data-settings";

export const metadata: Metadata = { title: "数据设置" };

export default function DataSettingsPage() {
  return <DataSettings />;
}
