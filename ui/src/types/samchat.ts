// Chat message structure
export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender: string;
  recipient: string;
  content: string;
  timestamp: string; // ISO string representation of DateTime<Utc>
  delivered: boolean;
}

// Conversation structure
export interface Conversation {
  id: string;
  participants: string[];
  messages: ChatMessage[];
  last_updated: string; // ISO string representation of DateTime<Utc>
}

// Conversation summary for list display
export interface ConversationSummary {
  id: string;
  participants: string[];
  last_updated: string; // ISO string representation of DateTime<Utc>
}

// Define the type for the state managed by the Zustand store
export interface SamchatState {
  conversations: ConversationSummary[];
  currentConversationId: string | null;
  currentConversationMessages: ChatMessage[];
  myNodeId: string | null;
}

// --- Request Types ---

// Request body for the send_message endpoint
export interface SendMessageRequest {
  SendMessage: [string, string]; // recipient_address, message_content
}

// Request body for the get_conversations endpoint
export interface GetConversationsRequest {
  GetConversations: string; // Empty string as per the Rust backend
}

// Request body for the get_messages endpoint
export interface GetMessagesRequest {
  GetMessages: string; // Conversation ID
}

// --- Response Types ---
// Generic response wrapper for Rust Result<T, E> where E is String
interface RustResponse<T> {
  Ok?: T;
  Err?: string;
}

// Response type for the send_message endpoint
export type SendMessageResponse = RustResponse<null>;

// Response type for the get_conversations endpoint
export type GetConversationsResponse = RustResponse<ConversationSummary[]>;

// Response type for the get_messages endpoint
export type GetMessagesResponse = RustResponse<ChatMessage[]>;

