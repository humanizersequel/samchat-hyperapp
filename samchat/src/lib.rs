use hyperprocess_macro::hyperprocess;
use hyperware_process_lib::{our, Address, Request, ProcessId, homepage::add_to_homepage};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::{DateTime, Utc};
use std::collections::HashMap;


// --- Chat Message ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    id: String, // Unique message ID (e.g., UUID)
    conversation_id: String, // Identifier for the chat thread (e.g., sorted participants)
    sender: String, // Sender's full address (e.g., "myname.os")
    recipient: String, // Recipient's full address (e.g., "theirname.os")
    content: String, // The message text
    timestamp: String, // Time the message was sent/received as RFC3339 string for WIT compatibility
    delivered: bool, // Track delivery status
}

// --- Conversation ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct Conversation {
    id: String, // Unique ID for the conversation (e.g., sorted participants)
    participants: Vec<String>, // List of node addresses involved
    messages: Vec<ChatMessage>, // Chronological list of messages in this conversation
    last_updated: String, // Last update time as RFC3339 string for WIT compatibility
}

// --- Conversation Summary for UI ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConversationSummary {
    id: String,
    participants: Vec<String>,
    last_updated: String, // Last update time as RFC3339 string for WIT compatibility
}

// --- Request/Response Types ---
#[derive(Serialize, Deserialize, Debug)]
enum RequestType {
    ReceiveMessage(ChatMessage),
}

#[derive(Serialize, Deserialize, Debug)]
enum ResponseType {
    Ack,
}

// --- State ---
#[derive(PartialEq, Clone, Default, Debug, Serialize, Deserialize)]
pub struct SamchatState {
    // Store conversations keyed by a unique conversation ID
    conversations: HashMap<String, Conversation>,
    // Store own node ID after initialization
    my_node_id: Option<String>,
}

const ICON: &str = include_str!("icon");

// --- Hyperware Process ---
#[hyperprocess(
    name = "samchat",
    ui = Some(HttpBindingConfig::default()),
    endpoints = vec![
        Binding::Http {
            path: "/api",
            config: HttpBindingConfig::new(false, false, false, None),
        },
        Binding::Ws {
            path: "/ws",
            config: WsBindingConfig::new(false, false, false),
        }
    ],
    save_config = SaveOptions::EveryMessage,
    wit_world = "samchat-template-dot-os-v0"
)]

// --- Hyperware Process API definitions ---
impl SamchatState {
    #[init]
    async fn initialize(&mut self) {
        println!("Initializing Samchat state...");
        self.conversations = HashMap::new();
        self.my_node_id = Some(our().node.clone()); // Store own node ID
        println!("Samchat initialized for node: {:?}", self.my_node_id);

        add_to_homepage("SamChat", Some(ICON), Some(""), None);
    }

    // Send a message to another user
    #[http]
    async fn send_message(&mut self, recipient_address: String, message_content: String) -> Result<bool, String> {
        println!("send_message called: to={}, content='{}'", recipient_address, message_content);
        let sender_address = self.my_node_id.clone().ok_or_else(|| "Sender node ID not initialized".to_string())?;

        // Basic validation
        if recipient_address.trim().is_empty() || message_content.trim().is_empty() {
            return Err("Recipient address and message content cannot be empty".to_string());
        }
        if !recipient_address.contains('.') { // Basic check for address format
            return Err("Invalid recipient address format (e.g., 'username.os')".to_string());
        }

        // Create Conversation ID (simple example: sorted participants)
        let mut participants = vec![sender_address.clone(), recipient_address.clone()];
        participants.sort();
        let conversation_id = participants.join("|");

        // Convert current time to RFC3339 string once for reuse
        let current_time_str = Utc::now().to_rfc3339();

        // Create the message
        let message = ChatMessage {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.clone(),
            sender: sender_address.clone(),
            recipient: recipient_address.clone(),
            content: message_content,
            timestamp: current_time_str.clone(), // Use RFC3339 string for WIT compatibility
            delivered: false, // Mark as not delivered initially
        };

        // Persist locally *before* sending
        let conversation = self.conversations.entry(conversation_id.clone()).or_insert_with(|| Conversation {
            id: conversation_id.clone(),
            participants: participants.clone(),
            messages: Vec::new(),
            last_updated: current_time_str.clone(), // Use RFC3339 string for WIT compatibility
        });
        conversation.messages.push(message.clone());
        conversation.last_updated = current_time_str.clone(); // Use RFC3339 string for WIT compatibility
        println!("Message persisted locally: {}", message.id);

        // Construct target address
        // Hardcoding the publisher as template.os for now as per the instructions
        // In a real app, you'd get this dynamically from metadata
        let publisher = "hpn-testing-beta.os";
        let target_process_id_str = format!("samchat:samchat:{}", publisher);
        let target_process_id = target_process_id_str.parse::<ProcessId>()
            .map_err(|e| format!("Failed to parse ProcessId: {}", e))?;
        let target_address = Address::new(recipient_address.clone(), target_process_id);

        // Prepare and send the request (fire-and-forget)
        let request_body = serde_json::to_vec(&RequestType::ReceiveMessage(message.clone()))
            .map_err(|e| format!("Serialization error: {}", e))?;

        println!("Sending message {} to {}", message.id, target_address);
        let send_result = Request::new()
            .target(target_address)
            .body(request_body)
            .send();

        match send_result {
            Ok(_) => {
                println!("Message {} sent successfully (no response expected).", message.id);
                Ok(true)
            },
            Err(e) => {
                let error_msg = format!("Failed to send message {}: {:?}", message.id, e);
                println!("{}", error_msg);
                Err(error_msg)
            }
        }
    }

    // Receive a message from another user
    #[remote]
    async fn receive_message(&mut self, message: ChatMessage) -> Result<bool, String> {
        println!("receive_message called: from={}, content='{}'", message.sender, message.content);

        let conversation_id = message.conversation_id.clone();
        
        // Current time as RFC3339 string
        let current_time_str = Utc::now().to_rfc3339();

         // Persist received message
        let conversation = self.conversations.entry(conversation_id.clone()).or_insert_with(|| {
             // If conversation doesn't exist, create it based on message participants
             let mut participants = vec![message.sender.clone(), message.recipient.clone()];
             participants.sort();
             Conversation {
                id: conversation_id.clone(),
                participants: participants,
                messages: Vec::new(),
                last_updated: message.timestamp.clone(), // Use message timestamp string initially
            }
        });

        // Avoid adding duplicates (simple check based on ID)
        if !conversation.messages.iter().any(|m| m.id == message.id) {
            conversation.messages.push(message.clone());
            // Sort messages after adding to ensure chronological order
            // Lexicographical sort works for RFC3339 timestamp strings
            conversation.messages.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
            conversation.last_updated = current_time_str; // Update with current time string
            println!("Message {} received and persisted.", message.id);
        } else {
             println!("Duplicate message {} received, ignoring.", message.id);
        }

        // No explicit response needed for fire-and-forget remote calls generally.
        Ok(true)
    }

    // Get all conversations
    #[http]
    async fn get_conversations(&self, request_body: String) -> Result<Vec<ConversationSummary>, String> {
         println!("get_conversations called");
         let summaries: Vec<ConversationSummary> = self.conversations.values()
            .map(|conv| ConversationSummary {
                id: conv.id.clone(),
                participants: conv.participants.clone(),
                last_updated: conv.last_updated.clone(), // Already a string
            })
            .collect();
        
        // Sort summaries by last_updated (newest first)
        // Reverse lexicographical sort for RFC3339 strings puts newest first
        let mut sorted_summaries = summaries;
        sorted_summaries.sort_by(|a, b| b.last_updated.cmp(&a.last_updated));
        
        Ok(sorted_summaries)
    }

    // Get all messages for a specific conversation
    #[http]
    async fn get_messages(&self, conversation_id: String) -> Result<Vec<ChatMessage>, String> {
         println!("get_messages called for conversation: {}", conversation_id);
         match self.conversations.get(&conversation_id) {
             Some(conversation) => Ok(conversation.messages.clone()),
             None => Err(format!("Conversation with ID {} not found", conversation_id)),
         }
    }
}
