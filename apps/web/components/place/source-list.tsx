interface Source {
  label: string;
  url: string;
  accessedOn: string;
}

export function SourceList({ sources }: { sources: Source[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-muted">
      {sources.map((s) => (
        <li key={s.url}>
          来源：
          <a href={s.url} className="underline" target="_blank" rel="noreferrer">
            {s.label}
          </a>
          （查阅于 {s.accessedOn}）
        </li>
      ))}
    </ul>
  );
}
