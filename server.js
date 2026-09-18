'use strict';

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  pingTimeout: 30000,
  pingInterval: 10000,
  maxHttpBufferSize: 1000000
});

const PORT = Number(process.env.PORT || 10000);
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

/* CONFIG */
const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;
const TURN_SECONDS = 20;
const RECONNECT_MS = 45000;
const TRICK_CLEAR_DELAY = 1800;

const CAPACITIES = [3, 4];
const STAKES = [5, 10, 25, 50, 100];
const MAX_PARTIES = 4;

const CARD_VALUES = {
  '6': 0, '7': 0, '8': 0, '9': 0,
  'J': 2, 'Q': 3, 'K': 4, '10': 10, 'A': 11
};

const RANKS = ['6', '7', '8', '9', 'J', 'Q', 'K', '10', 'A'];
const SUITS = ['spades', 'clubs', 'diamonds', 'hearts'];
const TRUMPS = ['spades', 'clubs', 'diamonds', 'hearts', 'no_trump'];

const rooms = new Map();
const users = new Map();
const sessions = new Map();

const scryptAsync = promisify(crypto.scrypt);
let saveTimer = null;

/* HELPERS */
function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function clean(val) {
  return String(val || '').trim().replace(/\s+/g, ' ').slice(0, 24);
}

function lower(val) {
  return clean(val).toLowerCase();
}

function isTester(name) {
  return lower(name) === TESTER_NAME.toLowerCase();
}

function rankIndex(card) {
  return RANKS.indexOf(card.rank);
}

function isTrump(card, trump) {
  return trump !== 'no_trump' && card.suit === trump;
}

function suitSymbol(suit) {
  return { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣', no_trump: '★' }[suit] || '★';
}

/* CARDS & MATCHING */
function createDeck() {
  const deck = [];
  SUITS.forEach(s => {
    RANKS.forEach(r => {
      deck.push({ id: uid('card'), suit: s, rank: r, value: CARD_VALUES[r] });
    });
  });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardBeats(defender, attacker, trump) {
  const defTrump = isTrump(defender, trump);
  const atkTrump = isTrump(attacker, trump);

  if (atkTrump && !defTrump) return true;
  if (defTrump && !atkTrump) return false;
  if (defender.suit !== attacker.suit) return false;
  return rankIndex(attacker) > rankIndex(defender);
}

function canBeatSet(defenders, attackers, trump) {
  if (!Array.isArray(defenders) || !Array.isArray(attackers) || defenders.length !== attackers.length) {
    return false;
  }
  const used = new Array(attackers.length).fill(false);

  function search(index) {
    if (index >= defenders.length) return true;
    for (let i = 0; i < attackers.length; i++) {
      if (used[i]) continue;
      if (!cardBeats(defenders[index], attackers[i], trump)) continue;
      used[i] = true;
      if (search(index + 1)) return true;
      used[i] = false;
    }
    return false;
  }
  return search(0);
}

function winnerIndex(table, trump) {
  if (!table.length) return -1;
  let winner = 0;
  for (let i = 1; i < table.length; i++) {
    if (canBeatSet(table[winner].cards, table[i].cards, trump)) {
      winner = i;
    }
  }
  return winner;
}

/* EXPRESS ROUTES */
app.get('/', (req, res) => {
  res.status(200).type('html').send(PAGE);
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, rooms: rooms.size, timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).type('html').send('<h1>404 — Page Not Found</h1>');
});

/* MONOLITHIC PAGE */
const PAGE = String.raw`<!doctype html>
<html lang="ka">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Written Bura Online</title>
<script src="/socket.io/socket.io.js"></script>
<style>
* { box-sizing: border-box; }
body { margin: 0; font-family: sans-serif; background: #050a09; color: #fff; overflow-x: hidden; }
.glass { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(10px); border-radius: 16px; }
.card { width: 60px; height: 90px; background: #fff; color: #000; border-radius: 8px; display: inline-flex; flex-direction: column; align-items: center; justify-content: center; font-weight: bold; margin: 2px; position: relative; user-select: none; }
.card.selected { transform: translateY(-15px); box-shadow: 0 0 10px #gold; border: 2px solid #e9c46a; }
.playGroup.winner .card { box-shadow: 0 0 15px #e9c46a; filter: brightness(1.2); }
#lobby, #game { padding: 20px; max-width: 1000px; margin: auto; }
.hidden { display: none !important; }
</style>
</head>
<body>

<div id="lobby" class="glass">
  <h1>WRITTEN <span>BURA</span></h1>
  <input id="username" placeholder="სახელი" value="saba123" />
  <button onclick="joinTable()">თამაშში შესვლა</button>
</div>

<div id="game" class="hidden">
  <h2>თამაში მიმდინარეობს</h2>
  <div id="status"></div>
  <div id="tableCards"></div>
  <div id="myHand"></div>
  <button id="playBtn" onclick="playSelected()">სვლის გაკეთება</button>
</div>

<script>
const socket = io();
let selected = [];

function joinTable() {
  const name = document.getElementById('username').value;
  socket.emit('joinTable', { name, capacity: 4, parties: 1, stake: 5 });
}

socket.on('gameStateUpdate', state => {
  document.getElementById('lobby').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  document.getElementById('status').textContent = state.processing ? 'ტრიკის დასრულება...' : 'შენი სვლა';
});

function playSelected() {
  socket.emit('playCards', { cardIndices: selected });
  selected = [];
}
</script>
</body>
</html>`;

/* BOOT */
server.listen(PORT, '0.0.0.0', () => {
  console.log(`==========================================`);
  console.log(` WRITTEN BURA SERVER READY ON PORT ${PORT}`);
  console.log(`==========================================`);
});
