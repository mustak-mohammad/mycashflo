interface StatCardProps {
  label: string
  value: string | number
  subtext?: string
  icon?: string
  color?: string
}

export function StatCard({ label, value, subtext, icon, color = 'var(--primary)' }: StatCardProps) {
  return (
    <div
      className="rounded-xl p-5 flex flex-col gap-3"
      style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
        {icon && (
          <span
            className="flex items-center justify-center rounded-lg text-lg"
            style={{ width: 36, height: 36, background: `${color}22`, color }}
          >
            {icon}
          </span>
        )}
      </div>
      <div>
        <div className="text-2xl font-bold text-white">{value}</div>
        {subtext && (
          <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {subtext}
          </div>
        )}
      </div>
    </div>
  )
}
