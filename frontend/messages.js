const API = "http://localhost:5000";

let token = localStorage.getItem("token");
if (!token) {
    alert("Please login first");
    window.location.href = "login.html";
}

let currentChatUser = null;
let currentChatEmail = "";
let myId = null; // Store logged-in user ID

// --------------------------------------------------
// URL STATE MANAGEMENT
// --------------------------------------------------

function saveCurrentChatToUrl() {
    if (currentChatUser) {
        const url = new URL(window.location);
        url.searchParams.set("user", currentChatUser);
        url.searchParams.set("email", currentChatEmail);
        window.history.replaceState(null, "", url);
    }
}

function loadCurrentChatFromUrl() {
    const url = new URL(window.location);
    const userId = url.searchParams.get("user");
    const userEmail = url.searchParams.get("email");
    
    if (userId && userEmail) {
        currentChatUser = parseInt(userId, 10);
        currentChatEmail = userEmail;
        return true;
    }
    return false;
}

// --------------------------------------------------
// INITIALIZATION
// --------------------------------------------------

async function init() {
    try {
        // 1. Fetch "Who am I?" from the server
        const res = await fetch(`${API}/me`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error("Failed to authenticate");
        
        const data = await res.json();
        myId = data.user.id; // Save my ID globally
        
        // 2. Try to restore chat from URL
        const hasRestoredChat = loadCurrentChatFromUrl();
        
        // 3. Load the list of conversations
        loadConversations();
        
        // 4. If we had a chat open, reload it
        if (hasRestoredChat) {
            loadChat();
        }
        
        // 5. Setup search functionality
        setupSearch();
        
    } catch (err) {
        console.error("Login check failed", err);
        window.location.href = "login.html";
    }
}

// --------------------------------------------------
// SEARCH FOR USER BY EMAIL
// --------------------------------------------------

async function searchUserByEmail(email) {
    try {
        const res = await fetch(`${API}/users/search?email=${encodeURIComponent(email)}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
            console.error("Search failed:", res.status);
            return null;
        }

        const data = await res.json();
        return data.user;
    } catch (err) {
        console.error("Error searching user:", err);
        return null;
    }
}

function setupSearch() {
    const searchInput = document.getElementById("searchEmail");
    const searchBtn = document.getElementById("searchBtn");
    const searchResults = document.getElementById("searchResults");

    searchBtn.addEventListener("click", async () => {
        const email = searchInput.value.trim();

        if (!email) {
            alert("Please enter an email address");
            return;
        }

        if (email === localStorage.getItem("userEmail")) {
            alert("You cannot chat with yourself!");
            return;
        }

        searchResults.innerHTML = "Searching...";

        const user = await searchUserByEmail(email);

        if (user) {
            searchResults.innerHTML = `
                <div style="background-color: #f0f0f0; padding: 10px; border-radius: 4px; text-align: center;">
                    <div style="font-weight: bold; margin-bottom: 5px;">${user.email}</div>
                    <button 
                        onclick="startNewChat(${user.id}, '${user.email}')"
                        style="padding: 6px 12px; background-color: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer;"
                    >
                        Start Chat
                    </button>
                </div>
            `;
        } else {
            searchResults.innerHTML = '<div style="color: #d32f2f; padding: 10px;">User not found</div>';
        }
    });

    // Allow pressing Enter to search
    searchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") searchBtn.click();
    });
}

function startNewChat(userId, userEmail) {
    currentChatUser = userId;
    currentChatEmail = userEmail;
    saveCurrentChatToUrl();

    // Visual highlight
    document.querySelectorAll("#conversationsList > div").forEach(d => d.style.backgroundColor = "transparent");

    // Clear search
    document.getElementById("searchEmail").value = "";
    document.getElementById("searchResults").innerHTML = "";

    loadChat();
    loadConversations(); // Refresh to show new conversation
}

// --------------------------------------------------
// LOAD CONVERSATIONS
// --------------------------------------------------

async function loadConversations() {
    const res = await fetch(`${API}/messages/conversations`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json();
    const conversations = data.conversations || [];

    const list = document.getElementById("conversationsList");
    list.innerHTML = "";

    conversations.forEach(conv => {
        let item = document.createElement("div");
        item.classList.add("conversation");
        
        // Inline styles for basic layout
        item.style.padding = "10px";
        item.style.borderBottom = "1px solid #ddd";
        item.style.cursor = "pointer";

        item.dataset.id = conv.user_id;
        
        // Highlight if this is the current chat
        if (conv.user_id === currentChatUser) {
            item.style.backgroundColor = "#eef";
        }
        
        // Show email and last message
        item.innerHTML = `
            <div style="font-weight:bold;">${conv.email || 'User ' + conv.user_id}</div>
            <div style="color:#666; font-size:0.9em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${conv.message || 'Start a chat...'}
            </div>
        `;

        item.addEventListener("click", () => {
            currentChatUser = conv.user_id;
            currentChatEmail = conv.email;
            saveCurrentChatToUrl();
            
            // Visual highlight for selected chat
            document.querySelectorAll("#conversationsList > div").forEach(d => d.style.backgroundColor = "transparent");
            item.style.backgroundColor = "#eef";

            loadChat();
        });

        list.appendChild(item);
    });
}

// --------------------------------------------------
// LOAD CHAT WITH SELECTED USER
// --------------------------------------------------

async function loadChat() {
    if (!currentChatUser || !myId) return; // Wait until we know who 'me' is

    document.getElementById("chatHeader").innerText = "Chat with " + currentChatEmail;

    const res = await fetch(`${API}/messages/chat?user=${currentChatUser}`, {
        headers: { Authorization: `Bearer ${token}` }
    });

    const data = await res.json();
    const messages = data.messages || [];

    const box = document.getElementById("messagesBox");
    box.innerHTML = "";

    messages.forEach(msg => {
        let div = document.createElement("div");
        
        // KEY FIX: Compare Sender ID with My ID
        // We use == to be safe against string/number differences (e.g. "5" vs 5)
        const isMine = (msg.sender_id == myId);

        div.classList.add("message");
        div.classList.add(isMine ? "me" : "them"); // Applies .me (Right) or .them (Left)
        div.innerText = msg.message;

        box.appendChild(div);
    });

    // Scroll to bottom
    box.scrollTop = box.scrollHeight;
}

// --------------------------------------------------
// SEND MESSAGE
// --------------------------------------------------

async function sendMessage() {
    if (!currentChatUser) {
        alert("Select a user to chat with!");
        return;
    }

    const input = document.getElementById("chatInput");
    let message = input.value.trim();

    if (!message) return;

    const res = await fetch(`${API}/messages/send`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            receiver_id: currentChatUser,
            message
        })
    });

    if (res.ok) {
        input.value = "";
        loadChat(); // Reload messages
        // Only update the conversation list preview without losing current chat state
        loadConversations();
    }
}

// --------------------------------------------------
// EVENT LISTENERS
// --------------------------------------------------

document.getElementById("sendBtn").addEventListener("click", sendMessage);
document.getElementById("chatInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendMessage();
});

// Auto-refresh chat every 2 seconds
setInterval(() => {
    if (currentChatUser) loadChat();
}, 2000);

// Start App
init();