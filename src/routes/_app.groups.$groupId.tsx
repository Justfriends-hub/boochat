import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/ChatView";

export const Route = createFileRoute("/_app/groups/$groupId")({
  component: GroupChat,
});

function GroupChat() {
  const { groupId } = Route.useParams();

  return (
    <div className="relative flex flex-1 flex-col h-full min-h-0 overflow-hidden">
      <ChatView chatId={groupId} />
    </div>
  );
}
