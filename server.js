const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Database = require('better-sqlite3');

// 1. Setup Express and HTTP Server
const app = express();
const server = http.createServer(app);
const db = new Database(process.env.DATABASE_URL || './local.db');

// 2. Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )  
`);

// 3. Setup WebSocket server bound to the HTTP server
const wss = new WebSocket.Server({ server });

// Track clients
const clients = new Map();
// Track whos in the call
const voiceRoom = new Set();

function generateId() {
    return Math.random().toString(36).slice(2, 10);
}

wss.on("connection", (ws) => {
    const clientId = generateId();
    clients.set(clientId, { ws, user: null });

    // Send this client their own ID immediately
    ws.send(JSON.stringify({ type: "init", id: clientId }));

    // Send chat history
    const messages = db.prepare("SELECT * FROM messages ORDER BY timestamp").all();
    ws.send(JSON.stringify({ type: "history", messages }));

    ws.on("message", (data) => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { return; }

        // --- Signaling: route to specific peer by ID ---
        if (["offer", "answer", "candidate"].includes(parsed.type)) {
        const target = clients.get(parsed.to);
        if (target && target.ws.readyState === WebSocket.OPEN) {
            target.ws.send(JSON.stringify({ ...parsed, from: clientId }));
        }
        return;
        }

        // --- Voice room: join ---
        if (parsed.type === "join-voice") {
        clients.get(clientId).user = parsed.user;
        // Tell the new joiner who is already in the room
        ws.send(JSON.stringify({
            type: "voice-peers",
            peers: [...voiceRoom] // list of existing peer IDs
        }));
        // Tell everyone else a new peer joined
        voiceRoom.forEach(peerId => {
            const peer = clients.get(peerId);
            if (peer && peer.ws.readyState === WebSocket.OPEN) {
            peer.ws.send(JSON.stringify({ type: "peer-joined", id: clientId }));
            }
        });
        voiceRoom.add(clientId);
        broadcastVoiceRoster();
        return;
        }

        // --- Voice room: leave ---
        if (parsed.type === "leave-voice") {
        handleLeaveVoice(clientId);
        return;
        }

        // --- Chat message ---
        try {
            const { user, text } = parsed;
            const stmt = db.prepare("INSERT INTO messages (user, text) VALUES (?, ?)");
            stmt.run(user, text);
            const payload = JSON.stringify({ type: "message", user, text });
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(payload);
            });
        } catch (e) {
            console.error("Error handling message:", e);
        }
    });

    ws.on("close", () => {
        handleLeaveVoice(clientId);
        clients.delete(clientId);
    });
});

function handleLeaveVoice(clientId) {
  if (!voiceRoom.has(clientId)) return;
  voiceRoom.delete(clientId);
  // Notify remaining peers so they can clean up that connection
  voiceRoom.forEach(peerId => {
    const peer = clients.get(peerId);
    if (peer && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(JSON.stringify({ type: "peer-left", id: clientId }));
    }
  });
  broadcastVoiceRoster();
}

function broadcastVoiceRoster() {
  // Broadcast updated voice participant list to everyone in the room
  const roster = [...voiceRoom].map(id => ({
    id,
    user: clients.get(id)?.user ?? "Unknown"
  }));
  const msg = JSON.stringify({ type: "voice-roster", roster });
  voiceRoom.forEach(peerId => {
    const peer = clients.get(peerId);
    if (peer && peer.ws.readyState === WebSocket.OPEN) peer.ws.send(msg);
  });
}

// 4. Serve Static Files and Start
app.use(express.static('Front'));

const port = process.env.PORT || 3000
server.listen(port, '0.0.0.0', () => {
    console.log("Server running on", port);
    console.log("WebSocket attached to the same port!");
});