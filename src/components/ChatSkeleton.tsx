import { Skeleton } from "@/components/ui/skeleton";

export function ChatSkeleton() {
  return (
    <div className="relative flex flex-1 flex-col h-full min-h-0 overflow-hidden bg-background">
      {/* Header skeleton */}
      <div className="flex h-16 shrink-0 items-center gap-3 border-b px-3 bg-card">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>

      {/* Messages skeleton */}
      <div className="flex-1 p-4 space-y-4 overflow-y-auto bg-muted/20">
        <div className="flex gap-3 max-w-[70%]">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <Skeleton className="h-14 flex-1 rounded-2xl" />
        </div>
        <div className="flex gap-3 max-w-[70%] ml-auto justify-end">
          <Skeleton className="h-12 w-48 rounded-2xl bg-primary/20" />
        </div>
        <div className="flex gap-3 max-w-[70%]">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <Skeleton className="h-20 flex-1 rounded-2xl" />
        </div>
        <div className="flex gap-3 max-w-[70%] ml-auto justify-end">
          <Skeleton className="h-10 w-36 rounded-2xl bg-primary/20" />
        </div>
      </div>

      {/* Input bar skeleton */}
      <div className="h-16 border-t p-3 bg-card flex items-center gap-2">
        <Skeleton className="h-9 w-9 rounded-full shrink-0" />
        <Skeleton className="h-10 flex-1 rounded-full" />
        <Skeleton className="h-9 w-9 rounded-full shrink-0" />
      </div>
    </div>
  );
}
