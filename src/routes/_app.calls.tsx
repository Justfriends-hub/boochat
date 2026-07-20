import { createFileRoute } from "@tanstack/react-router";
import { EmptyState } from "@/components/EmptyState";
import { Phone } from "lucide-react";

export const Route = createFileRoute("/_app/calls")({
  component: () => (
    <div className="flex flex-1 flex-col">
      <header className="flex h-16 items-center border-b bg-card px-4">
        <h1 className="text-xl font-semibold">Calls</h1>
      </header>
      <EmptyState icon={Phone} title="No recent calls" description="Voice and video calls will appear here." />
    </div>
  ),
  head: () => ({ meta: [{ title: "Calls — Meshly" }] }),
});
