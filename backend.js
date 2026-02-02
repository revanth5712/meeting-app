import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// ---------- DB: Meeting scheduling ----------
await mongoose.connect(process.env.MONGO_URI);

const MeetingSchema = new mongoose.Schema({
  meetingId: { type: String, required: true, unique: true },
  title: { type: String, default: "" },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
});

const Meeting = mongoose.model("Meeting", MeetingSchema);

// helper: simple random meeting id
function genMeetingId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

// Create a scheduled meeting
app.post("/api/meetings", async (req, res) => {
  const { title, startsAt, endsAt } = req.body;
  if (!startsAt || !endsAt) return res.status(400).json({ error: "startsAt and endsAt required" });

  const meetingId = genMeetingId();
  const meeting = await Meeting.create({ meetingId, title, startsAt, endsAt });
  res.json(meeting);
});

// Get meeting details
app.get("/api/meetings/:meetingId", async (req, res) => {
  const meeting = await Meeting.findOne({ meetingId: req.params.meetingId });
  if (!meeting) return res.status(404).json({ error: "Meeting not found" });
  res.json(meeting);
});

// List upcoming meetings
app.get("/api/meetings", async (req, res) => {
  const now = new Date();
  const meetings = await Meeting.find({ endsAt: { $gte: now } }).sort({ startsAt: 1 }).limit(50);
  res.json(meetings);
});

// ---------- WebRTC signaling with Socket.IO ----------
/**
 * Rooms:
 * - Each meetingId is a Socket.IO room.
 * - We relay: offer, answer, ice-candidate between peers.
 * - For multi-party (3+), you need SFU (mediasoup/Janus) or mesh.
 *   This demo is best for 2 people; can be extended to mesh.
 */

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, name }) => {
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.name = name || "Guest";

    // tell others someone joined
    socket.to(roomId).emit("user-joined", { socketId: socket.id, name: socket.data.name });

    // also tell the joiner who is already in the room
    const clients = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
    const others = clients.filter(id => id !== socket.id);
    socket.emit("room-users", others);
  });

  socket.on("offer", ({ to, sdp }) => {
    io.to(to).emit("offer", { from: socket.id, sdp });
  });

  socket.on("answer", ({ to, sdp }) => {
    io.to(to).emit("answer", { from: socket.id, sdp });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  socket.on("chat", ({ roomId, message, name }) => {
    io.to(roomId).emit("chat", { message, name: name || socket.data.name, ts: Date.now() });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit("user-left", { socketId: socket.id });
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on http://localhost:${port}`));
