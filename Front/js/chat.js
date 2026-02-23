let ws = null;
let messagesDiv = null;
let userInput = null;
let textInput = null;

function initializeChat() {
  // Use wss:// for HTTPS, ws:// for HTTP
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}`);
  
  messagesDiv = document.getElementById("messages");
  userInput = document.getElementById("user");
  textInput = document.getElementById("text");
}

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeChat);
} else {
  initializeChat();
}

function setupMessageHandler() {
  if (!ws) return;
  ws.onmessage = async (event) => {
    let data;
    try {
        // Step 1: Check if the data is a Blob and convert to text if needed
        const rawData = event.data instanceof Blob ? await event.data.text() : event.data;
        
        // Step 2: Only parse if it looks like JSON
        data = JSON.parse(rawData);
    } catch (e) {
        console.log("Ignored non-JSON or malformed message");
        return;
    }

    if (data.type === "history") {
        data.messages.forEach((msg) => {
            appendMessage(msg.user, msg.text);
        });
    } else if (data.type === "message") {
        appendMessage(data.user, data.text);
    }
  };
};

function appendMessage(user, text) {
    const p = document.createElement("p");
    p.innerHTML = `<b>${user}:</b> ${text}`;
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMessage() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    alert('Not connected to server. Please reload the page.');
    return;
  }
  const user = userInput.value;
  const text = textInput.value;
  if (user && text) {
    ws.send(JSON.stringify({ user, text }));
    textInput.value = "";
  }
}

// Setup message handler when connection opens
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupMessageHandler, 100);
  });
} else {
  setTimeout(setupMessageHandler, 100);
}
