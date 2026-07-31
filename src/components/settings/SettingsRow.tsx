import React from "react";
import { ChevronRight } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { UserAvatar } from "@/components/UserAvatar";

type IconComp = React.ComponentType<{ className?: string }> | null;

type Props = {
  icon?: IconComp;
  iconBg?: string;
  label?: React.ReactNode;
  value?: React.ReactNode;
  onClick?: () => void;
  toggle?: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean };
  action?: boolean;
  destructive?: boolean;
  className?: string;
};

export function SettingsRow({ icon: Icon, iconBg = "bg-muted", label, value, onClick, toggle, action, destructive, className }: Props) {
  if (destructive) {
    return (
      <div className={`px-4 py-3 ${className ?? ""} text-center`}>
        <button className="w-full text-destructive-foreground text-red-600 font-semibold" onClick={onClick}>
          {label}
        </button>
      </div>
    );
  }

  const clickable = !!onClick && !toggle && !action;

  return (
    <div
      onClick={clickable ? onClick : undefined}
      className={`flex items-center gap-3 px-4 py-3 ${clickable ? "cursor-pointer" : ""} ${className ?? ""}`}
    >
      {Icon ? (
        <div className={`h-7 w-7 rounded-[8px] grid place-items-center text-white ${iconBg}`}>
          <Icon className="h-4 w-4" />
        </div>
      ) : (
        <div style={{ width: 28 }} />
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="truncate text-[17px]">{label}</div>
        </div>
      </div>

      {toggle ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch checked={toggle.checked} onCheckedChange={toggle.onChange} disabled={toggle.disabled} />
        </div>
      ) : action ? (
        <button className="text-primary font-medium" onClick={onClick}>
          {label}
        </button>
      ) : (
        <div className="flex items-center gap-1">
          {value ? <div className="text-muted-foreground text-[17px]">{value}</div> : null}
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

export default SettingsRow;
