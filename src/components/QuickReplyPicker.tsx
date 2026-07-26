"use client";

import * as React from "react";
import { Command, CommandList, CommandItem, CommandEmpty, CommandInput } from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { searchQuickReplies } from "@/api/quickRepliesApi";
import { useAuth } from "@/hooks/useAuth";
import type { QuickReply } from "@/lib/mockStore";

type Props = {
  query: string;
  onSelect: (qr: QuickReply) => void;
  onClose: () => void;
};

export default function QuickReplyPicker({ query, onSelect, onClose }: Props) {
  const user = useAuth();
  const [items, setItems] = React.useState<QuickReply[]>([]);

  React.useEffect(() => {
    let mounted = true;
    if (!user) return;
    searchQuickReplies(user.id, query || "").then((res) => { if (mounted) setItems(res); }).catch(() => {});
    return () => { mounted = false; };
  }, [user, query]);

  if (!user) return null;

  return (
    <div className="w-[360px] max-w-full p-1">
      <Command>
        <CommandInput placeholder="Search quick replies..." value={query} onValueChange={() => {}} />
        <ScrollArea className="h-56">
          <CommandList>
            {items.length === 0 && <CommandEmpty>No quick replies</CommandEmpty>}
            {items.map((it) => (
              <CommandItem key={it.id} onSelect={() => { onSelect(it); }}>
                <div className="flex flex-col">
                  <div className="font-medium">{it.title}</div>
                  <div className="text-sm text-muted-foreground truncate">/{it.shortcut} — {it.body}</div>
                </div>
              </CommandItem>
            ))}
          </CommandList>
        </ScrollArea>
      </Command>
    </div>
  );
}
