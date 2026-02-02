const SERVER_URL = "http://localhost:3000";
const socket = io(SERVER_URL);

let roomId = null;
let peerConnection = null;
let localStream = null;
let remoteStream = new MediaStream();
let remotePeerId = null;

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
remoteVideo.srcObject = remoteStream;

const statusEl = document.getElementById("status");

// STUN servers (good baseline). For better reliability, add TURN later.
const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

// ---------- Scheduling ----------
document.getElementById("createMeeting").onclick = async () => {
  const title = document.getElementById("title").value;
  const start = document.getElementById("start").value;
  const end = document.getElementById("end").value;

  if (!start || !end) return alert("Pick start and end time");

  const res = await fetch(`${SERVER_URL}/api/meetings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(end).toISOString()
    })
  });

  const data = await res.json();
  document.getElementById("createOut").textContent =
    `Meeting created!\nID: ${data.meetingId}\nTitle: ${data.title}\nStarts: ${data.startsAt}\nEnds: ${data.endsAt}`;
};

// ---------- Media ----------
async function startMedia() {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  localVideo.srcObject = localStream;
}

function createPeer() {
  peerConnection = new RTCPeerConnection(rtcConfig);

  // send our tracks
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

  // receive tracks
  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
  };

  // send ICE candidates
  peerConnection.onicecandidate = (event) => {
    if (event.candidate && remotePeerId) {
      socket.emit("ice-candidate", { to: remotePeerId, candidate: event.candidate });
    }
  };
}

// ---------- Join meeting ----------
document.getElementById("joinBtn").onclick = async () => {
  roomId = document.getElementById("room").value.trim();
  const name = document.getElementById("name").value.trim() || "Guest";
  if (!roomId) return alert("Enter Meeting ID");

  statusEl.textContent = "Starting camera...";
  await startMedia();
  statusEl.textContent = "Joining room...";

  socket.emit("join-room", { roomId, name });
};

// when we learn existing users in room
socket.on("room-users", async (users) => {
  statusEl.textContent = `In room. Users already here: ${users.length}`;

  // If someone is already there, call them (2-person flow)
  if (users.length > 0) {
    remotePeerId = users[0];
    createPeer();

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit("offer", { to: remotePeerId, sdp: offer });
  }
});

// someone joined after us
socket.on("user-joined", ({ socketId, name }) => {
  statusEl.textContent = `${name} joined`;
  // save remote peer id (2-person flow)
  remotePeerId = socketId;
});

// receive offer
socket.on("offer", async ({ from, sdp }) => {
  remotePeerId = from;

  if (!localStream) await startMedia();
  createPeer();

  await peerConnection.setRemoteDescription(sdp);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  socket.emit("answer", { to: remotePeerId, sdp: answer });
});

// receive answer
socket.on("answer", async ({ from, sdp }) => {
  remotePeerId = from;
  await peerConnection.setRemoteDescription(sdp);
});

// receive ICE
socket.on("ice-candidate", async ({ candidate }) => {
  try {
    await peerConnection.addIceCandidate(candidate);
  } catch (e) {
    console.error("ICE error", e);
  }
});

// ---------- Chat ----------
document.getElementById("sendBtn").onclick = () => {
  const message = document.getElementById("msg").value.trim();
  const name = document.getElementById("name").value.trim() || "Guest";
  if (!message || !roomId) return;

  socket.emit("chat", { roomId, message, name });
  document.getElementById("msg").value = "";
};

socket.on("chat", ({ message, name, ts }) => {
  const div = document.createElement("div");
  div.className = "msg";
  div.innerHTML = `<b>${escapeHtml(name)}:</b> ${escapeHtml(message)} <small>${new Date(ts).toLocaleTimeString()}</small>`;
  const box = document.getElementById("messages");
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
});

// ---------- Mic/Cam toggles ----------
document.getElementById("toggleMic").onclick = () => {
  if (!localStream) return;
  const audio = localStream.getAudioTracks()[0];
  audio.enabled = !audio.enabled;
  document.getElementById("toggleMic").textContent = `Mic: ${audio.enabled ? "On" : "Off"}`;
};

document.getElementById("toggleCam").onclick = () => {
  if (!localStream) return;
  const video = localStream.getVideoTracks()[0];
  video.enabled = !video.enabled;
  document.getElementById("toggleCam").textContent = `Cam: ${video.enabled ? "On" : "Off"}`;
};

function escapeHtml(s) {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
