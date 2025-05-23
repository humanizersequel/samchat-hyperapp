import { useState, useEffect, useCallback, useRef } from "react";
import HyperwareClientApi from "@hyperware-ai/client-api";
import "./App.css";
import useSamchatStore from "./store/samchat";
import { 
  ChatMessage,
  ConversationSummary,
  SendMessageRequest,
  GetConversationsRequest,
  GetMessagesRequest,
  SendMessageResponse,
  GetConversationsResponse,
  GetMessagesResponse,
  CreateGroupRequest,
  CreateGroupResponse,
  AddGroupMemberRequest,
  AddGroupMemberResponse,
  UploadFileRequest,
  UploadFileResponse,
  DownloadFileRequest,
  DownloadFileResponse,
  SendFileMessageRequest,
  SendFileMessageResponse,
  FileInfo
} from "./types/samchat";

// Constants for the Hyperware environment
const BASE_URL = import.meta.env.BASE_URL;
if (window.our) window.our.process = BASE_URL?.replace("/", "");

const PROXY_TARGET = `${(import.meta.env.VITE_NODE_URL || "http://localhost:8080")}${BASE_URL}`;

// For WebSocket connection
const WEBSOCKET_URL = import.meta.env.DEV
  ? `${PROXY_TARGET.replace('http', 'ws')}/ws`
  : undefined;

// Polling interval for fetching conversations (in ms)
const POLLING_INTERVAL = 5000;

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  
  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function App() {
  // State from the Zustand store
  const { 
    conversations, 
    currentConversationId, 
    currentConversationMessages, 
    myNodeId,
    setConversations, 
    setCurrentConversation, 
    clearCurrentConversation,
    addMessageToCurrentConversation,
    setMyNodeId
  } = useSamchatStore();
  
  // Local state
  const [nodeConnected, setNodeConnected] = useState(true);
  const [_api, setApi] = useState<HyperwareClientApi | undefined>();
  const [messageText, setMessageText] = useState("");
  const [newRecipient, setNewRecipient] = useState("");
  const [isCreatingNewChat, setIsCreatingNewChat] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState("");
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberAddress, setNewMemberAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Record<string, string>>({}); // file_id -> data URL
  const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set()); // file_ids being loaded
  const messageListRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Scroll messages to bottom when new messages arrive
  useEffect(() => {
    if (messageListRef.current) {
      messageListRef.current.scrollTop = messageListRef.current.scrollHeight;
    }
  }, [currentConversationMessages]);

  // Fetch all conversations from the backend
  const fetchConversations = useCallback(async () => {
    const requestData: GetConversationsRequest = { GetConversations: "" };

    try {
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData), 
      });

      if (!result.ok) {
        const errorText = await result.text();
        console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as GetConversationsResponse; 
      
      if (responseData.Ok) {
        console.log("Fetched conversations:", responseData.Ok); 
        setConversations(responseData.Ok);
        
        // If we're currently looking at a conversation, also update its messages
        if (currentConversationId) {
          fetchMessages(currentConversationId);
        }
      } else {
        console.error("Error fetching conversations:", responseData.Err || "Unknown error"); 
        setConversations([]);
      }
    } catch (error) {
      console.error("Failed to fetch conversations:", error);
      setConversations([]);
    }
  }, [setConversations, currentConversationId]);

  // Fetch messages for a specific conversation
  const fetchMessages = useCallback(async (conversationId: string) => {
    const requestData: GetMessagesRequest = { GetMessages: conversationId };

    try {
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData), 
      });

      if (!result.ok) {
        const errorText = await result.text();
        console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as GetMessagesResponse; 
      
      if (responseData.Ok) {
        console.log("Fetched messages for conversation:", conversationId, responseData.Ok); 
        setCurrentConversation(conversationId, responseData.Ok);
      } else {
        console.error("Error fetching messages:", responseData.Err || "Unknown error"); 
        setCurrentConversation(conversationId, []);
      }
    } catch (error) {
      console.error("Failed to fetch messages:", error);
      setCurrentConversation(conversationId, []);
    }
  }, [setCurrentConversation]);

  // Send a message
  const sendMessage = useCallback(async (recipientAddress: string, content: string) => {
    if (!content.trim()) return;
    
    const requestData: SendMessageRequest = {
  SendMessage: [
    recipientAddress,
    content
  ]
};

    try {
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
      });

      if (!result.ok) {
        const errorText = await result.text();
        console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }

      const responseData = await result.json() as SendMessageResponse;

      if (responseData.Ok !== undefined) { 
        console.log("Message sent successfully");
        setMessageText("");
        fetchConversations(); // Refresh conversation list and messages
        setError(null);
      } else {
        const errorMsg = responseData.Err || "Unknown error sending message";
        console.error("Error sending message:", errorMsg);
        setError(errorMsg);
      }
    } catch (error) {
      console.error("Failed to send message:", error);
      setError("Failed to send message. Please try again.");
    }
  }, [fetchConversations]);

  // Create a new group
  const createGroup = useCallback(async (name: string, membersList: string[]) => {
    const requestData: CreateGroupRequest = {
      CreateGroup: [name, membersList]
    };
    
    try {
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
      });
      
      if (!result.ok) {
        const errorText = await result.text();
        console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as CreateGroupResponse;
      
      if (responseData.Ok) {
        console.log("Group created successfully with ID:", responseData.Ok);
        setIsCreatingGroup(false);
        setGroupName("");
        setGroupMembers("");
        fetchConversations();
        setError(null);
      } else {
        const errorMsg = responseData.Err || "Unknown error creating group";
        console.error("Error creating group:", errorMsg);
        setError(errorMsg);
      }
    } catch (error) {
      console.error("Failed to create group:", error);
      setError("Failed to create group. Please try again.");
    }
  }, [fetchConversations]);
  
  // Add member to group
  const addGroupMember = useCallback(async (groupId: string, memberAddress: string) => {
    const requestData: AddGroupMemberRequest = {
      AddGroupMember: [groupId, memberAddress]
    };
    
    try {
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
      });
      
      if (!result.ok) {
        const errorText = await result.text();
        console.error(`HTTP request failed: ${result.status} ${result.statusText}. Response:`, errorText);
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as AddGroupMemberResponse;
      
      if (responseData.Ok) {
        console.log("Member added successfully");
        setShowAddMember(false);
        setNewMemberAddress("");
        fetchConversations();
        setError(null);
      } else {
        const errorMsg = responseData.Err || "Unknown error adding member";
        console.error("Error adding member:", errorMsg);
        setError(errorMsg);
      }
    } catch (error) {
      console.error("Failed to add member:", error);
      setError("Failed to add member. Please try again.");
    }
  }, [fetchConversations]);

  // Handle sending a message in the current conversation
  const handleSendMessage = useCallback(() => {
    if (!messageText.trim()) return;
    
    if (isCreatingNewChat) {
      if (!newRecipient.trim()) {
        setError("Please enter a recipient address");
        return;
      }
      sendMessage(newRecipient, messageText);
      setIsCreatingNewChat(false);
      setNewRecipient("");
    } else if (currentConversationId) {
      const currentConversation = conversations.find(c => c.id === currentConversationId);
      if (currentConversation) {
        if (currentConversation.is_group) {
          // For groups, send to the group ID
          sendMessage(currentConversationId, messageText);
        } else {
          // For direct messages, find the recipient (the one that isn't me)
          const recipient = currentConversation.participants.find(p => p !== myNodeId);
          if (recipient) {
            sendMessage(recipient, messageText);
          } else {
            setError("Could not determine message recipient");
          }
        }
      }
    }
  }, [messageText, isCreatingNewChat, newRecipient, currentConversationId, conversations, myNodeId, sendMessage]);

  // Handle selecting a conversation to view
  const handleSelectConversation = useCallback((conversationId: string) => {
    fetchMessages(conversationId);
    setIsCreatingNewChat(false);
    setError(null);
  }, [fetchMessages]);

  // Handle starting a new conversation
  const handleStartNewChat = useCallback(() => {
    clearCurrentConversation();
    setIsCreatingNewChat(true);
    setIsCreatingGroup(false);
    setError(null);
  }, [clearCurrentConversation]);
  
  // Handle starting a new group
  const handleStartNewGroup = useCallback(() => {
    clearCurrentConversation();
    setIsCreatingNewChat(false);
    setIsCreatingGroup(true);
    setError(null);
  }, [clearCurrentConversation]);
  
  // Handle creating the group
  const handleCreateGroup = useCallback(() => {
    if (!groupName.trim()) {
      setError("Please enter a group name");
      return;
    }
    
    if (!groupMembers.trim()) {
      setError("Please enter at least one member address");
      return;
    }
    
    // Parse member addresses (comma-separated)
    const members = groupMembers.split(',').map(m => m.trim()).filter(m => m);
    
    if (members.length === 0) {
      setError("Please enter at least one valid member address");
      return;
    }
    
    createGroup(groupName, members);
  }, [groupName, groupMembers, createGroup]);

  // Upload file
  const uploadFile = useCallback(async (file: File): Promise<FileInfo | null> => {
    try {
      setIsUploading(true);
      
      // Read file as array buffer
      const arrayBuffer = await file.arrayBuffer();
      const fileData = Array.from(new Uint8Array(arrayBuffer));
      
      const requestData: UploadFileRequest = {
        UploadFile: [file.name, file.type || 'application/octet-stream', fileData]
      };
      
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
      });
      
      if (!result.ok) {
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as UploadFileResponse;
      
      if (responseData.Ok) {
        console.log("File uploaded successfully:", responseData.Ok);
        return responseData.Ok;
      } else {
        const errorMsg = responseData.Err || "Unknown error uploading file";
        console.error("Error uploading file:", errorMsg);
        setError(errorMsg);
        return null;
      }
    } catch (error) {
      console.error("Failed to upload file:", error);
      setError("Failed to upload file. Please try again.");
      return null;
    } finally {
      setIsUploading(false);
    }
  }, []);
  
  // Download file
  const downloadFile = useCallback(async (fileInfo: FileInfo) => {
    try {
      const requestData: DownloadFileRequest = {
        DownloadFile: [fileInfo.file_id, fileInfo.sender_node]
      };
      
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
      });
      
      if (!result.ok) {
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as DownloadFileResponse;
      
      if (responseData.Ok) {
        // Convert number array back to Uint8Array
        const uint8Array = new Uint8Array(responseData.Ok);
        const blob = new Blob([uint8Array], { type: fileInfo.mime_type });
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileInfo.file_name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        console.log("File downloaded successfully");
      } else {
        const errorMsg = responseData.Err || "Unknown error downloading file";
        console.error("Error downloading file:", errorMsg);
        setError(errorMsg);
      }
    } catch (error) {
      console.error("Failed to download file:", error);
      setError("Failed to download file. Please try again.");
    }
  }, []);
  
  // Send file message
  const sendFileMessage = useCallback(async (recipientAddress: string, content: string, fileInfo: FileInfo) => {
    const requestData: SendFileMessageRequest = {
      SendFileMessage: [recipientAddress, content, fileInfo]
    };
    
    try {
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
      });
      
      if (!result.ok) {
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as SendFileMessageResponse;
      
      if (responseData.Ok) {
        console.log("File message sent successfully");
        setMessageText("");
        fetchConversations();
        setError(null);
      } else {
        const errorMsg = responseData.Err || "Unknown error sending file message";
        console.error("Error sending file message:", errorMsg);
        setError(errorMsg);
      }
    } catch (error) {
      console.error("Failed to send file message:", error);
      setError("Failed to send file message. Please try again.");
    }
  }, [fetchConversations]);
  
  // Handle file selection
  const handleFileSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    // Check file size (limit to 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB");
      return;
    }
    
    const fileInfo = await uploadFile(file);
    if (fileInfo) {
      // Determine recipient
      let recipient: string | null = null;
      
      if (isCreatingNewChat && newRecipient.trim()) {
        recipient = newRecipient.trim();
      } else if (currentConversationId) {
        const currentConversation = conversations.find(c => c.id === currentConversationId);
        if (currentConversation) {
          if (currentConversation.is_group) {
            recipient = currentConversationId;
          } else {
            recipient = currentConversation.participants.find(p => p !== myNodeId) || null;
          }
        }
      }
      
      if (recipient) {
        await sendFileMessage(recipient, messageText || file.name, fileInfo);
        if (isCreatingNewChat) {
          setIsCreatingNewChat(false);
          setNewRecipient("");
        }
      } else {
        setError("Could not determine recipient for file");
      }
    }
    
    // Clear file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [uploadFile, sendFileMessage, isCreatingNewChat, newRecipient, currentConversationId, conversations, myNodeId, messageText]);

  // Check if a file is an image based on mime type
  const isImageFile = (mimeType: string): boolean => {
    return mimeType.startsWith('image/');
  };

  // Load image for display
  const loadImage = useCallback(async (fileInfo: FileInfo) => {
    if (loadingImages.has(fileInfo.file_id) || loadedImages[fileInfo.file_id]) {
      return; // Already loading or loaded
    }

    setLoadingImages(prev => new Set(prev).add(fileInfo.file_id));

    try {
      // If sender node is our node, the file is already local
      // Otherwise, download will fetch from remote and cache locally
      const requestData: DownloadFileRequest = {
        DownloadFile: [fileInfo.file_id, fileInfo.sender_node]
      };
      
      const result = await fetch(`${BASE_URL}/api`, {
        method: "POST",
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData),
      });
      
      if (!result.ok) {
        throw new Error(`HTTP request failed: ${result.statusText}`);
      }
      
      const responseData = await result.json() as DownloadFileResponse;
      
      if (responseData.Ok) {
        // Convert to data URL for display
        const uint8Array = new Uint8Array(responseData.Ok);
        const blob = new Blob([uint8Array], { type: fileInfo.mime_type });
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        
        setLoadedImages(prev => ({ ...prev, [fileInfo.file_id]: dataUrl }));
        console.log("Image loaded and cached for display");
      } else {
        const errorMsg = responseData.Err || "Unknown error loading image";
        console.error("Error loading image:", errorMsg);
        setError(errorMsg);
      }
    } catch (error) {
      console.error("Failed to load image:", error);
      setError("Failed to load image. Please try again.");
    } finally {
      setLoadingImages(prev => {
        const newSet = new Set(prev);
        newSet.delete(fileInfo.file_id);
        return newSet;
      });
    }
  }, [loadedImages, loadingImages]);

  // Auto-load images for sender
  useEffect(() => {
    // When messages change, auto-load images that belong to the current user
    currentConversationMessages.forEach(message => {
      if (message.file_info && 
          isImageFile(message.file_info.mime_type) && 
          message.sender === myNodeId &&
          !loadedImages[message.file_info.file_id] &&
          !loadingImages.has(message.file_info.file_id)) {
        loadImage(message.file_info);
      }
    });
  }, [currentConversationMessages, myNodeId, loadedImages, loadingImages, loadImage]);

  // Set up initial data fetch and polling
  useEffect(() => {
    // Initial fetch
    fetchConversations();
    
    // Set up polling for new data
    const intervalId = setInterval(fetchConversations, POLLING_INTERVAL);
    
    return () => clearInterval(intervalId);
  }, [fetchConversations]);

  // Initialize WebSocket connection
  useEffect(() => {
    if (window.our?.node && window.our?.process) {
      const api = new HyperwareClientApi({
        uri: WEBSOCKET_URL,
        nodeId: window.our.node,
        processId: window.our.process,
        onOpen: (_event, _api) => {
          console.log("Connected to Hyperware WebSocket");
          setMyNodeId(window.our?.node || null);
        },
        onMessage: (json, _api) => {
          console.log('WEBSOCKET MESSAGE RECEIVED', json);
          try {
            const data = JSON.parse(json);
            console.log("Parsed WebSocket message", data);
            // If it's a new message notification, we could refresh our conversation data
            fetchConversations();
          } catch (error) {
            console.error("Error parsing WebSocket message", error);
          }
        },
        onClose: () => {
          console.log("WebSocket connection closed");
        },
        onError: (error) => {
          console.error("WebSocket error:", error);
        }
      });

      setApi(api);
      setMyNodeId(window.our.node || null);
    } else {
      console.warn("Node or process ID not found, cannot connect WebSocket.");
      setNodeConnected(false);
    }

    return () => {
      console.log("Closing WebSocket connection (if open).");
    };
  }, [setMyNodeId, fetchConversations]);

  // Get display name for a conversation
  const getConversationDisplayName = (conversation: ConversationSummary) => {
    if (conversation.is_group) {
      return conversation.group_name || "Unnamed Group";
    }
    
    if (!myNodeId) return "Unknown";
    const otherParticipant = conversation.participants.find(p => p !== myNodeId);
    return otherParticipant || "Unknown";
  };

  return (
    <div className="app-container">
      {!nodeConnected && (
        <div className="node-not-connected">
          <h2 style={{ color: "red" }}>Node not connected</h2>
          <h4>
            Check console. Connection to {PROXY_TARGET} might be needed.
          </h4>
        </div>
      )}
      
      <div className="header">
        <h2>Samchat</h2>
        <div className="user-id">
          Your ID: <strong>{myNodeId || "Unknown"}</strong>
        </div>
      </div>
      
      <div className="main-content">
        {/* Sidebar with conversations list */}
        <div className="sidebar">
          <div className="new-chat-box">
            <button 
              className="send-button" 
              style={{ width: '100%', marginBottom: '5px' }}
              onClick={handleStartNewChat}
            >
              Start New Chat
            </button>
            <button 
              className="send-button" 
              style={{ width: '100%' }}
              onClick={handleStartNewGroup}
            >
              Create Group
            </button>
          </div>
          
          {conversations.length > 0 ? (
            <ul className="conversation-list">
              {conversations.map(conversation => (
                <li 
                  key={conversation.id} 
                  className={`conversation-item ${currentConversationId === conversation.id ? 'active' : ''}`}
                  onClick={() => handleSelectConversation(conversation.id)}
                >
                  <div className="conversation-participants">
                    {conversation.is_group && "👥 "}{getConversationDisplayName(conversation)}
                    {conversation.is_group && (
                      <span style={{ fontSize: '0.8em', opacity: 0.7 }}>
                        {" "}({conversation.participants.length} members)
                      </span>
                    )}
                  </div>
                  <div className="conversation-timestamp">
                    {formatDate(conversation.last_updated)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state" style={{ padding: '20px' }}>
              <p>No conversations yet.</p>
              <p>Start a new chat to begin messaging!</p>
            </div>
          )}
        </div>
        
        {/* Main chat area */}
        <div className="chat-container">
          {isCreatingGroup ? (
            <>
              <div className="message-list" ref={messageListRef}>
                <div className="empty-state">
                  <h3>Create New Group</h3>
                  <p>Enter a group name and member addresses to create a group chat.</p>
                </div>
              </div>
              
              <div className="message-input-container">
                {error && <div style={{ color: 'red', marginBottom: '5px' }}>{error}</div>}
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Enter group name"
                  style={{ width: '100%', marginBottom: '10px' }}
                />
                <input
                  type="text"
                  value={groupMembers}
                  onChange={(e) => setGroupMembers(e.target.value)}
                  placeholder="Enter member addresses (comma-separated, e.g., alice.os, bob.os)"
                  style={{ width: '100%', marginBottom: '10px' }}
                />
                <button 
                  className="send-button"
                  onClick={handleCreateGroup}
                  disabled={!groupName.trim() || !groupMembers.trim()}
                  style={{ width: '100%' }}
                >
                  Create Group
                </button>
              </div>
            </>
          ) : isCreatingNewChat ? (
            <>
              <div className="message-list" ref={messageListRef}>
                <div className="empty-state">
                  <h3>New Conversation</h3>
                  <p>Enter recipient's address and send a message to start chatting.</p>
                </div>
              </div>
              
              <div className="message-input-container">
                {error && <div style={{ color: 'red', marginBottom: '5px' }}>{error}</div>}
                <input
                  type="text"
                  value={newRecipient}
                  onChange={(e) => setNewRecipient(e.target.value)}
                  placeholder="Enter recipient address (e.g., username.os)"
                  style={{ width: '100%', marginBottom: '10px' }}
                />
                <div style={{ display: 'flex', width: '100%', gap: '5px' }}>
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    placeholder="Type your message..."
                    className="message-input"
                    style={{ flex: 1 }}
                  />
                  <button
                    className="send-button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || !newRecipient.trim()}
                    title="Attach file"
                    style={{ padding: '0 15px' }}
                  >
                    {isUploading ? '...' : '📎'}
                  </button>
                  <button 
                    className="send-button"
                    onClick={handleSendMessage}
                    disabled={!messageText.trim() || !newRecipient.trim()}
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : currentConversationId ? (
            <>
              {(() => {
                const currentConv = conversations.find(c => c.id === currentConversationId);
                if (currentConv?.is_group) {
                  return (
                    <div style={{ 
                      padding: '10px', 
                      borderBottom: '1px solid #ccc',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}>
                      <div>
                        <h3 style={{ margin: 0 }}>👥 {currentConv.group_name || 'Unnamed Group'}</h3>
                        <p style={{ margin: 0, fontSize: '0.9em', opacity: 0.7 }}>
                          {currentConv.participants.length} members: {currentConv.participants.join(', ')}
                        </p>
                      </div>
                      <button 
                        onClick={() => setShowAddMember(true)}
                        style={{ padding: '5px 10px' }}
                      >
                        Add Member
                      </button>
                    </div>
                  );
                }
                return null;
              })()}
              
              {showAddMember && (
                <div style={{ padding: '10px', borderBottom: '1px solid #ccc' }}>
                  <input
                    type="text"
                    value={newMemberAddress}
                    onChange={(e) => setNewMemberAddress(e.target.value)}
                    placeholder="Enter member address (e.g., username.os)"
                    style={{ width: '70%', marginRight: '10px' }}
                  />
                  <button 
                    onClick={() => {
                      if (newMemberAddress.trim() && currentConversationId) {
                        addGroupMember(currentConversationId, newMemberAddress.trim());
                      }
                    }}
                    disabled={!newMemberAddress.trim()}
                    style={{ marginRight: '5px' }}
                  >
                    Add
                  </button>
                  <button onClick={() => {
                    setShowAddMember(false);
                    setNewMemberAddress('');
                  }}>
                    Cancel
                  </button>
                </div>
              )}
              
              <div className="message-list" ref={messageListRef}>
                {currentConversationMessages.length > 0 ? (
                  currentConversationMessages.map(message => (
                    <div 
                      key={message.id}
                      className={`message-item ${message.sender === myNodeId ? 'sent' : 'received'}`}
                    >
                      {(() => {
                        const currentConv = conversations.find(c => c.id === currentConversationId);
                        const isGroup = currentConv?.is_group;
                        const showSender = isGroup && message.sender !== myNodeId;
                        return (
                          <>
                            {showSender && (
                              <div className="message-sender" style={{ fontSize: '0.8em', opacity: 0.7, marginBottom: '2px' }}>
                                {message.sender}
                              </div>
                            )}
                            <div className="message-content">{message.content}</div>
                            {message.file_info && (
                              <>
                                {isImageFile(message.file_info.mime_type) ? (
                                  <>
                                    {loadedImages[message.file_info.file_id] ? (
                                      // Image is loaded, display it
                                      <div style={{ marginTop: '5px' }}>
                                        <img 
                                          src={loadedImages[message.file_info.file_id]} 
                                          alt={message.file_info.file_name}
                                          style={{ 
                                            maxWidth: '100%', 
                                            maxHeight: '400px',
                                            borderRadius: '4px',
                                            cursor: 'pointer'
                                          }}
                                          onClick={() => downloadFile(message.file_info!)}
                                          title="Click to download"
                                        />
                                        <div style={{ fontSize: '0.8em', opacity: 0.7, marginTop: '4px' }}>
                                          {message.file_info.file_name} • Click to download
                                        </div>
                                      </div>
                                    ) : (
                                      // Image not loaded yet
                                      <div 
                                        style={{
                                          marginTop: '5px',
                                          padding: '8px',
                                          backgroundColor: 'rgba(0, 123, 255, 0.1)',
                                          borderRadius: '4px',
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: '8px'
                                        }}
                                      >
                                        <span style={{ fontSize: '1.2em' }}>🖼️</span>
                                        <div style={{ flex: 1 }}>
                                          <div style={{ fontWeight: 'bold', fontSize: '0.9em' }}>{message.file_info.file_name}</div>
                                          <div style={{ fontSize: '0.8em', opacity: 0.7 }}>
                                            {formatFileSize(message.file_info.file_size)} • Image
                                          </div>
                                        </div>
                                        {message.sender === myNodeId ? (
                                          // For sender, show loading state
                                          <span style={{ fontSize: '0.8em', opacity: 0.7 }}>
                                            {loadingImages.has(message.file_info.file_id) ? 'Loading...' : 'Processing...'}
                                          </span>
                                        ) : (
                                          // For recipient, show load button
                                          <button
                                            onClick={() => loadImage(message.file_info!)}
                                            disabled={loadingImages.has(message.file_info.file_id)}
                                            style={{
                                              padding: '4px 12px',
                                              borderRadius: '4px',
                                              border: '1px solid #007bff',
                                              backgroundColor: '#007bff',
                                              color: 'white',
                                              cursor: loadingImages.has(message.file_info.file_id) ? 'not-allowed' : 'pointer',
                                              opacity: loadingImages.has(message.file_info.file_id) ? 0.6 : 1
                                            }}
                                          >
                                            {loadingImages.has(message.file_info.file_id) ? 'Loading...' : 'Load'}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </>
                                ) : (
                                  // Non-image file
                                  <div 
                                    className="message-file-attachment"
                                    style={{
                                      marginTop: '5px',
                                      padding: '8px',
                                      backgroundColor: 'rgba(0, 123, 255, 0.1)',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px'
                                    }}
                                    onClick={() => downloadFile(message.file_info!)}
                                  >
                                    <span style={{ fontSize: '1.2em' }}>📎</span>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontWeight: 'bold', fontSize: '0.9em' }}>{message.file_info.file_name}</div>
                                      <div style={{ fontSize: '0.8em', opacity: 0.7 }}>
                                        {formatFileSize(message.file_info.file_size)}
                                      </div>
                                    </div>
                                    <span style={{ fontSize: '0.8em', opacity: 0.7 }}>Click to download</span>
                                  </div>
                                )}
                              </>
                            )}
                            <div className="message-timestamp">{formatDate(message.timestamp)}</div>
                          </>
                        );
                      })()}
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <p>No messages yet in this conversation.</p>
                    <p>Send a message to start chatting!</p>
                  </div>
                )}
              </div>
              
              <div className="message-input-container">
                {error && <div style={{ color: 'red', marginBottom: '5px' }}>{error}</div>}
                <div style={{ display: 'flex', width: '100%', gap: '5px' }}>
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
                    placeholder="Type your message..."
                    className="message-input"
                    style={{ flex: 1 }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={handleFileSelect}
                    style={{ display: 'none' }}
                    accept="*/*"
                  />
                  <button
                    className="send-button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    title="Attach file"
                    style={{ padding: '0 15px' }}
                  >
                    {isUploading ? '...' : '📎'}
                  </button>
                  <button 
                    className="send-button"
                    onClick={handleSendMessage}
                    disabled={!messageText.trim()}
                  >
                    Send
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <h3>Welcome to Samchat!</h3>
              <p>Select a conversation or start a new chat to begin messaging.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
