export function InsightGauge({ dash, filled }: { dash: string; filled: boolean }) {
  const path = 'M15 95a85 85 0 0 1 170 0';
  return <svg viewBox="0 0 200 110" aria-hidden>
    <path className="insight-gauge-track" d={path} pathLength="100" />
    {filled && <>
      <path className="insight-gauge-rim" d={path} pathLength="100" strokeDasharray={dash} />
      <path className="insight-gauge-fill" d={path} pathLength="100" strokeDasharray={dash} />
    </>}
  </svg>;
}
