import { create } from 'zustand'
import { SamchatState, ConversationSummary, ChatMessage } from '../types/samchat'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface SamchatStore extends SamchatState {
  setConversations: (conversations: ConversationSummary[]) => void;
  setCurrentConversation: (conversationId: string, messages: ChatMessage[]) => void;
  clearCurrentConversation: () => void;
  addMessageToCurrentConversation: (message: ChatMessage) => void;
  setMyNodeId: (nodeId: string) => void;
  get: () => SamchatStore;
  set: (partial: SamchatStore | Partial<SamchatStore>) => void;
}

const useSamchatStore = create<SamchatStore>()( 
  persist(
    (set, get) => ({
      conversations: [],
      currentConversationId: null,
      currentConversationMessages: [],
      myNodeId: null,
      
      setConversations: (newConversations: ConversationSummary[]) => {
        set({ conversations: newConversations });
      },
      
      setCurrentConversation: (conversationId: string, messages: ChatMessage[]) => {
        set({ 
          currentConversationId: conversationId,
          currentConversationMessages: messages 
        });
      },
      
      clearCurrentConversation: () => {
        set({ 
          currentConversationId: null,
          currentConversationMessages: [] 
        });
      },
      
      addMessageToCurrentConversation: (message: ChatMessage) => {
        const currentMessages = get().currentConversationMessages;
        // Check if message already exists (avoid duplicates)
        if (!currentMessages.some(m => m.id === message.id)) {
          set({
            currentConversationMessages: [...currentMessages, message].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            )
          });
        }
      },
      
      setMyNodeId: (nodeId: string) => {
        set({ myNodeId: nodeId });
      },
      
      get,
      set,
    }),
    {
      name: 'samchat-store',
      storage: createJSONStorage(() => sessionStorage), 
    }
  )
)

export default useSamchatStore;