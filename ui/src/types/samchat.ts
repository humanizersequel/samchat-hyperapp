// File info structure
export interface FileInfo {
  file_name: string;
  file_size: number;
  mime_type: string;
  file_id: string;
  sender_node: string;
}

// Reply info structure
export interface MessageReplyInfo {
  message_id: string;
  sender: string;
  content: string; // Preview of the replied message
}

// Chat message structure
export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender: string;
  recipient?: string; // Optional for group messages
  recipients?: string[]; // Recipients for group messages
  content: string;
  timestamp: string; // ISO string representation of DateTime<Utc>
  delivered: boolean;
  file_info?: FileInfo; // Optional file attachment
  reply_to?: MessageReplyInfo; // Optional reply reference
}

// Conversation structure
export interface Conversation {
  id: string;
  participants: string[];
  messages: ChatMessage[];
  last_updated: string; // ISO string representation of DateTime<Utc>
  is_group: boolean;
  group_name?: string;
  created_by?: string;
}

// Conversation summary for list display
export interface ConversationSummary {
  id: string;
  participants: string[];
  last_updated: string; // ISO string representation of DateTime<Utc>
  is_group: boolean;
  group_name?: string;
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

// Request body for the create_group endpoint
export interface CreateGroupRequest {
  CreateGroup: [string, string[]]; // group_name, initial_members
}

// Response type for the create_group endpoint
export type CreateGroupResponse = RustResponse<string>; // Returns group ID

// Request body for the add_group_member endpoint
export interface AddGroupMemberRequest {
  AddGroupMember: [string, string]; // group_id, new_member
}

// Response type for the add_group_member endpoint
export type AddGroupMemberResponse = RustResponse<boolean>;

// Request body for the upload_file endpoint
export interface UploadFileRequest {
  UploadFile: [string, string, number[]]; // file_name, mime_type, file_data
}

// Response type for the upload_file endpoint
export type UploadFileResponse = RustResponse<FileInfo>;

// Request body for the download_file endpoint
export interface DownloadFileRequest {
  DownloadFile: [string, string]; // file_id, sender_node
}

// Response type for the download_file endpoint
export type DownloadFileResponse = RustResponse<number[]>; // file bytes

// Request body for the send_file_message endpoint
export interface SendFileMessageRequest {
  SendFileMessage: [string, string, FileInfo]; // recipient_address, message_content, file_info
}

// Response type for the send_file_message endpoint
export type SendFileMessageResponse = RustResponse<boolean>;

// Request body for the send_message_with_reply endpoint
export interface SendMessageWithReplyRequest {
  SendMessageWithReply: [string, string, MessageReplyInfo | null]; // recipient_address, message_content, reply_info
}

// Response type for the send_message_with_reply endpoint
export type SendMessageWithReplyResponse = RustResponse<boolean>;

