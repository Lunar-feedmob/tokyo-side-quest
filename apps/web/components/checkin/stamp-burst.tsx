"use client";

export function StampBurst(props: { stamps: string[]; placeName: string; demo?: boolean; questTitle?: string }) {
  if (props.stamps.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-4 pt-1">
      {props.stamps.map((s) => {
        const quest = s.startsWith("quest:");
        return (
          <div key={s} className="flex items-center gap-3">
            <span className={`stamp stamp-in ${props.demo ? "stamp-demo" : quest ? "stamp-quest" : ""}`} aria-hidden>
              {quest ? "故事\n完成" : props.placeName.slice(0, 6)}
            </span>
            <span className="text-sm font-semibold">
              {props.demo ? "获得试玩印章" : quest ? "获得故事完成章" : "获得地点印章"}
              <span className="block text-xs font-normal text-muted">同一印章只会发放一次</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
