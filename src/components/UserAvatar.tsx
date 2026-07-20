import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function UserAvatar({
  src, name, size = 40, online, className,
}: { src?: string; name: string; size?: number; online?: boolean; className?: string }) {
  const initials = name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}>
      <Avatar style={{ width: size, height: size }}>
        <AvatarImage src={src} alt={name} />
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      {online && (
        <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
      )}
    </div>
  );
}
