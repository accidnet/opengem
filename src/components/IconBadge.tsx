import type { IconBadgeProps } from "@/types/chat";

export function IconBadge({ icon, text, color }: IconBadgeProps) {
  return (
    <span
      className={`icon-badge ${color ? `icon-badge-${color}` : ""}`}
      aria-hidden="true"
      role="img"
    >
      <span className="material-symbols-outlined" style={{ color: color || "#94a3b8" }}>
        {icon}
      </span>
      {text}
    </span>
  );
}
