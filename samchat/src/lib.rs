use hyperprocess_macro::hyperprocess;
use hyperware_process_lib::{our, Address, Request, ProcessId, homepage::add_to_homepage, LazyLoadBlob};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use chrono::Utc;
use std::collections::HashMap;
use serde_json::json;


// --- Chat Message ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct ChatMessage {
    id: String, // Unique message ID (e.g., UUID)
    conversation_id: String, // Identifier for the chat thread
    sender: String, // Sender's full address (e.g., "myname.os")
    recipient: Option<String>, // Recipient's full address for direct messages
    recipients: Option<Vec<String>>, // Recipients for group messages
    content: String, // The message text
    timestamp: String, // Time the message was sent/received as RFC3339 string for WIT compatibility
    delivered: bool, // Track delivery status
    file_info: Option<FileInfo>, // Optional file attachment info
}

// --- File Info ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct FileInfo {
    file_name: String,
    file_size: u64,
    mime_type: String,
    file_id: String, // Unique ID for the file in VFS
    sender_node: String, // Node that has the file
}

// --- Conversation ---
#[derive(PartialEq, Clone, Debug, Serialize, Deserialize)]
pub struct Conversation {
    id: String, // Unique ID for the conversation
    participants: Vec<String>, // List of node addresses involved
    messages: Vec<ChatMessage>, // Chronological list of messages in this conversation
    last_updated: String, // Last update time as RFC3339 string for WIT compatibility
    is_group: bool, // Whether this is a group conversation
    group_name: Option<String>, // Name of the group (if it's a group)
    created_by: Option<String>, // Creator of the group (if it's a group)
}

// --- Conversation Summary for UI ---
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ConversationSummary {
    id: String,
    participants: Vec<String>,
    last_updated: String, // Last update time as RFC3339 string for WIT compatibility
    is_group: bool,
    group_name: Option<String>,
}

// --- Request/Response Types ---
#[derive(Serialize, Deserialize, Debug)]
pub struct GroupJoinNotification {
    group_id: String,
    group_name: String,
    participants: Vec<String>,
    created_by: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct GroupLeaveNotification {
    group_id: String,
    member: String,
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

    // Upload a file and store it in VFS
    #[http]
    async fn upload_file(&mut self, file_name: String, mime_type: String, file_data: Vec<u8>) -> Result<FileInfo, String> {
        println!("upload_file called: name={}, type={}, size={}", file_name, mime_type, file_data.len());
        
        let file_id = Uuid::new_v4().to_string();
        let file_path = format!("/samchat:hpn-testing-beta.os/files/{}", file_id);
        let file_size = file_data.len() as u64;
        
        // Create VFS request to write file
        let vfs_address = Address::new(our().node.clone(), "vfs:distro:sys".parse::<ProcessId>().unwrap());
        
        // First create the directory if it doesn't exist
        let create_dir_request = json!({
            "path": "/samchat:hpn-testing-beta.os/files",
            "action": "CreateDirAll"
        });
        
        let dir_result = Request::new()
            .target(vfs_address.clone())
            .body(serde_json::to_vec(&create_dir_request).unwrap())
            .expects_response(5)
            .send_and_await_response(5).unwrap();
            
        if let Err(e) = dir_result {
            println!("Failed to create directory: {:?}", e);
            // Continue anyway, directory might already exist
        }
        
        // Write the file
        let write_request = json!({
            "path": file_path,
            "action": "Write"
        });
        
        let write_result = Request::new()
            .target(vfs_address)
            .body(serde_json::to_vec(&write_request).unwrap())
            .blob(LazyLoadBlob::new(Some("file"), file_data))
            .expects_response(5)
            .send_and_await_response(5).unwrap();
        
        match write_result {
            Ok(_) => {
                println!("File {} uploaded successfully", file_id);
                Ok(FileInfo {
                    file_name,
                    file_size,
                    mime_type,
                    file_id,
                    sender_node: our().node.clone(),
                })
            },
            Err(e) => {
                println!("Failed to upload file: {:?}", e);
                Err(format!("Failed to upload file: {:?}", e))
            }
        }
    }
    
    // Get file from remote node (called by other nodes)
    #[remote]
    async fn get_remote_file(&self, file_id: String) -> Result<Vec<u8>, String> {
        println!("get_remote_file called: id={}", file_id);
        
        let file_path = format!("/samchat:hpn-testing-beta.os/files/{}", file_id);
        let vfs_address = Address::new(our().node.clone(), "vfs:distro:sys".parse::<ProcessId>().unwrap());
        
        let read_request = json!({
            "path": file_path,
            "action": "Read"
        });
        
        let read_result = Request::new()
            .target(vfs_address)
            .body(serde_json::to_vec(&read_request).unwrap())
            .expects_response(5)
            .send_and_await_response(5).unwrap();
        
        match read_result {
            Ok(response) => {
                if let Some(blob) = response.blob() {
                    Ok(blob.bytes)
                } else {
                    Err("No file data in response".to_string())
                }
            },
            Err(e) => {
                println!("Failed to read file locally: {:?}", e);
                Err(format!("File not found: {:?}", e))
            }
        }
    }

    // Download a file (tries local first, then remote)
    #[http]
    async fn download_file(&mut self, file_id: String, sender_node: String) -> Result<Vec<u8>, String> {
        println!("download_file called: id={}, sender={}", file_id, sender_node);
        
        let file_path = format!("/samchat:hpn-testing-beta.os/files/{}", file_id);
        let vfs_address = Address::new(our().node.clone(), "vfs:distro:sys".parse::<ProcessId>().unwrap());
        
        // First try to read locally
        let read_request = json!({
            "path": file_path.clone(),
            "action": "Read"
        });
        
        let local_result = Request::new()
            .target(vfs_address.clone())
            .body(serde_json::to_vec(&read_request).unwrap())
            .expects_response(5)
            .send_and_await_response(5).unwrap();
        
        match local_result {
            Ok(response) => {
                if let Some(blob) = response.blob() {
                    println!("File found locally");
                    return Ok(blob.bytes);
                }
            },
            Err(_) => {
                println!("File not found locally, fetching from remote node");
            }
        }
        
        // If not found locally and sender is different node, fetch from remote
        if sender_node != our().node {
            let publisher = "hpn-testing-beta.os";
            let target_process_id_str = format!("samchat:samchat:{}", publisher);
            let target_process_id = target_process_id_str.parse::<ProcessId>()
                .map_err(|e| format!("Failed to parse ProcessId: {}", e))?;
            
            let target_address = Address::new(sender_node.clone(), target_process_id);
            let request_wrapper = json!({
                "GetRemoteFile": file_id.clone()
            });
            
            let remote_result = Request::new()
                .target(target_address)
                .body(serde_json::to_vec(&request_wrapper).unwrap())
                .expects_response(30)
                .send_and_await_response(30).unwrap();
            
            match remote_result {
                Ok(response) => {
                    // Parse the response to get the file data
                    let response_json: serde_json::Value = serde_json::from_slice(&response.body())
                        .map_err(|e| format!("Failed to parse response: {}", e))?;
                    
                    if let Some(file_data_json) = response_json.get("Ok") {
                        let file_data: Vec<u8> = serde_json::from_value(file_data_json.clone())
                            .map_err(|e| format!("Failed to parse file data: {}", e))?;
                        
                        // Save to local VFS for future use
                        // First ensure directory exists
                        let create_dir_request = json!({
                            "path": "/samchat:hpn-testing-beta.os/files",
                            "action": "CreateDirAll"
                        });
                        
                        let _ = Request::new()
                            .target(vfs_address.clone())
                            .body(serde_json::to_vec(&create_dir_request).unwrap())
                            .expects_response(5)
                            .send_and_await_response(5).unwrap();
                        
                        // Now write the file
                        let write_request = json!({
                            "path": file_path,
                            "action": "Write"
                        });
                        
                        let _ = Request::new()
                            .target(vfs_address)
                            .body(serde_json::to_vec(&write_request).unwrap())
                            .blob(LazyLoadBlob::new(Some("file"), file_data.clone()))
                            .expects_response(5)
                            .send_and_await_response(5).unwrap();
                        
                        println!("File fetched from remote and cached locally");
                        return Ok(file_data);
                    } else if let Some(err) = response_json.get("Err") {
                        return Err(format!("Remote error: {}", err));
                    }
                },
                Err(e) => {
                    println!("Failed to fetch from remote: {:?}", e);
                    return Err(format!("Failed to fetch file from remote node: {:?}", e));
                }
            }
        }
        
        Err("File not found".to_string())
    }

    // Send a file message
    #[http]
    async fn send_file_message(&mut self, recipient_address: String, message_content: String, file_info: FileInfo) -> Result<bool, String> {
        println!("send_file_message called: to={}, file={}", recipient_address, file_info.file_name);
        let sender_address = self.my_node_id.clone().ok_or_else(|| "Sender node ID not initialized".to_string())?;

        // Check if this is a group conversation
        let is_group = recipient_address.starts_with("group_");
        
        let conversation_id: String;
        let recipients: Vec<String>;
        
        if is_group {
            conversation_id = recipient_address.clone();
            let conversation = self.conversations.get(&conversation_id)
                .ok_or_else(|| "Group conversation not found".to_string())?;
            recipients = conversation.participants.iter()
                .filter(|p| *p != &sender_address)
                .cloned()
                .collect();
        } else {
            let mut participants = vec![sender_address.clone(), recipient_address.clone()];
            participants.sort();
            conversation_id = participants.join("|");
            recipients = vec![recipient_address.clone()];
        }

        let current_time_str = Utc::now().to_rfc3339();

        // Create the message with file info
        let message = ChatMessage {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.clone(),
            sender: sender_address.clone(),
            recipient: if is_group { None } else { Some(recipient_address.clone()) },
            recipients: if is_group { Some(recipients.clone()) } else { None },
            content: message_content,
            timestamp: current_time_str.clone(),
            delivered: false,
            file_info: Some(file_info),
        };

        // Persist locally
        if !is_group {
            let conversation = self.conversations.entry(conversation_id.clone()).or_insert_with(|| {
                let mut participants = vec![sender_address.clone(), recipient_address.clone()];
                participants.sort();
                Conversation {
                    id: conversation_id.clone(),
                    participants: participants.clone(),
                    messages: Vec::new(),
                    last_updated: current_time_str.clone(),
                    is_group: false,
                    group_name: None,
                    created_by: None,
                }
            });
            conversation.messages.push(message.clone());
            conversation.last_updated = current_time_str.clone();
        } else {
            let conversation = self.conversations.get_mut(&conversation_id)
                .ok_or_else(|| "Group conversation not found".to_string())?;
            conversation.messages.push(message.clone());
            conversation.last_updated = current_time_str.clone();
        }

        // Send to recipients
        let publisher = "hpn-testing-beta.os";
        let target_process_id_str = format!("samchat:samchat:{}", publisher);
        let target_process_id = target_process_id_str.parse::<ProcessId>()
            .map_err(|e| format!("Failed to parse ProcessId: {}", e))?;
        
        for recipient in recipients {
            let target_address = Address::new(recipient.clone(), target_process_id.clone());
            let request_wrapper = serde_json::json!({
                "ReceiveMessage": message.clone()
            });
            let request_body = serde_json::to_vec(&request_wrapper)
                .map_err(|e| format!("Serialization error: {}", e))?;

            let _ = Request::new()
                .target(target_address)
                .body(request_body)
                .expects_response(30)
                .send();
        }
        
        Ok(true)
    }

    // Send a message to another user or group
    #[http]
    async fn send_message(&mut self, recipient_address: String, message_content: String) -> Result<bool, String> {
        println!("send_message called: to={}, content='{}'", recipient_address, message_content);
        let sender_address = self.my_node_id.clone().ok_or_else(|| "Sender node ID not initialized".to_string())?;

        // Basic validation
        if recipient_address.trim().is_empty() || message_content.trim().is_empty() {
            return Err("Recipient address and message content cannot be empty".to_string());
        }
        
        // Check if this is a group conversation (group IDs start with "group_")
        let is_group = recipient_address.starts_with("group_");
        
        if !is_group && !recipient_address.contains('.') { // Basic check for address format
            return Err("Invalid recipient address format (e.g., 'username.os')".to_string());
        }

        let conversation_id: String;
        let recipients: Vec<String>;
        
        if is_group {
            // For group messages, the recipient_address is the group ID
            conversation_id = recipient_address.clone();
            
            // Get all participants except sender
            let conversation = self.conversations.get(&conversation_id)
                .ok_or_else(|| "Group conversation not found".to_string())?;
            recipients = conversation.participants.iter()
                .filter(|p| *p != &sender_address)
                .cloned()
                .collect();
        } else {
            // For direct messages
            let mut participants = vec![sender_address.clone(), recipient_address.clone()];
            participants.sort();
            conversation_id = participants.join("|");
            recipients = vec![recipient_address.clone()];
        }

        // Convert current time to RFC3339 string once for reuse
        let current_time_str = Utc::now().to_rfc3339();

        // Create the message
        let message = ChatMessage {
            id: Uuid::new_v4().to_string(),
            conversation_id: conversation_id.clone(),
            sender: sender_address.clone(),
            recipient: if is_group { None } else { Some(recipient_address.clone()) },
            recipients: if is_group { Some(recipients.clone()) } else { None },
            content: message_content,
            timestamp: current_time_str.clone(),
            delivered: false,
            file_info: None,
        };

        // Persist locally *before* sending
        if !is_group {
            // Create conversation if it doesn't exist (for direct messages)
            let conversation = self.conversations.entry(conversation_id.clone()).or_insert_with(|| {
                let mut participants = vec![sender_address.clone(), recipient_address.clone()];
                participants.sort();
                Conversation {
                    id: conversation_id.clone(),
                    participants: participants.clone(),
                    messages: Vec::new(),
                    last_updated: current_time_str.clone(),
                    is_group: false,
                    group_name: None,
                    created_by: None,
                }
            });
            conversation.messages.push(message.clone());
            conversation.last_updated = current_time_str.clone();
        } else {
            // For group messages, conversation should already exist
            let conversation = self.conversations.get_mut(&conversation_id)
                .ok_or_else(|| "Group conversation not found".to_string())?;
            conversation.messages.push(message.clone());
            conversation.last_updated = current_time_str.clone();
        }
        println!("Message persisted locally: {}", message.id);

        // Send message to all recipients
        let publisher = "hpn-testing-beta.os";
        let target_process_id_str = format!("samchat:samchat:{}", publisher);
        let target_process_id = target_process_id_str.parse::<ProcessId>()
            .map_err(|e| format!("Failed to parse ProcessId: {}", e))?;
        
        // Send to each recipient
        for recipient in recipients {
            let target_address = Address::new(recipient.clone(), target_process_id.clone());
            // Wrap the message in the expected request format
            let request_wrapper = serde_json::json!({
                "ReceiveMessage": message.clone()
            });
            let request_body = serde_json::to_vec(&request_wrapper)
                .map_err(|e| format!("Serialization error: {}", e))?;

            println!("Sending message {} to {}", message.id, target_address);
            let send_result = Request::new()
                .target(target_address)
                .body(request_body)
                .expects_response(30)
                .send();

            match send_result {
                Ok(_) => {
                    println!("Message {} sent successfully to {}.", message.id, recipient);
                },
                Err(e) => {
                    println!("Failed to send message {} to {}: {:?}", message.id, recipient, e);
                    // Continue sending to other recipients even if one fails
                }
            }
        }
        
        Ok(true)
    }

    // Create a new group chat
    #[http]
    async fn create_group(&mut self, group_name: String, initial_members: Vec<String>) -> Result<String, String> {
        println!("create_group called: name={}, members={:?}", group_name, initial_members);
        
        let creator = self.my_node_id.clone().ok_or_else(|| "Creator node ID not initialized".to_string())?;
        
        // Validate group name
        if group_name.trim().is_empty() {
            return Err("Group name cannot be empty".to_string());
        }
        
        // Ensure creator is included in participants
        let mut participants = initial_members;
        if !participants.contains(&creator) {
            participants.push(creator.clone());
        }
        
        // Validate we have at least 2 participants
        if participants.len() < 2 {
            return Err("Group must have at least 2 participants".to_string());
        }
        
        // Generate unique group ID
        let group_id = format!("group_{}", Uuid::new_v4());
        let current_time_str = Utc::now().to_rfc3339();
        
        // Create the group conversation locally
        let conversation = Conversation {
            id: group_id.clone(),
            participants: participants.clone(),
            messages: Vec::new(),
            last_updated: current_time_str.clone(),
            is_group: true,
            group_name: Some(group_name.clone()),
            created_by: Some(creator.clone()),
        };
        
        self.conversations.insert(group_id.clone(), conversation);
        println!("Group created locally: {}", group_id);
        
        // Notify all other members about the new group
        let publisher = "hpn-testing-beta.os";
        let target_process_id_str = format!("samchat:samchat:{}", publisher);
        let target_process_id = target_process_id_str.parse::<ProcessId>()
            .map_err(|e| format!("Failed to parse ProcessId: {}", e))?;
        
        for participant in &participants {
            if participant != &creator {
                let target_address = Address::new(participant.clone(), target_process_id.clone());
                let notification = GroupJoinNotification {
                    group_id: group_id.clone(),
                    group_name: group_name.clone(),
                    participants: participants.clone(),
                    created_by: creator.clone(),
                };
                let request_wrapper = serde_json::json!({
                    "HandleGroupJoin": notification
                });
                let request_body = serde_json::to_vec(&request_wrapper)
                    .map_err(|e| format!("Serialization error: {}", e))?;
                
                println!("Notifying {} about new group {}", participant, group_id);
                // Use expects_response for remote calls
                let _ = Request::new()
                    .target(target_address)
                    .body(request_body)
                    .expects_response(30)
                    .send();
            }
        }
        
        Ok(group_id)
    }
    
    // Add member to existing group
    #[http]
    async fn add_group_member(&mut self, group_id: String, new_member: String) -> Result<bool, String> {
        println!("add_group_member called: group={}, member={}", group_id, new_member);
        
        let _requester = self.my_node_id.clone().ok_or_else(|| "Requester node ID not initialized".to_string())?;
        
        // Get the group conversation
        let conversation = self.conversations.get_mut(&group_id)
            .ok_or_else(|| "Group not found".to_string())?;
        
        if !conversation.is_group {
            return Err("Not a group conversation".to_string());
        }
        
        // Check if member already exists
        if conversation.participants.contains(&new_member) {
            return Err("Member already in group".to_string());
        }
        
        // Add the new member
        conversation.participants.push(new_member.clone());
        conversation.last_updated = Utc::now().to_rfc3339();
        
        // Notify the new member about the group
        let publisher = "hpn-testing-beta.os";
        let target_process_id_str = format!("samchat:samchat:{}", publisher);
        let target_process_id = target_process_id_str.parse::<ProcessId>()
            .map_err(|e| format!("Failed to parse ProcessId: {}", e))?;
        
        let target_address = Address::new(new_member.clone(), target_process_id);
        let notification = GroupJoinNotification {
            group_id: group_id.clone(),
            group_name: conversation.group_name.clone().unwrap_or_default(),
            participants: conversation.participants.clone(),
            created_by: conversation.created_by.clone().unwrap_or_default(),
        };
        let request_wrapper = serde_json::json!({
            "HandleGroupJoin": notification
        });
        let request_body = serde_json::to_vec(&request_wrapper)
            .map_err(|e| format!("Serialization error: {}", e))?;
        
        let _ = Request::new()
            .target(target_address)
            .body(request_body)
            .expects_response(30)
            .send();
        
        Ok(true)
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
            // If conversation doesn't exist, create it based on message
            if message.recipients.is_some() {
                // This is a group message, but we don't have the group info
                // This shouldn't happen in normal flow, but handle it gracefully
                Conversation {
                    id: conversation_id.clone(),
                    participants: vec![message.sender.clone()], // Add more as we discover them
                    messages: Vec::new(),
                    last_updated: message.timestamp.clone(),
                    is_group: true,
                    group_name: None,
                    created_by: None,
                }
            } else {
                // Direct message
                let mut participants = vec![message.sender.clone(), message.recipient.clone().unwrap_or_default()];
                participants.sort();
                Conversation {
                    id: conversation_id.clone(),
                    participants: participants,
                    messages: Vec::new(),
                    last_updated: message.timestamp.clone(),
                    is_group: false,
                    group_name: None,
                    created_by: None,
                }
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
    
    // Handle group join notification
    #[remote]
    async fn handle_group_join(&mut self, notification: GroupJoinNotification) -> Result<bool, String> {
        println!("Received group join notification for group: {}", notification.group_id);
        
        let current_time_str = Utc::now().to_rfc3339();
        
        // Create or update the group conversation
        let conversation = Conversation {
            id: notification.group_id.clone(),
            participants: notification.participants,
            messages: Vec::new(),
            last_updated: current_time_str,
            is_group: true,
            group_name: Some(notification.group_name),
            created_by: Some(notification.created_by),
        };
        
        self.conversations.insert(notification.group_id, conversation);
        Ok(true)
    }
    
    // Handle group leave notification
    #[remote]
    async fn handle_group_leave(&mut self, notification: GroupLeaveNotification) -> Result<bool, String> {
        println!("Received group leave notification for group: {}, member: {}", notification.group_id, notification.member);
        
        if let Some(conversation) = self.conversations.get_mut(&notification.group_id) {
            conversation.participants.retain(|p| p != &notification.member);
            conversation.last_updated = Utc::now().to_rfc3339();
        }
        Ok(true)
    }

    // Get all conversations
    #[http]
    async fn get_conversations(&self, _request_body: String) -> Result<Vec<ConversationSummary>, String> {
         println!("get_conversations called");
         let summaries: Vec<ConversationSummary> = self.conversations.values()
            .map(|conv| ConversationSummary {
                id: conv.id.clone(),
                participants: conv.participants.clone(),
                last_updated: conv.last_updated.clone(), // Already a string
                is_group: conv.is_group,
                group_name: conv.group_name.clone(),
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
