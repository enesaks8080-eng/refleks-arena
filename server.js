const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true }));

const rooms = new Map();
const PORT = process.env.PORT || 3000;
const TICK_MS = 33;
const START_SPEED = 0.009;
const MAX_SPEED = 0.019;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const code = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, ready: p.ready })),
    round: room.round,
    bracket: room.bracket.map(m => ({
      id: m.id, round: m.round, players: m.players.map(id => {
        const p = room.players.get(id); return p ? { id, name: p.name } : null;
      }), winner: m.winner
    })),
    currentMatch: room.currentMatch ? {
      id: room.currentMatch.id,
      players: room.currentMatch.players.map(id => {
        const p = room.players.get(id); return p ? { id, name: p.name } : null;
      }),
      score: room.currentMatch.score,
      ball: room.currentMatch.ball,
      speed: room.currentMatch.speed,
      phase: room.currentMatch.phase,
      lastHit: room.currentMatch.lastHit
    } : null
  };
}
function emitRoom(room) { io.to(room.code).emit("room:update", publicRoom(room)); }
function emitError(socket, message) { socket.emit("app:error", message); }
function playerRoom(socket) {
  for (const room of rooms.values()) if (room.players.has(socket.id)) return room;
  return null;
}
function createMatch(room, ids, round) {
  return { id: crypto.randomUUID(), players: ids, round, score: [0,0], ball: .5,
    dir: Math.random() < .5 ? -1 : 1, speed: START_SPEED, phase: "countdown",
    lastHit: null, lastHitAt: 0, startedAt: Date.now(), timer: null };
}
function startMatch(room, match) {
  room.currentMatch = match;
  match.phase = "countdown";
  io.to(room.code).emit("match:countdown", { seconds: 3, matchId: match.id });
  emitRoom(room);
  setTimeout(() => {
    if (room.currentMatch?.id !== match.id) return;
    match.phase = "playing";
    match.ball = .5;
    match.dir = Math.random() < .5 ? -1 : 1;
    match.speed = START_SPEED;
    match.lastTick = Date.now();
    emitRoom(room);
    match.timer = setInterval(() => tick(room, match), TICK_MS);
  }, 3000);
}
function stopMatch(match) { if (match?.timer) clearInterval(match.timer); }
function tick(room, match) {
  if (room.currentMatch?.id !== match.id || match.phase !== "playing") return;
  const now = Date.now();
  const dt = clamp(now - match.lastTick, 16, 50);
  match.lastTick = now;
  match.ball += match.dir * match.speed * (dt / 16.67);
  if (match.ball <= 0) { finishPoint(room, match, 1); return; } // top player missed; bottom wins
  if (match.ball >= 1) { finishPoint(room, match, 0); return; } // bottom player missed; top wins

  // A player has a short reaction window while the ball is in their green zone.
  if (match.dir > 0 && match.ball >= .83 && now - match.lastHitAt > 700) {
    // Do not award a point immediately; player can still tap until the back edge.
  }
  if (match.dir < 0 && match.ball <= .17 && now - match.lastHitAt > 700) {
    // Same receiving window for the top player.
  }
  io.to(room.code).emit("match:state", {
    matchId: match.id, ball: match.ball, dir: match.dir, speed: match.speed,
    score: match.score, phase: match.phase, lastHit: match.lastHit
  });
}
function finishPoint(room, match, winnerIndex) {
  stopMatch(match);
  match.score[winnerIndex]++;
  match.phase = "point";
  io.to(room.code).emit("match:point", { winnerId: match.players[winnerIndex], score: match.score });
  if (match.score[winnerIndex] >= 5) {
    const winnerId = match.players[winnerIndex];
    match.winner = winnerId;
    match.phase = "finished";
    io.to(room.code).emit("match:finished", { winnerId, winnerName: room.players.get(winnerId)?.name, score: match.score });
    const bracketMatch = room.bracket.find(m => m.id === match.id);
    if (bracketMatch) bracketMatch.winner = winnerId;
    room.currentMatch = null;
    setTimeout(() => advanceTournament(room, winnerId), 1800);
  } else {
    emitRoom(room);
    setTimeout(() => {
      if (room.currentMatch?.id !== match.id) return;
      match.phase = "countdown";
      match.ball = .5;
      match.dir = Math.random() < .5 ? -1 : 1;
      match.speed = .0105;
      io.to(room.code).emit("match:countdown", { seconds: 2, matchId: match.id });
      setTimeout(() => {
        if (room.currentMatch?.id !== match.id) return;
        match.phase = "playing"; match.lastTick = Date.now();
        match.timer = setInterval(() => tick(room, match), TICK_MS);
        emitRoom(room);
      }, 2000);
    }, 900);
  }
}
function advanceTournament(room, winnerId) {
  if (room.status !== "tournament") return;
  // Play every pairing in the current round one after another.
  const pending = room.bracket.find(m => m.round === room.round && !m.winner && m.phase !== "finished");
  if (pending) { startMatch(room, pending); emitRoom(room); return; }

  const roundWinners = room.bracket.filter(m => m.round === room.round).map(m => m.winner).filter(Boolean);
  const winners = [...roundWinners, ...(room.byes || [])];
  room.byes = [];
  if (winners.length <= 1) {
    room.status = "finished";
    room.champion = winners[0] || winnerId;
    io.to(room.code).emit("tournament:finished", { champion: room.players.get(room.champion)?.name || "Şampiyon" });
    emitRoom(room); return;
  }

  room.round++;
  const nextRoundMatches = [];
  for (let i=0; i<winners.length; i+=2) {
    if (i+1 >= winners.length) { room.byes.push(winners[i]); continue; }
    const m = createMatch(room, [winners[i], winners[i+1]], room.round);
    room.bracket.push(m); nextRoundMatches.push(m);
  }
  if (nextRoundMatches.length) startMatch(room, nextRoundMatches[0]);
  else {
    room.status = "finished"; room.champion = room.byes[0];
    io.to(room.code).emit("tournament:finished", { champion: room.players.get(room.champion)?.name || "Şampiyon" });
  }
  emitRoom(room);
}
function beginTournament(room) {
  const ids = [...room.players.keys()];
  if (ids.length < 2) return false;
  // Randomized single-elimination bracket. An odd player count gets a bye.
  for (let i=ids.length-1; i>0; i--) { const j=Math.floor(Math.random()*(i+1)); [ids[i],ids[j]]=[ids[j],ids[i]]; }
  room.status = "tournament"; room.round = 1; room.bracket = []; room.byes = [];
  for (let i=0; i<ids.length; i+=2) {
    if (i+1 >= ids.length) { room.byes.push(ids[i]); continue; }
    const m = createMatch(room, [ids[i], ids[i+1]], 1);
    room.bracket.push(m);
  }
  emitRoom(room);
  const firstMatch = room.bracket.find(m => m.round === 1);
  if (firstMatch) startMatch(room, firstMatch);
  else if (room.byes.length === 1) {
    room.status = "finished"; room.champion = room.byes[0];
    io.to(room.code).emit("tournament:finished", { champion: room.players.get(room.champion)?.name });
  }
  return true;
}

io.on("connection", socket => {
  socket.on("room:create", ({ name }) => {
    const roomCode = code();
    const player = { id: socket.id, name: String(name || "Oyuncu").slice(0,18), ready: true };
    const room = { code: roomCode, hostId: socket.id, players: new Map([[socket.id, player]]),
      status: "lobby", round: 0, bracket: [], currentMatch: null };
    rooms.set(roomCode, room); socket.join(roomCode);
    socket.emit("room:joined", { code: roomCode, playerId: socket.id, host: true });
    emitRoom(room);
  });
  socket.on("room:join", ({ code: roomCode, name }) => {
    const room = rooms.get(String(roomCode || "").toUpperCase());
    if (!room) return emitError(socket, "Bu oda koduyla bir oda bulunamadı.");
    if (room.status !== "lobby") return emitError(socket, "Turnuva başlamış; yeni oyuncu alınmıyor.");
    const player = { id: socket.id, name: String(name || "Oyuncu").slice(0,18), ready: true };
    room.players.set(socket.id, player); socket.join(room.code);
    socket.emit("room:joined", { code: room.code, playerId: socket.id, host: false });
    emitRoom(room);
  });
  socket.on("tournament:start", () => {
    const room = playerRoom(socket);
    if (!room || room.hostId !== socket.id) return emitError(socket, "Turnuvayı yalnızca oda sahibi başlatabilir.");
    if (room.players.size < 2) return emitError(socket, "Başlamak için en az 2 oyuncu gerekli.");
    if (!beginTournament(room)) return emitError(socket, "Turnuva başlatılamadı.");
  });
  socket.on("match:hit", () => {
  const room = playerRoom(socket);
  const match = room?.currentMatch;

  if (!room || !match || match.phase !== "playing") {
    socket.emit("match:hit-result", { ok: false });
    return;
  }

  const playerIndex = match.players.indexOf(socket.id);

  if (playerIndex < 0) return;

  // Her oyuncunun ekranında top kendisine doğru gelir.
  const localBall = playerIndex === 0
    ? 1 - match.ball
    : match.ball;

  const movingTowardPlayer = playerIndex === 0
    ? match.dir < 0
    : match.dir > 0;

  if (!movingTowardPlayer || localBall < 0.78 || localBall >= 1) {
    socket.emit("match:hit-result", { ok: false });
    return;
  }

  const depth = (localBall - 0.78) / 0.22;
  const cell = Math.min(8, Math.floor(depth * 8) + 1);

  // İlk 4 hücre normal, son 4 hücre süper vuruş.
  const hot = cell >= 5;

  match.dir *= -1;
  match.speed = Math.min(
    MAX_SPEED,
    match.speed + (hot ? 0.00065 : 0.00035)
  );

  match.lastHit = {
    playerId: socket.id,
    hot,
    cell,
    depth,
    at: Date.now()
  };

  socket.emit("match:hit-result", {
    ok: true,
    hot,
    cell
  });

  io.to(room.code).emit("match:hit", {
    playerId: socket.id,
    hot,
    speed: match.speed,
    cell
  });

  io.to(room.code).emit("match:state", {
    matchId: match.id,
    ball: match.ball,
    dir: match.dir,
    speed: match.speed,
    score: match.score,
    phase: match.phase,
    lastHit: match.lastHit
  });
});
});

server.listen(PORT, () => {
  console.log(`Refleks Arena ${PORT} portunda çalışıyor.`);
});
