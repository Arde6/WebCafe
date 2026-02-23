const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

let myId = null;
let localStream = null;
let username = null; // set this from your existing login/username logic

// Map of peerId -> RTCPeerConnection
const peerConnections = new Map();
// Candidate queue per peer: peerId -> RTCIceCandidate[]
const candidateQueues = new Map();

let joinButton = null;
const remoteAudios = {}; // peerId -> <audio> element

// --- Define all helper functions first ---

// --- Initiate a call to a specific peer ---
async function callPeer(peerId) {
  const pc = getOrCreatePC(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(JSON.stringify({ type: "offer", to: peerId, sdp: offer }));
}

// --- Create (or retrieve) a PeerConnection for a given peer ---
function getOrCreatePC(peerId) {
  if (peerConnections.has(peerId)) return peerConnections.get(peerId);

  const pc = new RTCPeerConnection(config);
  peerConnections.set(peerId, pc);

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  pc.ontrack = (event) => {
    const stream = event.streams[0];
    let audio = remoteAudios[peerId];
    if (!audio) {
      audio = document.createElement('audio');
      audio.autoplay = true;
      document.body.appendChild(audio);
      remoteAudios[peerId] = audio;
      startVolumeMeter(stream, peerId);
    }
    audio.srcObject = stream;
  };

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      ws.send(JSON.stringify({ type: "candidate", to: peerId, candidate: event.candidate }));
    }
  };

  pc.onconnectionstatechange = () => {
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      cleanupPeer(peerId);
    }
  };

  return pc;
}

async function flushCandidateQueue(peerId) {
  const queue = candidateQueues.get(peerId) || [];
  const pc = peerConnections.get(peerId);
  while (queue.length > 0) {
    await pc.addIceCandidate(queue.shift());
  }
  candidateQueues.delete(peerId);
}

function cleanupPeer(peerId) {
  const pc = peerConnections.get(peerId);
  if (pc) { pc.close(); peerConnections.delete(peerId); }
  const audio = remoteAudios[peerId];
  if (audio) { audio.remove(); delete remoteAudios[peerId]; }
}

// --- Volume meter (per-peer) ---
function startVolumeMeter(audioStream, peerId) {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(audioStream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  const volumeBar = document.getElementById('volume-bar');
  function update() {
    analyser.getByteFrequencyData(dataArray);
    const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
    if (volumeBar) volumeBar.style.width = Math.min(100, avg * 2.5) + "%";
    requestAnimationFrame(update);
  }
  update();
}

function updateVoiceRosterUI(roster) {
  console.log("Voice participants:", roster.map(p => p.user));
}

// --- Initialize voice call ---
function initializeVoiceCall() {
  joinButton = document.getElementById('startButton');
  if (!ws) {
    console.warn('WebSocket not initialized yet');
    return;
  }
  setupVoiceMessageHandler();
}

// Wait for DOM to be ready before initializing
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(initializeVoiceCall, 100);
  });
} else {
  setTimeout(initializeVoiceCall, 100);
}

// --- Receive our assigned ID from server ---
function setupVoiceMessageHandler() {
  if (!ws) return;
  ws.addEventListener('message', async (event) => {
  let data;
  try {
    const raw = event.data instanceof Blob ? await event.data.text() : event.data;
    data = JSON.parse(raw);
  } catch (e) { return; }

  switch (data.type) {

    case "init":
      myId = data.id;
      break;

    // Server tells us who is already in the room — we initiate to each of them
    case "voice-peers":
      for (const peerId of data.peers) {
        await callPeer(peerId);
      }
      break;

    // A new peer joined after us — they will call us, so just prep
    case "peer-joined":
      // Nothing to do; they will send us an offer
      break;

    case "offer": {
      const pc = getOrCreatePC(data.from);
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      await flushCandidateQueue(data.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", to: data.from, sdp: answer }));
      break;
    }

    case "answer": {
      const pc = peerConnections.get(data.from);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushCandidateQueue(data.from);
      }
      break;
    }

    case "candidate": {
      const candidate = new RTCIceCandidate(data.candidate);
      const pc = peerConnections.get(data.from);
      if (pc && pc.remoteDescription) {
        await pc.addIceCandidate(candidate);
      } else {
        if (!candidateQueues.has(data.from)) candidateQueues.set(data.from, []);
        candidateQueues.get(data.from).push(candidate);
      }
      break;
    }

    case "peer-left":
      cleanupPeer(data.id);
      break;

    case "voice-roster":
      updateVoiceRosterUI(data.roster);
      break;

    // Your existing chat handlers (history, message, etc.) go here
  }
});
}

// --- Join the voice room ---
function setupJoinButton() {
  if (!joinButton) return;
  joinButton.onclick = async () => {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    ws.send(JSON.stringify({ type: "join-voice", user: username }));
    joinButton.innerText = "In Call";
    joinButton.disabled = true;
  };
}

// Setup the join button after initialization
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupJoinButton, 150);
  });
} else {
  setTimeout(setupJoinButton, 150);
}

function updateVoiceRosterUI(roster) {
  // Optional: render a list of who's in the call
  // e.g. document.getElementById('voice-roster').innerText = roster.map(p => p.user).join(', ');
  console.log("Voice participants:", roster.map(p => p.user));
}