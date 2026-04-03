import type { ModeIcon } from "@/features/app/config/appData";

import { MODE_ICON_LABELS } from "./constants";

export const parseConfigList = (value: string) => {
  return value
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const getModeIconLabel = (icon: ModeIcon) => {
  return MODE_ICON_LABELS[icon] || icon;
};
