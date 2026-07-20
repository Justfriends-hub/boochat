import { createFileRoute } from "@tanstack/react-router";
import { ChatView } from "@/components/ChatView";

export const Route = createFileRoute("/_app/chats/$chatId")({
  component: () => {
    const { chatId } = Route.useParams();
    return <ChatView chatId={chatId} />;
  },
});
