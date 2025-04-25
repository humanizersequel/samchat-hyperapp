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
  GetMessagesResponse
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
  const [error, setError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);

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
      // Find the recipient from the current conversation (the one that isn't me)
      const currentConversation = conversations.find(c => c.id === currentConversationId);
      if (currentConversation) {
        const recipient = currentConversation.participants.find(p => p !== myNodeId);
        if (recipient) {
          sendMessage(recipient, messageText);
        } else {
          setError("Could not determine message recipient");
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
    setError(null);
  }, [clearCurrentConversation]);

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

  // Get display name for a conversation (the other participant's name)
  const getConversationDisplayName = (conversation: ConversationSummary) => {
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
              style={{ width: '100%' }}
              onClick={handleStartNewChat}
            >
              Start New Chat
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
                    {getConversationDisplayName(conversation)}
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
          {isCreatingNewChat ? (
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
                <div style={{ display: 'flex', width: '100%' }}>
                  <input
                    type="text"
                    value={messageText}
                    onChange={(e) => setMessageText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="Type your message..."
                    className="message-input"
                  />
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
              <div className="message-list" ref={messageListRef}>
                {currentConversationMessages.length > 0 ? (
                  currentConversationMessages.map(message => (
                    <div 
                      key={message.id}
                      className={`message-item ${message.sender === myNodeId ? 'sent' : 'received'}`}
                    >
                      <div className="message-content">{message.content}</div>
                      <div className="message-timestamp">{formatDate(message.timestamp)}</div>
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
                <input
                  type="text"
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Type your message..."
                  className="message-input"
                />
                <button 
                  className="send-button"
                  onClick={handleSendMessage}
                  disabled={!messageText.trim()}
                >
                  Send
                </button>
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
