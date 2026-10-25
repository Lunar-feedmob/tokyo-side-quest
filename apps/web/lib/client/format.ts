export function formatDistance(m: number | undefined | null): string {
  if (m === undefined || m === null) return "";
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function tokyoDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
}

export function tokyoDateTime(iso: string | Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** External navigation opens only on click; nothing is sent in the background (spec §7.2). */
export function navigationUrl(p: { latitude: number; longitude: number; nameJa: string }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}&travelmode=walking`;
}

export function stampTitle(key: string, names: Record<string, string>): string {
  const [kind, slug] = key.split(":");
  const name = slug ? (names[slug] ?? slug) : key;
  return kind === "quest" ? `故事完成 · ${name}` : name;
}
