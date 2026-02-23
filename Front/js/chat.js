const ws = new WebSocket(`ws://${window.location.host}`);
const messagesDiv = document.getElementById("messages");
const userInput = document.getElementById("user");
const textInput = document.getElementById("text");

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

function appendMessage(user, text) {
    const p = document.createElement("p");
    p.innerHTML = `<b>${user}:</b> ${text}`;
    messagesDiv.appendChild(p);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function sendMessage() {
  const user = userInput.value;
  const text = textInput.value;
  if (user && text) {
    ws.send(JSON.stringify({ user, text }));
    textInput.value = "";
  }
}
