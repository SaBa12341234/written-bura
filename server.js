'use strict';

/*
  ============================================================
  WRITTEN BURA — MONOLITHIC server.js
  Express 5 / Render routing fixed
  ============================================================

  Install:
    npm install express socket.io

  package.json:
    {
      "scripts": {
        "start": "node server.js"
      }
    }

  Render Start Command:
    npm start

  IMPORTANT:
  - public/ folder is NOT required.
  - HTML/CSS/client JS are inside PAGE.
  - Express 5 incompatible app.get('*', ...) is NOT used.
  ============================================================
*/

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
app.use(express.urlencoded({
  extended: true,
  limit: '1mb'
}));

/* ============================================================
   CONFIG
   ============================================================ */

const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;
const TURN_SECONDS = 20;
const RECONNECT_MS = 30000;
const TRICK_CLEAR_DELAY = 1800;

const RANK_TIERS = [
  { name: 'Bronze', icon: '🥉', min: 0 },
  { name: 'Silver', icon: '🥈', min: 1000 },
  { name: 'Gold', icon: '🥇', min: 1200 },
  { name: 'Platinum', icon: '💠', min: 1400 },
  { name: 'Diamond', icon: '👑', min: 1600 }
];

const FREE_FELTS = [
  'classic',
  'royal',
  'wine',
  'violet',
  'obsidian'
];

const SHOP_ITEMS = [
  { id: 'felt_sunset', type: 'felt', name: 'მზის ჩასვლა', price: 300 },
  { id: 'felt_neon', type: 'felt', name: 'ნეონი', price: 300 },
  { id: 'felt_galaxy', type: 'felt', name: 'გალაქტიკა', price: 500 },
  { id: 'felt_rosegold', type: 'felt', name: 'ვარდისფერი ოქრო', price: 500 },
  { id: 'frame_bronze', type: 'frame', name: 'ბრინჯაოს ჩარჩო', price: 150 },
  { id: 'frame_silver', type: 'frame', name: 'ვერცხლის ჩარჩო', price: 250 },
  { id: 'frame_gold', type: 'frame', name: 'ოქროს ჩარჩო', price: 400 },
  { id: 'frame_diamond', type: 'frame', name: 'ბრილიანტის ჩარჩო', price: 700 }
];

const CAPACITIES = [3, 4];
const STAKES = [5, 10, 25, 50, 100];
const MAX_PARTIES = 4;

const VALUES = {
  '6': 0,
  '7': 0,
  '8': 0,
  '9': 0,
  'J': 2,
  'Q': 3,
  'K': 4,
  '10': 10,
  'A': 11
};

const RANKS = [
  '6', '7', '8', '9',
  'J', 'Q', 'K', '10', 'A'
];

const SUITS = [
  'spades',
  'clubs',
  'diamonds',
  'hearts'
];

const TRUMPS = [
  'spades',
  'clubs',
  'diamonds',
  'hearts',
  'no_trump'
];

const rooms = new Map();
const users = new Map();
const sessions = new Map();

const scryptAsync = promisify(crypto.scrypt);

let saveTimer = null;

/* ============================================================
   HELPERS
   ============================================================ */

function uid(prefix) {
  return (
    (prefix || 'id') +
    '_' +
    Date.now().toString(36) +
    '_' +
    crypto.randomBytes(5).toString('hex')
  );
}

function clean(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function lower(value) {
  return clean(value).toLowerCase();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function rand(min, max) {
  return Math.floor(
    Math.random() * (max - min + 1)
  ) + min;
}

function isTester(name) {
  return lower(name) === TESTER_NAME.toLowerCase();
}

function rankOf(rating) {
  let tier = RANK_TIERS[0];

  RANK_TIERS.forEach(function (candidate) {
    if (rating >= candidate.min) {
      tier = candidate;
    }
  });

  return tier;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const msPerDay = 24 * 60 * 60 * 1000;

  return Math.round(
    (
      new Date(b + 'T00:00:00Z').getTime() -
      new Date(a + 'T00:00:00Z').getTime()
    ) / msPerDay
  );
}

function suitSymbol(suit) {
  return {
    spades: '♠',
    hearts: '♥',
    diamonds: '♦',
    clubs: '♣',
    no_trump: '★'
  }[suit] || '★';
}

/* ============================================================
   USERS / AUTH
   ============================================================ */

function defaultQuests() {
  return {
    date: today(),

    wins: 0,
    maliutka: 0,
    tables: 0,

    tableIds: [],

    rewards: {
      wins: false,
      maliutka: false,
      tables: false
    }
  };
}

function defaults(user) {
  user.avatar = user.avatar || '🦊';
  user.xp = Number(user.xp || 0);
  user.level = Math.floor(user.xp / 100) + 1;
  user.wins = Number(user.wins || 0);

  user.balance = Number(
    user.balance === undefined
      ? START_BALANCE
      : user.balance
  );

  user.achievements = Array.isArray(user.achievements)
    ? user.achievements
    : [];

  if (
    !user.quests ||
    user.quests.date !== today()
  ) {
    user.quests = defaultQuests();
  }

  /*
    Rating / ranking.
  */

  user.rating = Number(
    user.rating === undefined
      ? 1000
      : user.rating
  );

  /*
    Virtual coin economy (cosmetics only,
    never redeemable for real money).
  */

  user.coins = Number(
    user.coins === undefined
      ? 200
      : user.coins
  );

  user.inventory =
    user.inventory &&
    typeof user.inventory === 'object'
      ? user.inventory
      : {};

  user.inventory.felts =
    Array.isArray(user.inventory.felts)
      ? user.inventory.felts
      : FREE_FELTS.slice();

  user.inventory.frames =
    Array.isArray(user.inventory.frames)
      ? user.inventory.frames
      : ['none'];

  user.equipped =
    user.equipped &&
    typeof user.equipped === 'object'
      ? user.equipped
      : { felt: 'classic', frame: 'none' };

  /*
    Lifetime stats.
  */

  user.stats =
    user.stats &&
    typeof user.stats === 'object'
      ? user.stats
      : {};

  user.stats.handsPlayed = Number(user.stats.handsPlayed || 0);
  user.stats.handsWon = Number(user.stats.handsWon || 0);
  user.stats.partiesPlayed = Number(user.stats.partiesPlayed || 0);
  user.stats.partiesWon = Number(user.stats.partiesWon || 0);
  user.stats.biggestWin = Number(user.stats.biggestWin || 0);
  user.stats.winStreak = Number(user.stats.winStreak || 0);
  user.stats.bestWinStreak = Number(user.stats.bestWinStreak || 0);
  user.stats.recentParties =
    Array.isArray(user.stats.recentParties)
      ? user.stats.recentParties.slice(-20)
      : [];

  /*
    Friends.
  */

  user.friends = Array.isArray(user.friends)
    ? user.friends
    : [];

  /*
    Daily login streak.
  */

  user.loginStreak = Number(user.loginStreak || 0);
  user.lastLoginDate = user.lastLoginDate || null;

  /*
    Responsible-gaming self-exclusion.
    null = not excluded, 'forever' = permanent,
    or an ISO date string until which login is blocked.
  */

  user.selfExcludedUntil =
    user.selfExcludedUntil || null;

  user.language = user.language || 'ka';

  return user;
}

function profile(user) {
  defaults(user);

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    xp: user.xp,
    level: user.level,
    wins: user.wins,
    balance: user.balance,
    quests: user.quests,
    achievements: user.achievements,

    rating: user.rating,
    rank: rankOf(user.rating),

    coins: user.coins,
    inventory: user.inventory,
    equipped: user.equipped,

    stats: user.stats,
    friends: user.friends,

    loginStreak: user.loginStreak,

    selfExcludedUntil: user.selfExcludedUntil,
    language: user.language
  };
}

function findUser(username) {
  const name = lower(username);

  return (
    Array.from(users.values()).find(function (user) {
      return lower(user.username) === name;
    }) || null
  );
}

async function passwordHash(password, salt) {
  const result = await scryptAsync(
    String(password),
    salt,
    64
  );

  return Buffer.from(result).toString('hex');
}

async function makePassword(password) {
  const salt = crypto
    .randomBytes(16)
    .toString('hex');

  return {
    salt: salt,
    hash: await passwordHash(password, salt)
  };
}

async function checkPassword(password, user) {
  try {
    if (!user.passwordSalt || !user.passwordHash) {
      return false;
    }

    const value = await passwordHash(
      password,
      user.passwordSalt
    );

    const a = Buffer.from(value, 'hex');
    const b = Buffer.from(user.passwordHash, 'hex');

    return (
      a.length === b.length &&
      crypto.timingSafeEqual(a, b)
    );
  } catch (error) {
    return false;
  }
}

function validAvatar(value) {
  const avatar = String(value || '');

  if (!avatar) {
    return '🦊';
  }

  if (avatar.length <= 20) {
    return avatar;
  }

  if (
    /^data:image\/(png|jpeg|jpg|webp);base64,/i.test(avatar) &&
    avatar.length < 700000
  ) {
    return avatar;
  }

  return '🦊';
}

async function loadUsers() {
  try {
    const raw = await fs.promises.readFile(
      USERS_FILE,
      'utf8'
    );

    const parsed = JSON.parse(raw);

    const list = Array.isArray(parsed)
      ? parsed
      : parsed.users || [];

    list.forEach(function (user) {
      if (
        user &&
        user.id &&
        user.username
      ) {
        defaults(user);
        users.set(user.id, user);
      }
    });

    console.log(
      '[USERS] loaded:',
      users.size
    );
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(
        '[USERS] load error:',
        error.message
      );
    }
  }
}

async function saveUsersNow() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  const list = Array
    .from(users.values())
    .map(function (user) {
      const copy = Object.assign({}, user);

      delete copy.socketId;
      delete copy.roomId;

      return copy;
    });

  try {
    await fs.promises.writeFile(
      USERS_FILE,
      JSON.stringify(
        { users: list },
        null,
        2
      ),
      'utf8'
    );
  } catch (error) {
    console.error(
      '[USERS] save error:',
      error.message
    );
  }
}

function saveLater() {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }

  saveTimer = setTimeout(function () {
    saveTimer = null;

    saveUsersNow().catch(function (error) {
      console.error(error);
    });
  }, 4000);
}

function friendSummary(user) {
  if (!user) {
    return null;
  }

  defaults(user);

  return {
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    level: user.level,
    rating: user.rating,
    rank: rankOf(user.rating),
    online: !!user.socketId
  };
}

function applyLoginStreak(user) {
  defaults(user);

  const key = todayKey();

  if (user.lastLoginDate === key) {
    return 0;
  }

  const diff =
    user.lastLoginDate
      ? daysBetween(user.lastLoginDate, key)
      : null;

  if (diff === 1) {
    user.loginStreak += 1;
  } else {
    user.loginStreak = 1;
  }

  user.lastLoginDate = key;

  const bonus =
    Math.min(200, 20 * user.loginStreak);

  user.coins =
    Number(user.coins || 0) + bonus;

  saveLater();

  return bonus;
}

function isExcluded(user) {
  if (!user || !user.selfExcludedUntil) {
    return false;
  }

  if (user.selfExcludedUntil === 'forever') {
    return true;
  }

  return (
    new Date(user.selfExcludedUntil).getTime() >
    Date.now()
  );
}

function newSession(user) {
  const token = crypto
    .randomBytes(32)
    .toString('hex');

  sessions.set(token, {
    userId: user.id
  });

  return token;
}

function addXP(user, amount) {
  if (!user) {
    return;
  }

  user.xp += Number(amount || 0);
  user.level =
    Math.floor(user.xp / 100) + 1;

  saveLater();

  if (user.socketId) {
    io.to(user.socketId).emit(
      'profileUpdate',
      profile(user)
    );
  }
}

function checkQuests(user) {
  defaults(user);

  const quest = user.quests;

  let bonus = 0;

  if (
    quest.wins >= 3 &&
    !quest.rewards.wins
  ) {
    quest.rewards.wins = true;
    bonus += 100;
  }

  if (
    quest.maliutka >= 1 &&
    !quest.rewards.maliutka
  ) {
    quest.rewards.maliutka = true;
    bonus += 250;
  }

  if (
    quest.tables >= 5 &&
    !quest.rewards.tables
  ) {
    quest.rewards.tables = true;
    bonus += 50;
  }

  if (bonus) {
    addXP(user, bonus);
  }

  saveLater();
}

function playedTable(user, roomId) {
  if (!user) {
    return;
  }

  defaults(user);

  if (!user.quests.tableIds.includes(roomId)) {
    user.quests.tableIds.push(roomId);
    user.quests.tables += 1;

    checkQuests(user);
  }
}

/* ============================================================
   CARDS
   ============================================================ */

function canonicalDeck() {
  const cards = [];

  SUITS.forEach(function (suit) {
    RANKS.forEach(function (rankName) {
      cards.push({
        id: uid('card'),
        suit: suit,
        rank: rankName
      });
    });
  });

  return cards;
}

/*
  Deterministic byte stream derived from a seed via
  chained SHA-256 hashing. Given the same seed this
  always produces the same shuffle, which is what
  lets a revealed seed be independently verified.
*/

function seedStream(seed) {
  let block = crypto
    .createHash('sha256')
    .update(String(seed))
    .digest();

  let cursor = 0;

  return function nextByte() {
    if (cursor >= block.length) {
      block = crypto
        .createHash('sha256')
        .update(block)
        .digest();

      cursor = 0;
    }

    return block[cursor++];
  };
}

function seededShuffle(cards, seed) {
  const nextByte = seedStream(seed);
  const arr = cards.slice();

  for (
    let i = arr.length - 1;
    i > 0;
    i--
  ) {
    const j = nextByte() % (i + 1);

    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }

  return arr;
}

function makeFairness(room, handIndex) {
  const seed = crypto
    .randomBytes(32)
    .toString('hex');

  const hash = crypto
    .createHash('sha256')
    .update(seed)
    .digest('hex');

  return {
    seed: seed,
    hash: hash,
    seedInput:
      seed + ':' + room.id + ':' + handIndex,
    revealed: false
  };
}

function createDeck() {
  return seededShuffle(
    canonicalDeck(),
    crypto.randomBytes(16).toString('hex')
  );
}

function cardPoints(card) {
  return VALUES[card.rank] || 0;
}

function rankIndex(card) {
  return RANKS.indexOf(card.rank);
}

function isTrump(card, trump) {
  return (
    trump !== 'no_trump' &&
    card.suit === trump
  );
}

function sameSuit(cards) {
  return (
    cards.length > 0 &&
    cards.every(function (card) {
      return card.suit === cards[0].suit;
    })
  );
}

function isMaliutka(cards) {
  return (
    cards.length === 5 &&
    sameSuit(cards)
  );
}

/* ============================================================
   BURA CUTTING LOGIC
   ============================================================ */

/*
  defender = current winning card
  attacker = newly played card

  true means attacker beats defender.
*/

function cardBeats(defender, attacker, trump) {
  const defenderTrump =
    isTrump(defender, trump);

  const attackerTrump =
    isTrump(attacker, trump);

  if (
    attackerTrump &&
    !defenderTrump
  ) {
    return true;
  }

  if (
    defenderTrump &&
    !attackerTrump
  ) {
    return false;
  }

  if (
    defender.suit !== attacker.suit
  ) {
    return false;
  }

  return (
    rankIndex(attacker) >
    rankIndex(defender)
  );
}

/*
  Robust bipartite/backtracking matching.

  Every attacker card must uniquely beat one
  defender card.

  This avoids incorrect sorted-array pairing.
*/

function canBeatSet(defenders, attackers, trump) {
  if (
    !Array.isArray(defenders) ||
    !Array.isArray(attackers) ||
    defenders.length !== attackers.length
  ) {
    return false;
  }

  const used = new Array(
    attackers.length
  ).fill(false);

  /*
    Hardest defenders first helps pruning.
  */

  const orderedDefenders =
    defenders
      .slice()
      .sort(function (a, b) {
        const at = isTrump(a, trump) ? 1 : 0;
        const bt = isTrump(b, trump) ? 1 : 0;

        if (at !== bt) {
          return bt - at;
        }

        return (
          rankIndex(b) -
          rankIndex(a)
        );
      });

  function search(index) {
    if (
      index >= orderedDefenders.length
    ) {
      return true;
    }

    const defender =
      orderedDefenders[index];

    for (
      let i = 0;
      i < attackers.length;
      i++
    ) {
      if (used[i]) {
        continue;
      }

      if (
        !cardBeats(
          defender,
          attackers[i],
          trump
        )
      ) {
        continue;
      }

      used[i] = true;

      if (search(index + 1)) {
        return true;
      }

      used[i] = false;
    }

    return false;
  }

  return search(0);
}

function winnerIndex(table, trump) {
  if (!table.length) {
    return -1;
  }

  let winner = 0;

  for (
    let i = 1;
    i < table.length;
    i++
  ) {
    if (
      canBeatSet(
        table[winner].cards,
        table[i].cards,
        trump
      )
    ) {
      winner = i;
    }
  }

  return winner;
}

function sameSuitPossible(hand, count) {
  const counts = {};

  hand.forEach(function (card) {
    counts[card.suit] =
      (counts[card.suit] || 0) + 1;
  });

  return Object
    .keys(counts)
    .some(function (suit) {
      return counts[suit] >= count;
    });
}

/* ============================================================
   ROOM / PLAYERS
   ============================================================ */

function makeRoom(
  name,
  capacity,
  parties,
  stake
) {
  const room = {
    id: uid('room'),

    name:
      clean(name) ||
      'Written Bura',

    capacity:
      CAPACITIES.includes(Number(capacity))
        ? Number(capacity)
        : 4,

    parties:
      Math.max(
        1,
        Math.min(
          MAX_PARTIES,
          Number(parties) || 1
        )
      ),

    stake:
      STAKES.includes(Number(stake))
        ? Number(stake)
        : 5,

    players: [],
    game: null,

    timer: null,
    botTimer: null
  };

  rooms.set(room.id, room);

  broadcastLobby();

  return room;
}

function createHumanPlayer(
  user,
  socket,
  guestName
) {
  return {
    id:
      user
        ? user.id
        : uid('guest'),

    userId:
      user
        ? user.id
        : null,

    name:
      user
        ? user.username
        : (
          clean(guestName) ||
          'Guest'
        ),

    avatar:
      user
        ? user.avatar
        : '😎',

    socketId: socket.id,

    isBot: false,
    connected: true,

    hand: [],
    captured: [],

    total: 0,
    lastRaw: 0,

    xp:
      user
        ? user.xp
        : 0,

    level:
      user
        ? user.level
        : 1,

    wins:
      user
        ? user.wins
        : 0,

    reconnectTimer: null
  };
}

function createBot(number) {
  return {
    id: uid('bot'),
    userId: null,

    name: 'BOT ' + number,
    avatar: '🤖',

    socketId: null,

    isBot: true,
    connected: true,

    hand: [],
    captured: [],

    total: 0,
    lastRaw: 0,

    xp: 0,
    level: rand(2, 8),
    wins: 0,

    reconnectTimer: null
  };
}

function userOf(player) {
  if (
    !player ||
    !player.userId
  ) {
    return null;
  }

  return users.get(player.userId) || null;
}

function fillBots(room) {
  let number = 1;

  while (
    room.players.length <
    room.capacity
  ) {
    room.players.push(
      createBot(number++)
    );
  }
}

/* ============================================================
   GAME START
   ============================================================ */

function startHand(room, previousGame) {
  const handIndex =
    previousGame
      ? previousGame.handIndex + 1
      : 1;

  const fairness =
    makeFairness(room, handIndex);

  const cards =
    seededShuffle(
      canonicalDeck(),
      fairness.seedInput
    );

  const partyIndex =
    Math.ceil(handIndex / 5);

  const trump =
    TRUMPS[
      (handIndex - 1) %
      TRUMPS.length
    ];

  room.players.forEach(function (player) {
    player.hand = [];
    player.captured = [];
    player.lastRaw = 0;
  });

  /*
    Initial 5 cards.
  */

  for (let round = 0; round < 5; round++) {
    room.players.forEach(function (player) {
      if (cards.length) {
        player.hand.push(
          cards.pop()
        );
      }
    });
  }

  const leader =
    previousGame &&
    Number.isInteger(
      previousGame.nextLeader
    )
      ? previousGame.nextLeader
      : 0;

  const previousPartyIndex =
    previousGame
      ? previousGame.partyIndex
      : null;

  let partyStart;

  if (
    previousGame &&
    previousPartyIndex === partyIndex
  ) {
    partyStart =
      previousGame.partyStart;
  } else {
    partyStart =
      Object.fromEntries(
        room.players.map(function (player) {
          return [
            player.id,
            player.total
          ];
        })
      );
  }

  room.game = {
    handIndex: handIndex,
    partyIndex: partyIndex,

    totalHands:
      room.parties * 5,

    trump: trump,

    deck: cards,
    table: [],

    current: leader,

    leadCount: 0,
    leadMaliutka: false,

    processing: false,
    gameOver: false,

    turnEndsAt: 0,

    history:
      previousGame
        ? previousGame.history
        : [],

    lastScores:
      previousGame
        ? previousGame.lastScores
        : {},

    lastTrickOrder: [],

    nextLeader: leader,

    partyStart: partyStart,

    fairness: fairness
  };

  return room.game;
}

/* ============================================================
   CLIENT STATE
   ============================================================ */

function buildState(
  room,
  viewerId,
  revealAll
) {
  const game = room.game;

  if (!game) {
    return null;
  }

  const playersCards = {};

  room.players.forEach(function (player) {
    if (
      revealAll ||
      player.id === viewerId
    ) {
      playersCards[player.id] =
        player.hand;
    }
  });

  const winningIndex =
    winnerIndex(
      game.table,
      game.trump
    );

  return {
    roomId: room.id,
    roomName: room.name,

    capacity: room.capacity,
    parties: room.parties,
    stake: room.stake,

    viewerId: viewerId,

    handIndex: game.handIndex,
    partyIndex: game.partyIndex,
    totalHands: game.totalHands,

    trump: game.trump,

    fairnessHash:
      game.fairness
        ? game.fairness.hash
        : null,

    deckCount: game.deck.length,

    currentTurnIndex:
      game.current,

    leadCount:
      game.leadCount,

    leadWasMaliutka:
      game.leadMaliutka,

    processing:
      game.processing,

    gameOver:
      game.gameOver,

    turnEndsAt:
      game.turnEndsAt,

    turnSeconds:
      TURN_SECONDS,

    playersCards:
      playersCards,

    history:
      game.history,

    lastHandScores:
      game.lastScores,

    players:
      room.players.map(
        function (player, index) {
          return {
            id: player.id,
            name: player.name,
            avatar: player.avatar,

            isBot:
              player.isBot,

            connected:
              player.connected,

            cardCount:
              player.hand.length,

            totalPoints:
              player.total,

            lastRawPoints:
              player.lastRaw,

            level:
              player.level,

            xp:
              player.xp,

            wins:
              player.wins,

            frame:
              (
                userOf(player) &&
                userOf(player).equipped &&
                userOf(player).equipped.frame
              ) || 'none',

            isCurrent:
              index ===
              game.current
          };
        }
      ),

    table:
      game.table.map(
        function (play, index) {
          return {
            playerId:
              play.playerId,

            playerName:
              play.playerName,

            cards:
              play.cards,

            cuts:
              play.cuts,

            isWinning:
              index ===
              winningIndex
          };
        }
      )
  };
}

function broadcastGame(room) {
  if (
    !room ||
    !room.game
  ) {
    return;
  }

  room.players.forEach(function (player) {
    if (
      player.isBot ||
      !player.socketId ||
      !player.connected
    ) {
      return;
    }

    io
      .to(player.socketId)
      .emit(
        'gameStateUpdate',
        buildState(
          room,
          player.id,
          isTester(player.name)
        )
      );
  });
}

/* ============================================================
   TURN
   ============================================================ */

function setTurn(room, index) {
  if (
    !room ||
    !room.game ||
    room.game.gameOver
  ) {
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  room.game.current =
    index %
    room.players.length;

  room.game.turnEndsAt =
    Date.now() +
    TURN_SECONDS * 1000;

  room.timer =
    setTimeout(function () {
      room.timer = null;
      autoPlay(room);
    }, TURN_SECONDS * 1000);

  broadcastGame(room);
  scheduleBot(room);
}

/* ============================================================
   PLAY VALIDATION
   ============================================================ */

function validatePlay(
  game,
  hand,
  indexes
) {
  if (
    !Array.isArray(indexes) ||
    indexes.length === 0
  ) {
    return {
      ok: false,
      message: 'აირჩიე კარტი.'
    };
  }

  const normalized =
    indexes.map(Number);

  const unique =
    Array.from(
      new Set(normalized)
    );

  if (
    unique.length !==
      normalized.length ||
    unique.length > 5
  ) {
    return {
      ok: false,
      message: 'არასწორი არჩევანი.'
    };
  }

  const cards =
    unique.map(function (index) {
      return hand[index];
    });

  if (
    cards.some(function (card) {
      return !card;
    })
  ) {
    return {
      ok: false,
      message:
        'არჩეული კარტი ვერ მოიძებნა.'
    };
  }

  /*
    Leader.
  */

  if (!game.table.length) {
    if (!sameSuit(cards)) {
      return {
        ok: false,
        message:
          'ერთად ჩამოსული კარტები ერთი მასტის უნდა იყოს.'
      };
    }

    if (
      cards.length === 5 &&
      !isMaliutka(cards)
    ) {
      return {
        ok: false,
        message:
          '5 კარტი მხოლოდ მალიუტკის სახით შეიძლება.'
      };
    }

    return {
      ok: true,
      cards: cards,
      indexes: unique
    };
  }

  /*
    Maliutka response.
  */

  if (game.leadMaliutka) {
    if (
      cards.length !==
      hand.length
    ) {
      return {
        ok: false,
        message:
          'მალიუტკაზე ყველა დარჩენილი კარტი უნდა ჩამოხვიდე.'
      };
    }

    return {
      ok: true,
      cards: cards,
      indexes: unique
    };
  }

  /*
    Normal response.
  */

  const required =
    game.leadCount || 1;

  if (
    cards.length !== required
  ) {
    return {
      ok: false,
      message:
        'უნდა მონიშნო ზუსტად ' +
        required +
        ' კარტი.'
    };
  }

  /*
    If the responder has ANY same-suit
    group of required count, selected cards
    must also be same suit.
  */

  if (
    required > 1 &&
    sameSuitPossible(
      hand,
      required
    ) &&
    !sameSuit(cards)
  ) {
    return {
      ok: false,
      message:
        'აირჩიე ერთი მასტის ' +
        required +
        ' კარტი.'
    };
  }

  return {
    ok: true,
    cards: cards,
    indexes: unique
  };
}

/* ============================================================
   PLAY
   ============================================================ */

function playCards(
  room,
  player,
  indexes
) {
  const game = room.game;

  if (
    !game ||
    game.processing ||
    game.gameOver
  ) {
    return false;
  }

  const validation =
    validatePlay(
      game,
      player.hand,
      indexes
    );

  if (!validation.ok) {
    if (player.socketId) {
      io
        .to(player.socketId)
        .emit(
          'errorMessage',
          validation.message
        );
    }

    return false;
  }

  let cuts = false;

  if (game.table.length) {
    const currentWinner =
      winnerIndex(
        game.table,
        game.trump
      );

    if (currentWinner >= 0) {
      cuts =
        canBeatSet(
          game.table[
            currentWinner
          ].cards,
          validation.cards,
          game.trump
        );
    }
  }

  const selectedCards =
    validation.cards.slice();

  validation.indexes
    .slice()
    .sort(function (a, b) {
      return b - a;
    })
    .forEach(function (index) {
      player.hand.splice(
        index,
        1
      );
    });

  /*
    Leader determines trick size.
  */

  if (!game.table.length) {
    game.leadCount =
      selectedCards.length;

    game.leadMaliutka =
      isMaliutka(
        selectedCards
      );

    if (game.leadMaliutka) {
      const user =
        userOf(player);

      if (user) {
        defaults(user);

        user.quests.maliutka += 1;

        checkQuests(user);

        if (
          !user.achievements.includes(
            'მალიუტკის ოსტატი'
          )
        ) {
          user.achievements.push(
            'მალიუტკის ოსტატი'
          );

          addXP(user, 40);

          io
            .to(room.id)
            .emit(
              'achievement',
              {
                playerId:
                  player.id,

                title:
                  'მალიუტკის ოსტატი'
              }
            );
        }
      }
    }
  }

  game.table.push({
    playerId:
      player.id,

    playerName:
      player.name,

    cards:
      selectedCards,

    cuts:
      cuts
  });

  io
    .to(room.id)
    .emit(
      'playFX',
      {
        playerId:
          player.id,

        cuts:
          cuts
      }
    );

  /*
    Everyone played.
  */

  if (
    game.table.length ===
    room.players.length
  ) {
    completeTrick(room);
    return true;
  }

  const playerIndex =
    room.players.findIndex(
      function (item) {
        return (
          item.id ===
          player.id
        );
      }
    );

  setTurn(
    room,
    (playerIndex + 1) %
      room.players.length
  );

  return true;
}

/* ============================================================
   TRICK
   ============================================================ */

function refillHands(
  room,
  startIndex
) {
  const game = room.game;

  /*
    Draw clockwise beginning with trick winner.
  */

  for (
    let offset = 0;
    offset < room.players.length;
    offset++
  ) {
    const player =
      room.players[
        (startIndex + offset) %
        room.players.length
      ];

    while (
      player.hand.length < 5 &&
      game.deck.length
    ) {
      player.hand.push(
        game.deck.pop()
      );
    }
  }
}

function completeTrick(room) {
  const game = room.game;

  if (
    !game ||
    game.processing
  ) {
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  game.processing = true;

  const winningPlayIndex =
    winnerIndex(
      game.table,
      game.trump
    );

  if (winningPlayIndex < 0) {
    game.processing = false;
    return;
  }

  const winnerPlay =
    game.table[
      winningPlayIndex
    ];

  const winnerPlayerIndex =
    room.players.findIndex(
      function (player) {
        return (
          player.id ===
          winnerPlay.playerId
        );
      }
    );

  if (winnerPlayerIndex < 0) {
    game.processing = false;
    return;
  }

  const winner =
    room.players[
      winnerPlayerIndex
    ];

  game.table.forEach(
    function (played) {
      winner.captured.push.apply(
        winner.captured,
        played.cards
      );
    }
  );

  game.lastTrickOrder =
    game.table.map(
      function (played) {
        return played.playerId;
      }
    );

  io
    .to(room.id)
    .emit(
      'trickWon',
      {
        winnerId:
          winner.id
      }
    );

  /*
    Show the completed trick (all played cards,
    with the winning group glowing gold) to every
    player before the table is cleared. Without
    this, the last card of the trick was never
    broadcast at all.
  */

  broadcastGame(room);

  setTimeout(function () {
    if (
      !rooms.has(room.id) ||
      room.game !== game
    ) {
      return;
    }

    game.table = [];
    game.leadCount = 0;
    game.leadMaliutka = false;

    refillHands(
      room,
      winnerPlayerIndex
    );

    const finished =
      game.deck.length === 0 &&
      room.players.every(
        function (player) {
          return (
            player.hand.length === 0
          );
        }
      );

    if (finished) {
      finishHand(room);
      return;
    }

    game.processing = false;

    setTurn(
      room,
      winnerPlayerIndex
    );
  }, TRICK_CLEAR_DELAY);
}

/* ============================================================
   NEXT LEADER / GAKHISHTVA
   ============================================================ */

function calculateNextLeader(
  room,
  game,
  rawScores
) {
  const zeroPlayers =
    room.players
      .filter(function (player) {
        return (
          rawScores[player.id] === 0
        );
      })
      .map(function (player) {
        return player.id;
      });

  /*
    Special gakhishtva:
    multiple zero scorers -> player after
    the last zero scorer in final trick order.
  */

  if (
    zeroPlayers.length >= 2 &&
    game.lastTrickOrder.length
  ) {
    let lastZero = null;

    game.lastTrickOrder.forEach(
      function (playerId) {
        if (
          zeroPlayers.includes(
            playerId
          )
        ) {
          lastZero =
            playerId;
        }
      }
    );

    if (lastZero) {
      const index =
        room.players.findIndex(
          function (player) {
            return (
              player.id ===
              lastZero
            );
          }
        );

      if (index >= 0) {
        return (
          (index + 1) %
          room.players.length
        );
      }
    }
  }

  /*
    Normal rule:
    player after lowest raw score.
  */

  let minimum = Infinity;
  let lowestIndex = 0;

  room.players.forEach(
    function (player, index) {
      const score =
        rawScores[player.id];

      if (score < minimum) {
        minimum = score;
        lowestIndex = index;
      }
    }
  );

  return (
    (lowestIndex + 1) %
    room.players.length
  );
}

/* ============================================================
   HAND / PARTY SCORING
   ============================================================ */

async function finishHand(room) {
  const game = room.game;

  if (!game) {
    return;
  }

  const rawScores = {};
  const writtenScores = {};

  room.players.forEach(
    function (player) {
      const raw =
        player.captured.reduce(
          function (sum, card) {
            return (
              sum +
              cardPoints(card)
            );
          },
          0
        );

      rawScores[player.id] =
        raw;

      writtenScores[player.id] =
        raw === 0
          ? -120
          : raw;

      player.lastRaw = raw;

      player.total +=
        writtenScores[
          player.id
        ];
    }
  );

  game.lastScores =
    writtenScores;

  const fairnessForHand =
    game.fairness || null;

  game.history.push({
    hand:
      game.handIndex,

    party:
      game.partyIndex,

    trump:
      game.trump,

    rawScores:
      Object.assign(
        {},
        rawScores
      ),

    scores:
      Object.assign(
        {},
        writtenScores
      ),

    fairness:
      fairnessForHand
        ? {
            seed:
              fairnessForHand.seed,

            hash:
              fairnessForHand.hash
          }
        : null
  });

  if (fairnessForHand) {
    io
      .to(room.id)
      .emit(
        'fairnessReveal',
        {
          hand:
            game.handIndex,

          seed:
            fairnessForHand.seed,

          hash:
            fairnessForHand.hash
        }
      );
  }

  const maxRaw =
    Math.max.apply(
      null,
      room.players.map(
        function (player) {
          return rawScores[player.id] || 0;
        }
      )
    );

  room.players.forEach(
    function (player) {
      const user =
        userOf(player);

      if (!user) {
        return;
      }

      defaults(user);

      user.stats.handsPlayed += 1;

      if (
        maxRaw > 0 &&
        rawScores[player.id] === maxRaw
      ) {
        user.stats.handsWon += 1;
      }

      if (user.socketId) {
        io.to(user.socketId).emit(
          'profileUpdate',
          profile(user)
        );
      }
    }
  );

  /*
    Every 5 hands = party.
  */

  if (
    game.handIndex % 5 === 0
  ) {
    let best = -Infinity;
    let winners = [];

    room.players.forEach(
      function (player) {
        const delta =
          player.total -
          Number(
            game.partyStart[
              player.id
            ] || 0
          );

        if (delta > best) {
          best = delta;
          winners = [player];
        } else if (
          delta === best
        ) {
          winners.push(player);
        }

        const user =
          userOf(player);

        if (user) {
          addXP(user, 20);
        }
      }
    );

    const humanRatings =
      room.players
        .map(function (player) {
          const user = userOf(player);
          return user ? user.rating : 1000;
        });

    const avgRating =
      humanRatings.reduce(
        function (sum, value) {
          return sum + value;
        },
        0
      ) / (humanRatings.length || 1);

    room.players.forEach(
      function (player) {
        const user =
          userOf(player);

        if (!user) {
          return;
        }

        defaults(user);

        const isWinner =
          winners.indexOf(player) >= 0;

        const delta =
          player.total -
          Number(
            game.partyStart[
              player.id
            ] || 0
          );

        /*
          Simple ELO-style rating update against
          the room's average rating.
        */

        const expected =
          1 /
          (
            1 +
            Math.pow(
              10,
              (avgRating - user.rating) / 400
            )
          );

        const actual =
          isWinner ? 1 : 0;

        user.rating =
          Math.max(
            0,
            Math.round(
              user.rating +
              32 * (actual - expected)
            )
          );

        user.stats.partiesPlayed += 1;

        if (
          !user.stats.recentParties
        ) {
          user.stats.recentParties = [];
        }

        user.stats.recentParties.push({
          won: isWinner,
          delta: delta,
          rating: user.rating,
          date: today()
        });

        user.stats.recentParties =
          user.stats.recentParties.slice(-20);

        if (isWinner) {
          user.stats.partiesWon += 1;
          user.stats.winStreak += 1;

          if (
            user.stats.winStreak >
            user.stats.bestWinStreak
          ) {
            user.stats.bestWinStreak =
              user.stats.winStreak;
          }

          if (
            delta >
            user.stats.biggestWin
          ) {
            user.stats.biggestWin = delta;
          }

          user.coins =
            Number(user.coins || 0) + 50;
        } else {
          user.stats.winStreak = 0;
        }
      }
    );

    winners.forEach(
      function (player) {
        const user =
          userOf(player);

        if (!user) {
          return;
        }

        user.wins += 1;
        user.quests.wins += 1;

        addXP(user, 80);
        checkQuests(user);

        player.wins =
          user.wins;

        player.xp =
          user.xp;

        player.level =
          user.level;
      }
    );

    room.players.forEach(
      function (player) {
        const user =
          userOf(player);

        if (user && user.socketId) {
          io.to(user.socketId).emit(
            'profileUpdate',
            profile(user)
          );
        }
      }
    );
  }

  await saveUsersNow();

  if (
    game.handIndex >=
    game.totalHands
  ) {
    finishGame(room);
    return;
  }

  game.nextLeader =
    calculateNextLeader(
      room,
      game,
      rawScores
    );

  startHand(
    room,
    game
  );

  setTurn(
    room,
    room.game.current
  );
}

/* ============================================================
   GAME OVER
   ============================================================ */

function finishGame(room) {
  const game = room.game;

  if (!game) {
    return;
  }

  game.gameOver = true;
  game.processing = false;

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  let winner =
    room.players[0];

  room.players.forEach(
    function (player) {
      if (
        player.total >
        winner.total
      ) {
        winner = player;
      }
    }
  );

  const user =
    userOf(winner);

  if (user) {
    addXP(user, 100);
  }

  io
    .to(room.id)
    .emit(
      'gameWinner',
      {
        playerId:
          winner.id,

        playerName:
          winner.name
      }
    );

  broadcastGame(room);

  saveUsersNow().catch(
    console.error
  );
}

/* ============================================================
   BOT COMBINATIONS
   ============================================================ */

function combinations(
  array,
  count,
  start,
  current,
  output
) {
  start = start || 0;
  current = current || [];
  output = output || [];

  if (
    current.length === count
  ) {
    output.push(
      current.slice()
    );

    return output;
  }

  for (
    let i = start;
    i < array.length;
    i++
  ) {
    current.push(array[i]);

    combinations(
      array,
      count,
      i + 1,
      current,
      output
    );

    current.pop();
  }

  return output;
}

function cardCost(card, trump) {
  let cost =
    cardPoints(card) * 100 +
    rankIndex(card);

  if (
    isTrump(card, trump)
  ) {
    cost += 10000;
  }

  return cost;
}

function cheapestCut(
  hand,
  count,
  target,
  trump
) {
  if (
    count <= 0 ||
    count > hand.length
  ) {
    return null;
  }

  const indexes =
    hand.map(
      function (_, index) {
        return index;
      }
    );

  const combos =
    combinations(
      indexes,
      count
    );

  const requireSuit =
    count > 1 &&
    sameSuitPossible(
      hand,
      count
    );

  let best = null;
  let bestCost = Infinity;

  combos.forEach(
    function (combo) {
      const cards =
        combo.map(
          function (index) {
            return hand[index];
          }
        );

      if (
        requireSuit &&
        !sameSuit(cards)
      ) {
        return;
      }

      if (
        !canBeatSet(
          target,
          cards,
          trump
        )
      ) {
        return;
      }

      const cost =
        cards.reduce(
          function (sum, card) {
            return (
              sum +
              cardCost(
                card,
                trump
              )
            );
          },
          0
        );

      if (cost < bestCost) {
        bestCost = cost;
        best = combo;
      }
    }
  );

  return best;
}

function lowestDiscard(
  hand,
  count,
  trump
) {
  count =
    Math.min(
      count,
      hand.length
    );

  if (count <= 0) {
    return [];
  }

  const indexes =
    hand.map(
      function (_, index) {
        return index;
      }
    );

  const combos =
    combinations(
      indexes,
      count
    );

  const requireSuit =
    count > 1 &&
    sameSuitPossible(
      hand,
      count
    );

  let best = null;
  let bestCost = Infinity;

  combos.forEach(
    function (combo) {
      const cards =
        combo.map(
          function (index) {
            return hand[index];
          }
        );

      if (
        requireSuit &&
        !sameSuit(cards)
      ) {
        return;
      }

      const cost =
        cards.reduce(
          function (sum, card) {
            return (
              sum +
              cardCost(
                card,
                trump
              )
            );
          },
          0
        );

      if (cost < bestCost) {
        bestCost = cost;
        best = combo;
      }
    }
  );

  return (
    best ||
    indexes.slice(0, count)
  );
}

function botChoice(
  room,
  player
) {
  const game = room.game;

  if (!game) {
    return [];
  }

  /*
    Bot leads.
  */

  if (!game.table.length) {
    const groups = {};

    player.hand.forEach(
      function (card, index) {
        if (!groups[card.suit]) {
          groups[card.suit] = [];
        }

        groups[card.suit].push(
          index
        );
      }
    );

    /*
      Maliutka first.
    */

    const five =
      Object
        .values(groups)
        .find(function (group) {
          return (
            group.length === 5
          );
        });

    if (five) {
      return five.slice();
    }

    /*
      Occasionally lead multi-card.
    */

    const multi =
      Object
        .values(groups)
        .filter(function (group) {
          return (
            group.length >= 2
          );
        })
        .sort(function (a, b) {
          return (
            b.length -
            a.length
          );
        });

    if (
      multi.length &&
      Math.random() < 0.3
    ) {
      return multi[0].slice(
        0,
        Math.min(
          4,
          multi[0].length
        )
      );
    }

    return lowestDiscard(
      player.hand,
      1,
      game.trump
    );
  }

  /*
    Maliutka response.
  */

  if (game.leadMaliutka) {
    return player.hand.map(
      function (_, index) {
        return index;
      }
    );
  }

  const count =
    game.leadCount;

  const currentWinner =
    winnerIndex(
      game.table,
      game.trump
    );

  const target =
    game.table[
      currentWinner
    ].cards;

  /*
    Cut using cheapest valid set.
  */

  const cut =
    cheapestCut(
      player.hand,
      count,
      target,
      game.trump
    );

  if (cut) {
    return cut;
  }

  /*
    Otherwise discard cheapest cards,
    preferring 6–9 and non-trumps.
  */

  return lowestDiscard(
    player.hand,
    count,
    game.trump
  );
}

function scheduleBot(room) {
  if (
    !room ||
    !room.game ||
    room.game.processing ||
    room.game.gameOver
  ) {
    return;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  const player =
    room.players[
      room.game.current
    ];

  if (
    !player ||
    !player.isBot
  ) {
    return;
  }

  io
    .to(room.id)
    .emit(
      'botThinking',
      {
        playerId:
          player.id,

        text:
          '🤖 ბოტი ფიქრობს...'
      }
    );

  room.botTimer =
    setTimeout(function () {
      room.botTimer = null;

      if (
        !room.game ||
        room.game.processing ||
        room.game.gameOver
      ) {
        return;
      }

      const active =
        room.players[
          room.game.current
        ];

      if (
        !active ||
        active.id !== player.id
      ) {
        return;
      }

      playCards(
        room,
        player,
        botChoice(
          room,
          player
        )
      );
    }, rand(1200, 1800));
}

function autoPlay(room) {
  if (
    !room ||
    !room.game ||
    room.game.processing ||
    room.game.gameOver
  ) {
    return;
  }

  const player =
    room.players[
      room.game.current
    ];

  if (!player) {
    return;
  }

  playCards(
    room,
    player,
    botChoice(
      room,
      player
    )
  );
}

/* ============================================================
   LOBBY
   ============================================================ */

function lobbyData() {
  return Array
    .from(rooms.values())
    .filter(function (room) {
      return (
        !room.game &&
        room.players.length <
          room.capacity
      );
    })
    .map(function (room) {
      return {
        id: room.id,
        name: room.name,
        stake: room.stake,

        players:
          room.players.length,

        capacity:
          room.capacity,

        parties:
          room.parties
      };
    });
}

function broadcastLobby() {
  io.emit(
    'lobbyTables',
    lobbyData()
  );
}

/* ============================================================
   TOURNAMENT PROTOTYPE
   ============================================================ */

const tournaments = [
  {
    id: 'bura_cup',
    name: 'Written Bura Cup',
    prize: '$1,000',

    startAt:
      Date.now() +
      60 * 60 * 1000,

    maxPlayers: 16,

    registered: [],

    status:
      'registration'
  }
];

function tournamentData() {
  return tournaments.map(
    function (tournament) {
      return {
        id:
          tournament.id,

        name:
          tournament.name,

        prize:
          tournament.prize,

        startAt:
          tournament.startAt,

        maxPlayers:
          tournament.maxPlayers,

        registered:
          tournament.registered.length,

        status:
          tournament.status
      };
    }
  );
}

/* ============================================================
   JOIN ROOM
   ============================================================ */

function joinRoom(socket, data) {
  const user =
    users.get(
      socket.data.userId
    );

  let room =
    data.roomId
      ? rooms.get(data.roomId)
      : null;

  if (
    room &&
    (
      room.game ||
      room.players.length >=
        room.capacity
    )
  ) {
    socket.emit(
      'errorMessage',
      'მაგიდა აღარ არის თავისუფალი.'
    );

    return;
  }

  if (!room) {
    room = makeRoom(
      data.tableName,
      data.capacity,
      data.parties,
      data.stake
    );
  }

  let player =
    user
      ? createHumanPlayer(
          user,
          socket
        )
      : createHumanPlayer(
          null,
          socket,
          data.name
        );

  const existing =
    user
      ? room.players.find(
          function (item) {
            return (
              item.userId ===
              user.id
            );
          }
        )
      : null;

  if (existing) {
    player = existing;

    player.socketId =
      socket.id;

    player.connected =
      true;

    player.isBot = false;

    if (
      player.reconnectTimer
    ) {
      clearTimeout(
        player.reconnectTimer
      );

      player.reconnectTimer =
        null;
    }
  } else {
    room.players.push(
      player
    );
  }

  socket.data.roomId =
    room.id;

  socket.data.playerId =
    player.id;

  socket.join(room.id);

  if (user) {
    user.socketId =
      socket.id;

    user.roomId =
      room.id;

    playedTable(
      user,
      room.id
    );
  }

  /*
    saba123 test mode:
    fill remaining seats immediately.
  */

  if (
    isTester(player.name)
  ) {
    fillBots(room);
  }

  if (
    room.players.length >=
    room.capacity
  ) {
    startHand(room);

    io
      .to(room.id)
      .emit(
        'dealAnimation'
      );

    setTurn(room, 0);
  } else {
    io
      .to(room.id)
      .emit(
        'waitingForPlayers',
        {
          current:
            room.players.length,

          max:
            room.capacity
        }
      );
  }

  broadcastLobby();
}

/* ============================================================
   RECONNECT
   ============================================================ */

function recover(
  socket,
  user
) {
  const room =
    Array
      .from(rooms.values())
      .find(function (candidate) {
        return candidate.players.some(
          function (player) {
            return (
              player.userId ===
              user.id
            );
          }
        );
      });

  if (!room) {
    return;
  }

  const player =
    room.players.find(
      function (item) {
        return (
          item.userId ===
          user.id
        );
      }
    );

  if (
    !player ||
    player.isBot
  ) {
    return;
  }

  if (
    player.reconnectTimer
  ) {
    clearTimeout(
      player.reconnectTimer
    );

    player.reconnectTimer =
      null;
  }

  player.connected = true;
  player.socketId = socket.id;

  socket.data.roomId =
    room.id;

  socket.data.playerId =
    player.id;

  user.roomId =
    room.id;

  user.socketId =
    socket.id;

  socket.join(room.id);

  socket.emit(
    'sessionRecovered'
  );

  if (room.game) {
    socket.emit(
      'gameStateUpdate',
      buildState(
        room,
        player.id,
        isTester(player.name)
      )
    );
  }
}

function recoverDomino(socket, user) {
  const room = Array.from(dominoRooms.values()).find((candidate) =>
    candidate.players.some((player) => player.userId === user.id)
  );

  if (!room) return;

  const player = room.players.find((item) => item.userId === user.id);
  if (!player || player.isBot) return;

  if (player.reconnectTimer) {
    clearTimeout(player.reconnectTimer);
    player.reconnectTimer = null;
  }

  player.connected = true;
  player.socketId = socket.id;

  socket.data.dominoRoomId = room.id;
  socket.data.dominoPlayerId = player.id;

  socket.join('domino:' + room.id);

  if (room.game) {
    socket.emit('dominoStateUpdate', buildDominoState(room, player.id, isTester(player.name)));
  }
}

/* ============================================================
   SOCKET.IO
   ============================================================ */

io.on(
  'connection',
  function (socket) {
    socket.data.userId = null;
    socket.data.roomId = null;
    socket.data.playerId = null;
    socket.data.dominoRoomId = null;
    socket.data.dominoPlayerId = null;

    socket.emit(
      'lobbyTables',
      lobbyData()
    );

    socket.emit(
      'dominoLobbyTables',
      dominoLobbyData()
    );

    socket.emit(
      'tournaments',
      tournamentData()
    );

    /* ---------------- REGISTER ---------------- */

    socket.on(
      'register',
      async function (data) {
        try {
          data = data || {};

          const username =
            clean(data.username);

          const password =
            String(
              data.password || ''
            );

          if (
            username.length < 3
          ) {
            socket.emit(
              'authError',
              'Username მინიმუმ 3 სიმბოლო.'
            );

            return;
          }

          if (
            password.length < 6
          ) {
            socket.emit(
              'authError',
              'Password მინიმუმ 6 სიმბოლო.'
            );

            return;
          }

          if (
            findUser(username)
          ) {
            socket.emit(
              'authError',
              'Username უკვე არსებობს.'
            );

            return;
          }

          const passwordData =
            await makePassword(
              password
            );

          const user =
            defaults({
              id:
                uid('user'),

              username:
                username,

              passwordSalt:
                passwordData.salt,

              passwordHash:
                passwordData.hash,

              avatar:
                validAvatar(
                  data.avatar
                ),

              xp: 0,
              wins: 0,

              balance:
                START_BALANCE,

              achievements:
                [],

              quests:
                defaultQuests(),

              socketId:
                socket.id
            });

          users.set(
            user.id,
            user
          );

          socket.data.userId =
            user.id;

          const token =
            newSession(user);

          await saveUsersNow();

          socket.emit(
            'authSuccess',
            {
              token: token,
              profile:
                profile(user)
            }
          );
        } catch (error) {
          console.error(
            '[REGISTER]',
            error
          );

          socket.emit(
            'authError',
            'რეგისტრაცია ვერ შესრულდა.'
          );
        }
      }
    );

    /* ---------------- LOGIN ---------------- */

    socket.on(
      'login',
      async function (data) {
        data = data || {};

        const user =
          findUser(
            data.username
          );

        if (
          !user ||
          !(
            await checkPassword(
              data.password || '',
              user
            )
          )
        ) {
          socket.emit(
            'authError',
            'Username ან Password არასწორია.'
          );

          return;
        }

        if (isExcluded(user)) {
          socket.emit(
            'authError',
            'შენ თვითონ გამორთე ანგარიში (თვითგამორიცხვა). ' +
            (
              user.selfExcludedUntil === 'forever'
                ? 'ეს გადაწყვეტილება მუდმივია.'
                : 'ხელახლა შეძლებ შესვლას: ' +
                  user.selfExcludedUntil
            )
          );

          return;
        }

        user.socketId =
          socket.id;

        socket.data.userId =
          user.id;

        const token =
          newSession(user);

        const streakBonus =
          applyLoginStreak(user);

        socket.emit(
          'authSuccess',
          {
            token: token,
            profile:
              profile(user),

            streakBonus:
              streakBonus,

            loginStreak:
              user.loginStreak
          }
        );

        recover(
          socket,
          user
        );

        recoverDomino(socket, user);
      }
    );

    /* ---------------- TESTER ---------------- */

    socket.on(
      'testerLogin',
      function () {
        let user =
          findUser(
            TESTER_NAME
          );

        if (!user) {
          user =
            defaults({
              id:
                uid('tester'),

              username:
                TESTER_NAME,

              /*
                Tester doesn't require password.
              */
              passwordSalt:
                '',

              passwordHash:
                '',

              avatar:
                '🧙',

              xp:
                999,

              wins:
                10,

              balance:
                START_BALANCE,

              achievements:
                [],

              quests:
                defaultQuests(),

              tester:
                true
            });

          users.set(
            user.id,
            user
          );
        }

        if (isExcluded(user)) {
          socket.emit(
            'authError',
            'ეს ანგარიში თვითგამორიცხულია.'
          );

          return;
        }

        user.tester = true;
        user.socketId = socket.id;

        socket.data.userId =
          user.id;

        const token =
          newSession(user);

        const streakBonus =
          applyLoginStreak(user);

        socket.emit(
          'authSuccess',
          {
            token:
              token,

            profile:
              profile(user),

            streakBonus:
              streakBonus,

            loginStreak:
              user.loginStreak
          }
        );

        recover(
          socket,
          user
        );

        recoverDomino(socket, user);

        saveLater();
      }
    );

    /* ---------------- SESSION ---------------- */

    socket.on(
      'restoreSession',
      function (data) {
        data = data || {};

        const token =
          String(
            data.token || ''
          );

        const session =
          sessions.get(token);

        if (!session) {
          socket.emit(
            'sessionInvalid'
          );

          return;
        }

        const user =
          users.get(
            session.userId
          );

        if (!user) {
          socket.emit(
            'sessionInvalid'
          );

          return;
        }

        if (isExcluded(user)) {
          socket.emit(
            'sessionInvalid'
          );

          return;
        }

        user.socketId =
          socket.id;

        socket.data.userId =
          user.id;

        const streakBonus =
          applyLoginStreak(user);

        socket.emit(
          'authSuccess',
          {
            token: token,
            profile:
              profile(user),

            streakBonus:
              streakBonus,

            loginStreak:
              user.loginStreak
          }
        );

        recover(
          socket,
          user
        );

        recoverDomino(socket, user);
      }
    );

    /* ---------------- JOIN ---------------- */

    socket.on(
      'joinTable',
      function (data) {
        joinRoom(
          socket,
          data || {}
        );
      }
    );

    /* ---------------- PLAY ---------------- */

    socket.on(
      'playCards',
      function (data) {
        const room =
          rooms.get(
            socket.data.roomId
          );

        if (
          !room ||
          !room.game
        ) {
          return;
        }

        const player =
          room.players.find(
            function (item) {
              return (
                item.id ===
                socket.data.playerId
              );
            }
          );

        if (!player) {
          return;
        }

        const active =
          room.players[
            room.game.current
          ];

        if (
          !active ||
          active.id !== player.id
        ) {
          socket.emit(
            'errorMessage',
            'ახლა შენი სვლა არ არის.'
          );

          return;
        }

        data = data || {};

        playCards(
          room,
          player,
          data.cardIndices ||
          data.indexes ||
          []
        );
      }
    );

    /* ---------------- REACTIONS ---------------- */

    socket.on(
      'quickMessage',
      function (data) {
        const room =
          rooms.get(
            socket.data.roomId
          );

        if (!room) {
          return;
        }

        const allowed = [
          'სიქიიიიიმ!',
          'ყვერო, მალე!',
          'რას შვრები, ძმაო?!',
          'ვაჰ, კოზირი!',
          '⚡ სწრაფად!',
          '👍 კარგი იყო'
        ];

        const message =
          String(
            (
              data &&
              data.text
            ) || ''
          );

        if (
          !allowed.includes(
            message
          )
        ) {
          return;
        }

        io
          .to(room.id)
          .emit(
            'quickMessage',
            {
              playerId:
                socket.data.playerId,

              text:
                message
            }
          );
      }
    );

    /* ---------------- THROWABLES ---------------- */

    socket.on(
      'throwable',
      function (data) {
        const room =
          rooms.get(
            socket.data.roomId
          );

        if (!room) {
          return;
        }

        data = data || {};

        const type =
          String(
            data.type || ''
          );

        if (
          ![
            'tomato',
            'egg',
            'paper',
            'bomb',
            'beer',
            'ice',
            'rose'
          ].includes(type)
        ) {
          return;
        }

        const targetExists =
          room.players.some(
            function (player) {
              return (
                player.id ===
                data.targetPlayerId
              );
            }
          );

        if (!targetExists) {
          return;
        }

        io
          .to(room.id)
          .emit(
            'throwableEvent',
            {
              fromPlayerId:
                socket.data.playerId,

              targetPlayerId:
                data.targetPlayerId,

              type:
                type
            }
          );
      }
    );

    /* ---------------- TOURNAMENT ---------------- */

    socket.on(
      'registerTournament',
      function (data) {
        const user =
          users.get(
            socket.data.userId
          );

        if (!user) {
          return;
        }

        data = data || {};

        const tournament =
          tournaments.find(
            function (item) {
              return (
                item.id ===
                data.id
              );
            }
          );

        if (
          !tournament ||
          tournament.status !==
            'registration'
        ) {
          return;
        }

        if (
          !tournament.registered.includes(
            user.id
          ) &&
          tournament.registered.length <
            tournament.maxPlayers
        ) {
          tournament.registered.push(
            user.id
          );
        }

        io.emit(
          'tournaments',
          tournamentData()
        );
      }
    );

    /* ---------------- LEADERBOARD ---------------- */

    socket.on(
      'getLeaderboard',
      function () {
        const top =
          Array
            .from(users.values())
            .map(function (user) {
              defaults(user);
              return user;
            })
            .sort(function (a, b) {
              return b.rating - a.rating;
            })
            .slice(0, 20)
            .map(friendSummary);

        socket.emit(
          'leaderboardData',
          top
        );
      }
    );

    /* ---------------- FRIENDS ---------------- */

    socket.on(
      'getFriends',
      function () {
        const user =
          users.get(
            socket.data.userId
          );

        if (!user) {
          return;
        }

        defaults(user);

        const list =
          user.friends
            .map(function (id) {
              return friendSummary(
                users.get(id)
              );
            })
            .filter(Boolean);

        socket.emit(
          'friendsList',
          list
        );
      }
    );

    socket.on(
      'addFriend',
      function (data) {
        const user =
          users.get(
            socket.data.userId
          );

        if (!user) {
          return;
        }

        defaults(user);

        data = data || {};

        const target =
          findUser(
            data.username
          );

        if (
          !target ||
          target.id === user.id
        ) {
          socket.emit(
            'errorMessage',
            'მომხმარებელი ვერ მოიძებნა.'
          );

          return;
        }

        if (
          user.friends.indexOf(
            target.id
          ) < 0
        ) {
          user.friends.push(
            target.id
          );

          saveLater();
        }

        socket.emit(
          'friendsList',
          user.friends
            .map(function (id) {
              return friendSummary(
                users.get(id)
              );
            })
            .filter(Boolean)
        );
      }
    );

    socket.on(
      'removeFriend',
      function (data) {
        const user =
          users.get(
            socket.data.userId
          );

        if (!user) {
          return;
        }

        defaults(user);

        data = data || {};

        user.friends =
          user.friends.filter(
            function (id) {
              return id !== data.id;
            }
          );

        saveLater();

        socket.emit(
          'friendsList',
          user.friends
            .map(function (id) {
              return friendSummary(
                users.get(id)
              );
            })
            .filter(Boolean)
        );
      }
    );

    /* ---------------- SHOP / COSMETICS ---------------- */

    socket.on(
      'buyItem',
      function (data) {
        const user =
          users.get(
            socket.data.userId
          );

        if (!user) {
          return;
        }

        defaults(user);

        data = data || {};

        const item =
          SHOP_ITEMS.find(
            function (candidate) {
              return (
                candidate.id ===
                data.itemId
              );
            }
          );

        if (!item) {
          return;
        }

        const owned =
          item.type === 'felt'
            ? user.inventory.felts
            : user.inventory.frames;

        const ownedKey =
          item.type === 'felt'
            ? item.id.replace('felt_', '')
            : item.id.replace('frame_', '');

        if (owned.indexOf(ownedKey) >= 0) {
          socket.emit(
            'errorMessage',
            'უკვე გაქვს ეს ნივთი.'
          );

          return;
        }

        if (user.coins < item.price) {
          socket.emit(
            'errorMessage',
            'არასაკმარისი მონეტები.'
          );

          return;
        }

        user.coins -= item.price;
        owned.push(ownedKey);

        saveLater();

        socket.emit(
          'profileUpdate',
          profile(user)
        );

        socket.emit(
          'purchaseSuccess',
          { itemId: item.id }
        );
      }
    );

    socket.on(
      'equipCosmetic',
      function (data) {
        const user =
          users.get(
            socket.data.userId
          );

        if (!user) {
          return;
        }

        defaults(user);

        data = data || {};

        if (
          data.slot === 'felt' &&
          user.inventory.felts.indexOf(
            data.value
          ) >= 0
        ) {
          user.equipped.felt = data.value;
        }

        if (
          data.slot === 'frame' &&
          user.inventory.frames.indexOf(
            data.value
          ) >= 0
        ) {
          user.equipped.frame = data.value;
        }

        saveLater();

        socket.emit(
          'profileUpdate',
          profile(user)
        );
      }
    );

    /* ---------------- RESPONSIBLE GAMING ---------------- */

    socket.on(
      'selfExclude',
      function (data) {
        const user =
          users.get(
            socket.data.userId
          );

        if (!user) {
          return;
        }

        data = data || {};

        const duration =
          String(data.duration || '');

        if (duration === '24h') {
          user.selfExcludedUntil =
            new Date(
              Date.now() + 24 * 3600 * 1000
            ).toISOString();
        } else if (duration === '7d') {
          user.selfExcludedUntil =
            new Date(
              Date.now() + 7 * 24 * 3600 * 1000
            ).toISOString();
        } else if (duration === '30d') {
          user.selfExcludedUntil =
            new Date(
              Date.now() + 30 * 24 * 3600 * 1000
            ).toISOString();
        } else if (duration === 'forever') {
          user.selfExcludedUntil = 'forever';
        } else {
          return;
        }

        saveUsersNow().catch(
          console.error
        );

        socket.emit(
          'selfExcluded',
          { until: user.selfExcludedUntil }
        );
      }
    );

    /* ---------------- DOMINO ---------------- */

    socket.on('dominoJoinTable', function (data) {
      joinDominoRoom(socket, data || {});
    });

    socket.on('dominoPlayTile', function (data) {
      data = data || {};
      const room = dominoRooms.get(socket.data.dominoRoomId);
      if (!room || !room.game) return;

      const player = room.players.find((p) => p.id === socket.data.dominoPlayerId);
      if (!player) return;

      const active = room.players[room.game.current];
      if (!active || active.id !== player.id) {
        socket.emit('dominoError', 'ახლა შენი სვლა არ არის.');
        return;
      }

      dominoPlaceTile(room, player, data.tileId, data.side);
    });

    /* ---------------- DISCONNECT ---------------- */

    socket.on(
      'disconnect',
      function () {
        const dominoRoom =
          dominoRooms.get(
            socket.data.dominoRoomId
          );

        if (dominoRoom) {
          const dominoPlayer =
            dominoRoom.players.find(
              (p) => p.id === socket.data.dominoPlayerId
            );

          if (dominoPlayer) {
            dominoPlayer.connected = false;
            dominoPlayer.socketId = null;

            broadcastDominoGame(dominoRoom);

            if (dominoPlayer.reconnectTimer) {
              clearTimeout(dominoPlayer.reconnectTimer);
            }

            dominoPlayer.reconnectTimer = setTimeout(function () {
              dominoPlayer.reconnectTimer = null;
              if (dominoPlayer.connected) return;

              if (dominoRoom.game && !dominoRoom.game.gameOver) {
                dominoPlayer.isBot = true;
                if (!dominoPlayer.name.includes('🤖')) {
                  dominoPlayer.name += ' 🤖';
                }
                dominoPlayer.avatar = '🤖';

                if (dominoRoom.players[dominoRoom.game.current] === dominoPlayer) {
                  scheduleDominoBot(dominoRoom);
                }

                broadcastDominoGame(dominoRoom);
                return;
              }

              const index = dominoRoom.players.indexOf(dominoPlayer);
              if (index >= 0) dominoRoom.players.splice(index, 1);

              if (dominoRoom.players.length === 0) {
                dominoCleanupRoom(dominoRoom);
                dominoRooms.delete(dominoRoom.id);
              }

              broadcastDominoLobby();
            }, RECONNECT_MS);
          }
        }

        const room =
          rooms.get(
            socket.data.roomId
          );

        const user =
          users.get(
            socket.data.userId
          );

        if (
          user &&
          user.socketId ===
            socket.id
        ) {
          user.socketId = null;
        }

        if (!room) {
          return;
        }

        const player =
          room.players.find(
            function (item) {
              return (
                item.id ===
                socket.data.playerId
              );
            }
          );

        if (!player) {
          return;
        }

        player.connected = false;
        player.socketId = null;

        broadcastGame(room);

        if (
          player.reconnectTimer
        ) {
          clearTimeout(
            player.reconnectTimer
          );
        }

        player.reconnectTimer =
          setTimeout(
            function () {
              player.reconnectTimer =
                null;

              if (
                player.connected
              ) {
                return;
              }

              /*
                Active game:
                bot takeover after 30 seconds.
              */

              if (
                room.game &&
                !room.game.gameOver
              ) {
                player.isBot = true;

                if (
                  !player.name.includes(
                    '🤖'
                  )
                ) {
                  player.name +=
                    ' 🤖';
                }

                player.avatar =
                  '🤖';

                if (
                  room.players[
                    room.game.current
                  ] === player
                ) {
                  scheduleBot(room);
                }

                broadcastGame(room);

                return;
              }

              /*
                No active game:
                remove disconnected player.
              */

              const index =
                room.players.indexOf(
                  player
                );

              if (index >= 0) {
                room.players.splice(
                  index,
                  1
                );
              }

              if (
                room.players.length === 0
              ) {
                cleanupRoom(room);
                rooms.delete(room.id);
              }

              broadcastLobby();
            },
            RECONNECT_MS
          );
      }
    );
  }
);

/* ============================================================
   ROOM CLEANUP
   ============================================================ */

function cleanupRoom(room) {
  if (!room) {
    return;
  }

  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  if (room.botTimer) {
    clearTimeout(room.botTimer);
    room.botTimer = null;
  }

  room.players.forEach(
    function (player) {
      if (
        player.reconnectTimer
      ) {
        clearTimeout(
          player.reconnectTimer
        );

        player.reconnectTimer =
          null;
      }
    }
  );
}

/* ============================================================
   DOMINO — GAME ENGINE
   ============================================================ */

const DOMINO_CAPACITIES = [2, 3, 4];
const DOMINO_ROUNDS_OPTIONS = [1, 2, 3, 4];
const DOMINO_TURN_SECONDS = 25;

const dominoRooms = new Map();

function canonicalDominoSet() {
  const tiles = [];
  for (let a = 0; a <= 6; a++) {
    for (let b = a; b <= 6; b++) {
      tiles.push({ id: uid('tile'), a, b });
    }
  }
  return tiles; // 28 tiles
}

function tilePips(tile) {
  return tile.a + tile.b;
}

function handPips(hand) {
  return hand.reduce((sum, t) => sum + tilePips(t), 0);
}

function tileMatchesEnd(tile, end) {
  return end === null || tile.a === end || tile.b === end;
}

function dominoLobbyData() {
  return Array.from(dominoRooms.values())
    .filter((room) => !room.game && room.players.length < room.capacity)
    .map((room) => ({
      id: room.id,
      name: room.name,
      players: room.players.length,
      capacity: room.capacity,
      rounds: room.rounds
    }));
}

function broadcastDominoLobby() {
  io.emit('dominoLobbyTables', dominoLobbyData());
}

function makeDominoRoom(name, capacity, rounds) {
  const room = {
    id: uid('droom'),
    name: clean(name) || 'Domino Table',
    capacity: DOMINO_CAPACITIES.includes(Number(capacity)) ? Number(capacity) : 4,
    rounds: DOMINO_ROUNDS_OPTIONS.includes(Number(rounds)) ? Number(rounds) : 1,
    players: [],
    game: null,
    timer: null,
    botTimer: null
  };
  dominoRooms.set(room.id, room);
  broadcastDominoLobby();
  return room;
}

function createDominoHumanPlayer(user, socket, guestName) {
  return {
    id: user ? user.id : uid('dguest'),
    userId: user ? user.id : null,
    name: user ? user.username : (clean(guestName) || 'Guest'),
    avatar: user ? user.avatar : '😎',
    socketId: socket.id,
    isBot: false,
    connected: true,
    hand: [],
    matchScore: 0,
    xp: user ? user.xp : 0,
    level: user ? user.level : 1,
    reconnectTimer: null
  };
}

function createDominoBot(number) {
  return {
    id: uid('dbot'),
    userId: null,
    name: 'BOT ' + number,
    avatar: '🤖',
    socketId: null,
    isBot: true,
    connected: true,
    hand: [],
    matchScore: 0,
    xp: 0,
    level: rand(2, 8),
    reconnectTimer: null
  };
}

function fillDominoBots(room) {
  let number = 1;
  while (room.players.length < room.capacity) {
    room.players.push(createDominoBot(number++));
  }
}

function dealDomino(players, deck) {
  players.forEach((player) => { player.hand = []; });
  let i = 0;
  while (deck.length && players.some((p) => p.hand.length < 7)) {
    const player = players[i % players.length];
    if (player.hand.length < 7) {
      player.hand.push(deck.pop());
    }
    i++;
  }
  return deck; // remaining tiles = boneyard
}

function findStartingPlayerIndex(players) {
  let bestIndex = 0;
  let bestScore = -1;
  players.forEach((player, index) => {
    player.hand.forEach((tile) => {
      const isDouble = tile.a === tile.b;
      const score = (isDouble ? 1000 : 0) + tilePips(tile);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
  });
  return bestIndex;
}

function startDominoRound(room, previousGame) {
  const roundIndex = previousGame ? previousGame.roundIndex + 1 : 1;
  const fairness = makeFairness(room, 'domino-' + roundIndex);
  const deck = seededShuffle(canonicalDominoSet(), fairness.seedInput);
  const boneyard = dealDomino(room.players, deck);
  const startIndex = findStartingPlayerIndex(room.players);

  room.game = {
    roundIndex,
    totalRounds: room.rounds,
    chain: [],
    leftEnd: null,
    rightEnd: null,
    boneyard,
    current: startIndex,
    passStreak: 0,
    processing: false,
    gameOver: false,
    turnEndsAt: 0,
    fairness,
    history: previousGame ? previousGame.history : []
  };

  return room.game;
}

function dominoHasLegalMove(player, game) {
  if (!game.chain.length) return true;
  return player.hand.some((tile) => tileMatchesEnd(tile, game.leftEnd) || tileMatchesEnd(tile, game.rightEnd));
}

function dominoAutoDraw(room) {
  const game = room.game;
  const player = room.players[game.current];
  let drewAny = false;

  while (!dominoHasLegalMove(player, game) && game.boneyard.length) {
    player.hand.push(game.boneyard.pop());
    drewAny = true;
  }

  return drewAny;
}

function buildDominoState(room, viewerId, revealAll) {
  const game = room.game;
  if (!game) return null;

  const hands = {};
  room.players.forEach((player) => {
    if (revealAll || player.id === viewerId) {
      hands[player.id] = player.hand;
    }
  });

  return {
    roomId: room.id,
    roomName: room.name,
    capacity: room.capacity,
    rounds: room.rounds,
    viewerId,
    roundIndex: game.roundIndex,
    totalRounds: game.totalRounds,
    chain: game.chain,
    leftEnd: game.leftEnd,
    rightEnd: game.rightEnd,
    boneyardCount: game.boneyard.length,
    currentTurnIndex: game.current,
    processing: game.processing,
    gameOver: game.gameOver,
    turnEndsAt: game.turnEndsAt,
    turnSeconds: DOMINO_TURN_SECONDS,
    fairnessHash: game.fairness ? game.fairness.hash : null,
    history: game.history,
    hands,
    players: room.players.map((player, index) => ({
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      isBot: player.isBot,
      connected: player.connected,
      tileCount: player.hand.length,
      matchScore: player.matchScore,
      level: player.level,
      frame: (userOf(player) && userOf(player).equipped && userOf(player).equipped.frame) || 'none',
      isCurrent: index === game.current
    }))
  };
}

function broadcastDominoGame(room) {
  if (!room || !room.game) return;
  room.players.forEach((player) => {
    if (player.isBot || !player.socketId || !player.connected) return;
    io.to(player.socketId).emit('dominoStateUpdate', buildDominoState(room, player.id, isTester(player.name)));
  });
}

function setDominoTurn(room, index) {
  const game = room.game;
  if (!game || game.gameOver) return;

  if (room.timer) { clearTimeout(room.timer); room.timer = null; }

  game.current = index % room.players.length;

  const drewSomething = dominoAutoDraw(room);
  const player = room.players[game.current];

  if (!dominoHasLegalMove(player, game)) {
    // Forced pass — advance to next player.
    game.passStreak += 1;

    if (game.passStreak >= room.players.length) {
      finishDominoRound(room, null); // blocked game
      return;
    }

    setDominoTurn(room, game.current + 1);
    return;
  }

  game.turnEndsAt = Date.now() + DOMINO_TURN_SECONDS * 1000;
  room.timer = setTimeout(() => dominoAutoPlay(room), DOMINO_TURN_SECONDS * 1000);

  broadcastDominoGame(room);
  scheduleDominoBot(room);
}

function dominoPlaceTile(room, player, tileId, side) {
  const game = room.game;
  if (!game || game.processing || game.gameOver) return false;

  const active = room.players[game.current];
  if (!active || active.id !== player.id) return false;

  const tileIndex = player.hand.findIndex((t) => t.id === tileId);
  if (tileIndex < 0) return false;

  const tile = player.hand[tileIndex];

  if (!game.chain.length) {
    game.chain.push({ id: tile.id, left: tile.a, right: tile.b });
    game.leftEnd = tile.a;
    game.rightEnd = tile.b;
  } else {
    const wantsLeft = side === 'left';
    const targetEnd = wantsLeft ? game.leftEnd : game.rightEnd;
    const otherEnd = wantsLeft ? game.rightEnd : game.leftEnd;

    let matchSide = null;
    if (tile.a === targetEnd || tile.b === targetEnd) {
      matchSide = wantsLeft ? 'left' : 'right';
    } else if (tile.a === otherEnd || tile.b === otherEnd) {
      matchSide = wantsLeft ? 'right' : 'left';
    } else {
      if (player.socketId) io.to(player.socketId).emit('dominoError', 'ეს კამათელი აქ არ ერგება.');
      return false;
    }

    if (matchSide === 'left') {
      const outward = tile.a === game.leftEnd ? tile.b : tile.a;
      game.chain.unshift({ id: tile.id, left: outward, right: game.leftEnd });
      game.leftEnd = outward;
    } else {
      const outward = tile.a === game.rightEnd ? tile.b : tile.a;
      game.chain.push({ id: tile.id, left: game.rightEnd, right: outward });
      game.rightEnd = outward;
    }
  }

  player.hand.splice(tileIndex, 1);
  game.passStreak = 0;

  io.to('domino:' + room.id).emit('dominoPlayFX', { playerId: player.id });

  if (player.hand.length === 0) {
    finishDominoRound(room, player);
    return true;
  }

  setDominoTurn(room, game.current + 1);
  return true;
}

async function finishDominoRound(room, wentOutPlayer) {
  const game = room.game;
  if (!game) return;

  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }

  game.processing = true;

  const pipsByPlayer = {};
  room.players.forEach((player) => { pipsByPlayer[player.id] = handPips(player.hand); });

  let winner = wentOutPlayer;
  let reason = 'out';

  if (!winner) {
    reason = 'blocked';
    let minPips = Infinity;
    room.players.forEach((player) => {
      if (pipsByPlayer[player.id] < minPips) {
        minPips = pipsByPlayer[player.id];
        winner = player;
      }
    });
  }

  const awarded = room.players.reduce(
    (sum, player) => (player.id === winner.id ? sum : sum + pipsByPlayer[player.id]),
    0
  );

  winner.matchScore += awarded;

  const fairnessForRound = game.fairness;
  game.history.push({
    round: game.roundIndex,
    winnerId: winner.id,
    winnerName: winner.name,
    reason,
    awarded,
    pips: pipsByPlayer
  });

  if (fairnessForRound) {
    io.to('domino:' + room.id).emit('dominoFairnessReveal', {
      round: game.roundIndex,
      seed: fairnessForRound.seed,
      hash: fairnessForRound.hash
    });
  }

  io.to('domino:' + room.id).emit('dominoRoundEnd', {
    winnerId: winner.id,
    winnerName: winner.name,
    reason,
    awarded,
    pips: pipsByPlayer
  });

  if (game.roundIndex >= game.totalRounds) {
    finishDominoMatch(room);
    return;
  }

  setTimeout(() => {
    if (!dominoRooms.has(room.id) || room.game !== game) return;

    const nextGame = startDominoRound(room, game);
    setDominoTurn(room, nextGame.current);
  }, 2600);
}

async function finishDominoMatch(room) {
  const game = room.game;
  if (!game) return;

  game.gameOver = true;

  let champion = room.players[0];
  room.players.forEach((player) => {
    if (player.matchScore > champion.matchScore) champion = player;
  });

  const avgRating = room.players.reduce((sum, p) => {
    const u = userOf(p);
    return sum + (u ? u.rating : 1000);
  }, 0) / (room.players.length || 1);

  room.players.forEach((player) => {
    const user = userOf(player);
    if (!user) return;
    defaults(user);

    const isWinner = player.id === champion.id;
    const expected = 1 / (1 + Math.pow(10, (avgRating - user.rating) / 400));
    user.rating = Math.max(0, Math.round(user.rating + 24 * ((isWinner ? 1 : 0) - expected)));

    user.stats.partiesPlayed += 1;
    if (isWinner) {
      user.stats.partiesWon += 1;
      user.coins = Number(user.coins || 0) + 40;
      addXP(user, 60);
    } else {
      addXP(user, 15);
    }
  });

  await saveUsersNow();

  io.to('domino:' + room.id).emit('dominoMatchEnd', { winnerId: champion.id, winnerName: champion.name });
  broadcastDominoGame(room);
}

function dominoBotChoice(player, game) {
  const legal = [];
  player.hand.forEach((tile) => {
    if (!game.chain.length) {
      legal.push({ tile, side: 'right' });
      return;
    }
    if (tileMatchesEnd(tile, game.leftEnd)) legal.push({ tile, side: 'left' });
    if (tileMatchesEnd(tile, game.rightEnd)) legal.push({ tile, side: 'right' });
  });

  if (!legal.length) return null;

  // Prefer playing doubles and higher-pip tiles first (simple heuristic).
  legal.sort((a, b) => {
    const da = a.tile.a === a.tile.b ? 1 : 0;
    const db = b.tile.a === b.tile.b ? 1 : 0;
    if (da !== db) return db - da;
    return tilePips(b.tile) - tilePips(a.tile);
  });

  return legal[0];
}

function scheduleDominoBot(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }

  const player = room.players[room.game.current];
  if (!player || !player.isBot) return;

  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!room.game || room.game.processing || room.game.gameOver) return;

    const active = room.players[room.game.current];
    if (!active || active.id !== player.id) return;

    const choice = dominoBotChoice(player, room.game);
    if (choice) {
      dominoPlaceTile(room, player, choice.tile.id, choice.side);
    }
  }, rand(1000, 1700));
}

function dominoAutoPlay(room) {
  if (!room || !room.game || room.game.processing || room.game.gameOver) return;
  const player = room.players[room.game.current];
  if (!player) return;

  const choice = dominoBotChoice(player, room.game);
  if (choice) {
    dominoPlaceTile(room, player, choice.tile.id, choice.side);
  }
}

function joinDominoRoom(socket, data) {
  const user = users.get(socket.data.userId);

  let room = data.roomId ? dominoRooms.get(data.roomId) : null;

  if (room && (room.game || room.players.length >= room.capacity)) {
    socket.emit('dominoError', 'მაგიდა აღარ არის თავისუფალი.');
    return;
  }

  if (!room) {
    room = makeDominoRoom(data.tableName, data.capacity, data.rounds);
  }

  let player = user
    ? createDominoHumanPlayer(user, socket)
    : createDominoHumanPlayer(null, socket, data.name);

  const existing = user ? room.players.find((p) => p.userId === user.id) : null;

  if (existing) {
    player = existing;
    player.socketId = socket.id;
    player.connected = true;
    player.isBot = false;
    if (player.reconnectTimer) { clearTimeout(player.reconnectTimer); player.reconnectTimer = null; }
  } else {
    room.players.push(player);
  }

  socket.data.dominoRoomId = room.id;
  socket.data.dominoPlayerId = player.id;
  socket.join('domino:' + room.id);

  if (isTester(player.name)) {
    fillDominoBots(room);
  }

  if (room.players.length >= room.capacity) {
    const game = startDominoRound(room);
    io.to('domino:' + room.id).emit('dominoDealAnimation');
    setDominoTurn(room, game.current);
  } else {
    io.to('domino:' + room.id).emit('dominoWaiting', { current: room.players.length, max: room.capacity });
  }

  broadcastDominoLobby();
}

function dominoCleanupRoom(room) {
  if (!room) return;
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  room.players.forEach((player) => {
    if (player.reconnectTimer) { clearTimeout(player.reconnectTimer); player.reconnectTimer = null; }
  });
}

setInterval(() => {
  dominoRooms.forEach((room, id) => {
    const connectedHumans = room.players.filter((p) => !p.isBot && p.connected);
    if (room.game && room.game.gameOver && connectedHumans.length === 0) {
      dominoCleanupRoom(room);
      dominoRooms.delete(id);
      return;
    }
    if (!room.game && room.players.length === 0) {
      dominoCleanupRoom(room);
      dominoRooms.delete(id);
    }
  });
  broadcastDominoLobby();
}, 60000);

/* ============================================================
   MONOLITHIC PAGE
   ============================================================ */

const PAGE = String.raw`<!doctype html>
<html lang="ka">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07110e">

<title>Written Bura</title>

<style>
*{box-sizing:border-box}

:root{
 --bg:#07110e;
 --glass:rgba(7,20,17,.78);
 --gold:#e5bd61;
 --felt:#073f2d;
 --felt2:#052a20;
 --wood:#492718;
 --text:#f7f3e8;
 --muted:#9eb1aa;
 --red:#7c1725;
 --green:#1ba66d;

 --felt-a:#07513a;
 --felt-b:#052b21
}

.wood[data-felt="royal"]{
 --felt-a:#123a6b;
 --felt-b:#0a2242
}

.wood[data-felt="wine"]{
 --felt-a:#5c1023;
 --felt-b:#310511
}

.wood[data-felt="violet"]{
 --felt-a:#3b1f5c;
 --felt-b:#1c0e33
}

.wood[data-felt="obsidian"]{
 --felt-a:#242428;
 --felt-b:#060607
}

.wood[data-felt="sunset"]{
 --felt-a:#8a3d2e;
 --felt-b:#4a1030
}

.wood[data-felt="neon"]{
 --felt-a:#0d3b45;
 --felt-b:#1a0a2e
}

.wood[data-felt="galaxy"]{
 --felt-a:#241257;
 --felt-b:#08061c
}

.wood[data-felt="rosegold"]{
 --felt-a:#6b3f43;
 --felt-b:#2e1a1c
}

html,body{
 margin:0;
 min-height:100%;
 font-family:Arial,"Noto Sans Georgian",sans-serif;
 background:#050b09;
 color:var(--text)
}

body{overflow-x:hidden}

button,input,select{font:inherit}
button{cursor:pointer}
.hidden{display:none!important}

.bg{
 position:fixed;
 inset:0;
 z-index:-5;
 background:
  radial-gradient(circle at 50% 20%,rgba(21,121,82,.18),transparent 35%),
  linear-gradient(135deg,#040806,#0b1c16 50%,#050907)
}

.bg:after{
 content:"♠   ♥   ♦   ♣";
 position:absolute;
 inset:0;
 display:grid;
 place-items:center;
 font-size:min(20vw,260px);
 letter-spacing:4vw;
 color:rgba(255,255,255,.018);
 filter:blur(2px)
}

.glass{
 background:
  linear-gradient(
   135deg,
   rgba(255,255,255,.08),
   rgba(255,255,255,.025)
  );
 border:1px solid rgba(255,255,255,.12);
 backdrop-filter:blur(18px);
 box-shadow:0 20px 70px rgba(0,0,0,.35)
}

#auth,#lobby{
 width:min(1100px,94vw);
 margin:35px auto
}

.brand{
 font-size:30px;
 font-weight:900;
 letter-spacing:.5px
}

.brand span{color:var(--gold)}

.authbox{
 width:min(520px,100%);
 margin:10vh auto;
 padding:28px;
 border-radius:28px
}

.tabs{
 display:flex;
 gap:8px;
 margin:20px 0
}

.tabs button,
.smallBtn{
 border:1px solid rgba(255,255,255,.12);
 background:#10231d;
 color:white;
 border-radius:12px;
 padding:10px 15px
}

.tabs button.active{
 background:var(--gold);
 color:#15100a
}

.field{
 width:100%;
 padding:13px;
 margin:7px 0;
 border-radius:13px;
 border:1px solid #29443a;
 background:#081612;
 color:white
}

.primary{
 border:0;
 background:
  linear-gradient(
   135deg,
   #e8c76e,
   #a87523
  );
 color:#171006;
 font-weight:900;
 padding:13px 18px;
 border-radius:14px;
 box-shadow:
  0 8px 25px
  rgba(229,189,97,.22)
}

.avatarChoices{
 display:flex;
 gap:8px;
 flex-wrap:wrap;
 margin:10px 0
}

.avatarChoice{
 font-size:25px;
 background:#10231d;
 border:2px solid transparent;
 border-radius:50%;
 width:48px;
 height:48px
}

.avatarChoice.on{
 border-color:var(--gold)
}

.top{
 display:flex;
 justify-content:space-between;
 align-items:center;
 gap:12px;
 margin-bottom:18px
}

.profile{
 display:flex;
 align-items:center;
 gap:10px
}

.profileAvatar{
 width:52px;
 height:52px;
 border-radius:50%;
 display:grid;
 place-items:center;
 font-size:27px;
 border:2px solid var(--gold);
 overflow:hidden
}

.profileAvatar img,
.avatar img{
 width:100%;
 height:100%;
 object-fit:cover
}

.level{
 font-size:11px;
 background:var(--gold);
 color:#171006;
 border-radius:20px;
 padding:3px 8px;
 font-weight:900
}

.grid{
 display:grid;
 grid-template-columns:1.2fr .8fr;
 gap:16px
}

.panel{
 padding:18px;
 border-radius:22px
}

.tableRow,
.tourRow{
 display:flex;
 align-items:center;
 justify-content:space-between;
 gap:12px;
 padding:12px;
 border-bottom:
  1px solid
  rgba(255,255,255,.08)
}

.stakes{
 display:flex;
 gap:8px;
 flex-wrap:wrap
}

.stake{
 padding:10px 14px;
 border-radius:12px;
 background:#10231d;
 color:white;
 border:1px solid #315247
}

.stake.on{
 background:var(--gold);
 color:#181108
}

.quest{
 padding:10px;
 background:rgba(0,0,0,.18);
 border-radius:12px;
 margin:8px 0
}

.progress{
 height:7px;
 background:#172720;
 border-radius:10px;
 overflow:hidden;
 margin-top:6px
}

.progress i{
 display:block;
 height:100%;
 background:var(--gold)
}

.error{
 color:#ff8994;
 min-height:20px;
 margin:8px 0
}

/* GAME */

#game{
 min-height:100vh;
 padding:10px 12px 20px
}

.hud{
 display:flex;
 justify-content:center;
 gap:8px;
 flex-wrap:wrap;
 position:relative;
 z-index:20
}

.pill{
 padding:8px 13px;
 border-radius:999px;
 background:rgba(6,18,15,.72);
 border:
  1px solid
  rgba(255,255,255,.13);
 box-shadow:
  0 6px 22px #0006
}

.pill b{color:var(--gold)}

.gameButtons{
 position:absolute;
 right:15px;
 top:12px;
 display:flex;
 gap:6px;
 z-index:30
}

.arena{
 height:calc(100vh - 75px);
 min-height:620px;
 position:relative;
 display:flex;
 align-items:center;
 justify-content:center
}

.wood{
 width:min(1120px,94vw);
 height:min(690px,78vh);
 min-height:540px;
 border-radius:48% / 42%;
 padding:22px;

 background:
  linear-gradient(
   90deg,
   rgba(255,255,255,.07),
   transparent 12%,
   rgba(0,0,0,.18)
  ),
  repeating-linear-gradient(
   90deg,
   #4b2818 0 25px,
   #57301d 25px 50px,
   #3e2115 50px 75px
  );

 box-shadow:
  0 40px 100px #000,
  inset 0 0 0 4px #7b4d2b,
  inset 0 0 40px #000
}

.table{
 width:100%;
 height:100%;
 border-radius:48% / 42%;
 position:relative;
 overflow:hidden;

 background:
  radial-gradient(
   ellipse at 50% 42%,
   rgba(31,132,87,.3),
   transparent 42%
  ),
  repeating-radial-gradient(
   circle at 30% 30%,
   rgba(255,255,255,.018)
   0 1px,
   transparent 1px 4px
  ),
  linear-gradient(
   145deg,
   var(--felt-a),
   var(--felt-b)
  );

 box-shadow:
  inset 0 0 90px #001a12,
  inset 0 0 0 3px
  rgba(255,255,255,.05)
}

.table:after{
 content:"";
 position:absolute;
 inset:0;
 pointer-events:none;
 box-shadow:
  inset 0 0 120px #0008;
 border-radius:inherit
}

.trump{
 position:absolute;
 left:50%;
 top:36%;
 transform:
  translate(-50%,-50%);
 text-align:center;
 z-index:3
}

.trumpSymbol{
 font-size:75px;
 line-height:1;
 text-shadow:
  0 0 8px white,
  0 0 22px #f1c45b,
  0 0 45px #e0a529;
 filter:
  drop-shadow(
   0 14px 10px #0008
  )
}

.trumpLabel{
 font-size:11px;
 letter-spacing:3px;
 color:#d9c58e
}

.deck{
 position:absolute;
 left:42%;
 top:50%;
 width:62px;
 height:88px;
 border-radius:9px;
 background:
  linear-gradient(
   135deg,
   #142e67,
   #071738
  );
 border:3px solid white;
 box-shadow:
  6px 6px 0 #07162f,
  10px 10px 0 #061126;
 z-index:4
}

.deck:after{
 content:"♠";
 display:grid;
 place-items:center;
 height:100%;
 font-size:38px;
 color:#d9b85e
}

.centerCards{
 position:absolute;
 left:50%;
 top:54%;
 transform:
  translate(-50%,-50%);
 display:flex;
 gap:5px;
 z-index:8
}

.playGroup{
 display:flex;
 gap:3px;
 margin:0 -8px;
 animation:drop .4s cubic-bezier(.22,1.4,.36,1)
}

@keyframes drop{
 0%{
  transform:
   translate3d(0,-70px,0)
   scale(.55)
   rotate(-14deg);
  opacity:0
 }
 65%{
  transform:
   translate3d(0,6px,0)
   scale(1.05)
   rotate(3deg);
  opacity:1
 }
 100%{
  transform:none;
  opacity:1
 }
}

@keyframes dealFlight{
 0%{
  transform:
   translate3d(-40vw,-40vh,0)
   scale(.4)
   rotate(-90deg);
  opacity:0
 }
 60%{
  opacity:1
 }
 100%{
  transform:none;
  opacity:1
 }
}

@keyframes shimmer{
 0%,100%{
  filter:
   drop-shadow(0 0 4px #ffe9a8)
   brightness(1)
 }
 50%{
  filter:
   drop-shadow(0 0 16px #ffd86b)
   brightness(1.18)
 }
}

.card{
 width:66px;
 height:96px;
 border-radius:10px;
 background:
  linear-gradient(
   145deg,
   #fff,
   #e9e5dc
  );
 border:1px solid #fff;
 box-shadow:
  0 8px 18px #0008;
 position:relative;
 color:#101010;
 display:flex;
 flex-direction:column;
 align-items:center;
 justify-content:center;
 font-weight:900;
 user-select:none;
 transform-style:preserve-3d;
 will-change:transform;
 transition:
  .22s cubic-bezier(.34,1.56,.64,1) transform,
  .22s ease box-shadow,
  .22s ease filter
}

.card:before{
 content:"";
 position:absolute;
 inset:1px;
 border-radius:9px;
 background:
  linear-gradient(
   120deg,
   rgba(255,255,255,.75),
   transparent 35%
  );
 pointer-events:none
}

.card .rank{
 font-size:20px
}

.card .suit{
 font-size:25px
}

.card.hearts{
 color:#e63946
}

.card.diamonds{
 color:#0077b6
}

.card.clubs{
 color:#2a9d8f
}

.card.spades{
 color:#111111
}

.card.selected{
 transform:
  translateY(-20px)
  scale(1.06)
  rotate(-2deg)
  !important;
 box-shadow:
  0 0 0 3px #e7bd54,
  0 0 28px #ffd86b,
  0 12px 25px #0009
}

.card.cutGlow{
 box-shadow:
  0 0 28px #fff,
  0 0 50px #e9c45e
}

.card.winnerGlow{
 box-shadow:
  0 0 0 3px #ffe9a8,
  0 0 30px #ffd86b,
  0 0 60px #f0b52c,
  0 12px 25px #0009;
 animation:
  shimmer 1s ease-in-out infinite
}

.seat{
 position:absolute;
 z-index:12;
 text-align:center;
 min-width:120px;
 transform:
  translate(-50%,-50%)
}

.avatarWrap{
 position:relative;
 display:inline-block
}

.avatar{
 width:70px;
 height:70px;
 border-radius:50%;
 background:#17251f;
 border:3px solid #d4a944;
 display:grid;
 place-items:center;
 font-size:34px;
 overflow:hidden;
 box-shadow:
  0 7px 20px #0008;
 transition:.25s
}

.seat.active .avatar{
 box-shadow:
  0 0 0 4px #f0c85b55,
  0 0 30px #f6ce5d,
  0 0 55px #43d893;
 animation:
  pulse 1s infinite alternate
}

@keyframes pulse{
 to{
  transform:scale(1.06)
 }
}

.seatName{
 font-weight:900;
 text-shadow:
  0 2px 5px #000;
 margin-top:4px
}

.seatMeta{
 font-size:11px;
 color:#d7d9cf
}

.levelBadge{
 position:absolute;
 right:-5px;
 bottom:2px;
 background:var(--gold);
 color:#1a1208;
 border-radius:20px;
 padding:3px 7px;
 font-size:10px;
 font-weight:900
}

.timerRing{
 position:absolute;
 inset:-7px;
 border-radius:50%;
 border:3px solid transparent;
 pointer-events:none
}

.seat.active .timerRing{
 border-top-color:#f4cf65;
 border-right-color:#49d69a
}

.me{
 left:50%;
 bottom:2%;
 top:auto;
 transform:
  translateX(-50%)
}

.topSeat{
 left:50%;
 top:10%
}

.leftSeat{
 left:10%;
 top:50%
}

.rightSeat{
 left:90%;
 top:50%
}

.hand{
 position:absolute;
 left:50%;
 bottom:4%;
 transform:
  translateX(-50%);
 display:flex;
 justify-content:center;
 z-index:20;
 height:125px
}

.hand .card{
 margin-left:-18px;
 transform-origin:50% 150%;
 cursor:pointer
}

.hand .card:first-child{
 margin-left:0
}

.hand .card:hover{
 transform:
  translateY(-14px)
  scale(1.04)
  rotateZ(-1deg)
}

.actionArea{
 position:absolute;
 left:50%;
 bottom:145px;
 transform:
  translateX(-50%);
 z-index:30;
 text-align:center
}

.playBtn{
 min-width:180px;
 border:0;
 border-radius:16px;
 padding:13px 20px;
 background:#234037;
 color:#778c85;
 font-weight:900;
 box-shadow:
  0 8px 20px #0007
}

.playBtn.ready{
 background:
  linear-gradient(
   135deg,
   #f0ce73,
   #a87826
  );
 color:#171007;
 box-shadow:
  0 0 25px #e7bd5555
}

.status{
 font-size:12px;
 margin-top:6px;
 text-shadow:
  0 2px 4px #000
}

.side{
 position:absolute;
 right:16px;
 top:75px;
 width:260px;
 z-index:25
}

.score{
 border-radius:18px;
 padding:13px;
 max-height:380px;
 overflow:auto
}

.score h3{
 margin:0 0 8px
}

.scorePlayer{
 display:flex;
 justify-content:space-between;
 align-items:center;
 padding:6px 4px;
 border-radius:8px
}

.scorePlayer.leader{
 background:rgba(229,189,97,.12)
}

.scoreName{
 display:flex;
 align-items:center;
 gap:5px;
 overflow:hidden;
 text-overflow:ellipsis;
 white-space:nowrap
}

.total{
 font-size:18px;
 color:var(--gold);
 font-weight:900
}

.total.negative{
 color:#ff8994
}

.historyItem{
 font-size:11px;
 padding:7px 6px;
 border-top:
  1px solid #ffffff12;
 color:#cad7d1
}

.historyItem b{
 color:var(--gold)
}

.historyRaw{
 display:flex;
 flex-wrap:wrap;
 gap:2px 8px;
 margin-top:3px
}

.historyRaw span.zero{
 color:#ff8994
}

.reactions{
 margin-top:8px;
 border-radius:16px;
 padding:9px;
 display:flex;
 flex-wrap:wrap;
 gap:5px
}

.reactions button{
 border:
  1px solid #ffffff18;
 background:#10231d;
 color:white;
 border-radius:10px;
 padding:7px;
 font-size:11px
}

.giftMenu{
 position:fixed;
 z-index:100;
 background:#0b1915;
 border:
  1px solid #d9b65b;
 border-radius:15px;
 padding:8px;
 display:flex;
 gap:5px;
 box-shadow:
  0 15px 50px #000
}

.giftMenu button{
 font-size:24px;
 background:#13261f;
 border:0;
 border-radius:10px;
 padding:8px
}

.feltMenu{
 position:fixed;
 z-index:100;
 background:#0b1915;
 border:
  1px solid #d9b65b;
 border-radius:15px;
 padding:10px;
 display:flex;
 gap:8px;
 box-shadow:
  0 15px 50px #000
}

.feltSwatch{
 width:34px;
 height:34px;
 border-radius:50%;
 border:2px solid rgba(255,255,255,.35);
 cursor:pointer;
 padding:0;
 transition:.15s transform,.15s border-color
}

.feltSwatch:hover{
 transform:scale(1.12)
}

.feltSwatch.on{
 border-color:var(--gold);
 box-shadow:0 0 12px rgba(229,189,97,.6)
}

.projectile{
 position:fixed;
 z-index:999;
 font-size:35px;
 pointer-events:none;
 transition:
  transform .7s
  cubic-bezier(.2,.7,.2,1)
}

.splat{
 position:absolute;
 inset:0;
 display:grid;
 place-items:center;
 font-size:48px;
 z-index:50;
 pointer-events:none;
 animation:
  splat .25s ease
}

@keyframes splat{
 from{
  transform:
   scale(.2)
   rotate(-40deg)
 }
 to{
  transform:
   scale(1)
   rotate(0)
 }
}

.toast{
 position:fixed;
 left:50%;
 top:85px;
 transform:
  translateX(-50%);
 z-index:500;
 padding:13px 20px;
 border-radius:15px;
 background:#111f1a;
 border:
  1px solid #d7b45c;
 box-shadow:
  0 15px 50px #000;
 animation:
  toast .3s ease
}

@keyframes toast{
 from{
  transform:
   translate(-50%,-20px);
  opacity:0
 }
}

.modal{
 position:fixed;
 inset:0;
 background:#000b;
 z-index:1000;
 display:grid;
 place-items:center;
 padding:15px
}

.modalBox{
 width:min(760px,96vw);
 max-height:86vh;
 overflow:auto;
 border-radius:24px;
 padding:24px;
 background:#0c1915;
 border:
  1px solid #ffffff20
}

.modalBox h2{
 color:var(--gold)
}

.rule{
 background:#ffffff08;
 border-radius:14px;
 padding:12px;
 margin:8px 0;
 line-height:1.55
}

/* ===== PHASE 1: TOP UTILITY BAR ===== */

.topBar{
 display:flex;
 gap:6px;
 flex-wrap:wrap
}

.topBar button{
 border:1px solid rgba(255,255,255,.14);
 background:#10231d;
 color:white;
 border-radius:10px;
 padding:8px 11px;
 font-size:12px;
 white-space:nowrap
}

.langSelect{
 border:1px solid rgba(255,255,255,.14);
 background:#10231d;
 color:white;
 border-radius:10px;
 padding:8px 9px;
 font-size:12px
}

/* ===== LEADERBOARD / FRIENDS / STATS / SHOP ROWS ===== */

.lbRow,
.friendRow,
.shopRow{
 display:flex;
 align-items:center;
 justify-content:space-between;
 gap:10px;
 padding:9px 4px;
 border-bottom:1px solid rgba(255,255,255,.08)
}

.lbRank{
 width:26px;
 text-align:center;
 font-weight:900;
 color:var(--muted)
}

.lbRow:nth-child(1) .lbRank{color:#ffd75e}
.lbRow:nth-child(2) .lbRank{color:#d7d7d7}
.lbRow:nth-child(3) .lbRank{color:#d3925a}

.lbWho,
.friendWho{
 display:flex;
 align-items:center;
 gap:8px;
 min-width:0
}

.lbWho span,
.friendWho span{
 overflow:hidden;
 text-overflow:ellipsis;
 white-space:nowrap
}

.onlineDot{
 width:8px;
 height:8px;
 border-radius:50%;
 background:#3a4a44;
 flex:none
}

.onlineDot.on{
 background:#49d69a;
 box-shadow:0 0 6px #49d69a
}

.rankPill{
 font-size:11px;
 padding:3px 8px;
 border-radius:20px;
 background:rgba(255,255,255,.08)
}

.shopItem{
 display:flex;
 flex-direction:column;
 gap:8px;
 padding:14px;
 border-radius:16px;
 background:rgba(255,255,255,.05);
 border:1px solid rgba(255,255,255,.1)
}

.shopGrid{
 display:grid;
 grid-template-columns:repeat(auto-fill,minmax(150px,1fr));
 gap:10px
}

.shopSwatch{
 height:50px;
 border-radius:10px
}

.shopBtn{
 border:0;
 border-radius:10px;
 padding:8px;
 font-weight:900;
 background:linear-gradient(135deg,#e8c76e,#a87523);
 color:#171006
}

.shopBtn.owned{
 background:#28402f;
 color:#8fbf9f
}

.shopBtn.locked{
 background:#2a2a2a;
 color:#777
}

.statGrid{
 display:grid;
 grid-template-columns:1fr 1fr;
 gap:10px;
 margin:12px 0
}

.statBox{
 background:rgba(255,255,255,.05);
 border-radius:14px;
 padding:12px;
 text-align:center
}

.statBox b{
 display:block;
 font-size:22px;
 color:var(--gold)
}

.statBox small{
 color:var(--muted)
}

.sparkRow{
 display:flex;
 align-items:flex-end;
 gap:3px;
 height:60px;
 margin-top:10px
}

.sparkBar{
 flex:1;
 border-radius:3px 3px 0 0;
 min-height:3px
}

.sparkBar.win{background:#49d69a}
.sparkBar.loss{background:#e0616f}

.friendAdd{
 display:flex;
 gap:8px;
 margin-bottom:10px
}

.friendAdd input{
 flex:1
}

/* ===== COSMETIC AVATAR FRAMES ===== */

.avatar.frame-bronze,
.profileAvatar.frame-bronze{
 border-color:#c98a4b;
 box-shadow:0 0 14px #c98a4b88
}

.avatar.frame-silver,
.profileAvatar.frame-silver{
 border-color:#d7d7e0;
 box-shadow:0 0 14px #d7d7e088
}

.avatar.frame-gold,
.profileAvatar.frame-gold{
 border-color:#ffd75e;
 box-shadow:0 0 18px #ffd75ea0
}

.avatar.frame-diamond,
.profileAvatar.frame-diamond{
 border-color:#7be0e6;
 box-shadow:0 0 20px #7be0e6b0,0 0 40px #7be0e650
}

/* ===== FAIRNESS PANEL ===== */

.fairBox{
 font-size:10px;
 color:var(--muted);
 padding:8px;
 word-break:break-all;
 border-radius:10px;
 background:rgba(0,0,0,.2);
 margin-top:8px
}

.fairBox b{color:var(--gold)}

/* ===== STREAK / CONFETTI ===== */

.streakToast{
 position:fixed;
 left:50%;
 top:85px;
 transform:translateX(-50%);
 z-index:600;
 padding:14px 22px;
 border-radius:16px;
 background:linear-gradient(135deg,#2d1f08,#1a1206);
 border:1px solid #d7b45c;
 box-shadow:0 15px 50px #000;
 text-align:center
}

#confettiCanvas{
 position:fixed;
 inset:0;
 z-index:900;
 pointer-events:none
}

.volumeRow{
 display:flex;
 align-items:center;
 gap:8px
}

.volumeRow input[type="range"]{
 width:90px
}

.lockedSwatch{
 position:relative;
 opacity:.45
}

.lockedSwatch:after{
 content:"🔒";
 position:absolute;
 inset:0;
 display:grid;
 place-items:center;
 font-size:14px
}

.exclusionOptions{
 display:flex;
 flex-wrap:wrap;
 gap:8px;
 margin:10px 0
}

@media(max-width:850px){
 .grid{
  grid-template-columns:1fr
 }

 .side{
  right:6px;
  top:70px;
  width:190px
 }

 .wood{
  width:98vw;
  height:72vh;
  min-height:530px;
  padding:12px
 }

 .avatar{
  width:56px;
  height:56px;
  font-size:27px
 }

 .seat{
  min-width:90px
 }

 .leftSeat{
  left:8%
 }

 .rightSeat{
  left:92%
 }

 .card{
  width:53px;
  height:78px
 }

 .hand .card{
  margin-left:-22px
 }

 .hand{
  bottom:1%;
  height:105px
 }

 .actionArea{
  bottom:115px
 }

 .trumpSymbol{
  font-size:58px
 }
}

@media(max-width:600px){
 .side{
  top:110px;
  width:150px
 }

 .score{
  font-size:11px;
  max-height:220px
 }

 .reactions{
  display:none
 }

 .hud{
  padding-right:0
 }

 .pill{
  font-size:10px;
  padding:6px 9px
 }

 .gameButtons{
  position:relative;
  right:auto;
  top:auto;
  justify-content:center;
  margin-top:6px
 }

 .arena{
  min-height:570px
 }
}

/* ===== GAME MODE TABS ===== */
.modeTabs{
 display:flex;
 gap:8px;
 margin-bottom:16px
}
.modeTabs button{
 flex:1;
 padding:12px;
 border-radius:14px;
 border:1px solid rgba(255,255,255,.12);
 background:#10231d;
 color:white;
 font-weight:900
}
.modeTabs button.active{
 background:linear-gradient(135deg,#e8c76e,#a87523);
 color:#171006
}

/* ===== DOMINO ===== */
#dominoGame{min-height:100vh;padding:10px 12px 20px}
.dominoBoardWrap{
 width:min(1100px,94vw);
 min-height:420px;
 border-radius:28px;
 padding:24px;
 background:linear-gradient(135deg,#0b1c16,#061109);
 box-shadow:0 30px 90px #000,inset 0 0 0 3px #234036;
 position:relative
}
.dominoSeats{
 display:flex;
 justify-content:space-between;
 margin-bottom:14px;
 flex-wrap:wrap;
 gap:10px
}
.dominoSeat{
 display:flex;
 align-items:center;
 gap:8px;
 padding:6px 10px;
 border-radius:12px;
 background:rgba(255,255,255,.05)
}
.dominoSeat.active{
 background:rgba(229,189,97,.18);
 box-shadow:0 0 14px rgba(229,189,97,.4)
}
.dominoSeat .avatar{width:38px;height:38px;font-size:18px}
.dominoChainScroll{
 overflow-x:auto;
 padding:16px 4px;
 display:flex;
 align-items:center;
 min-height:120px
}
.dominoChain{
 display:flex;
 align-items:center;
 gap:2px;
 margin:0 auto
}
.dTile{
 display:flex;
 background:linear-gradient(145deg,#fdfaf2,#e9e3d3);
 border:1px solid #fff;
 border-radius:8px;
 box-shadow:0 6px 14px #0007;
 flex:none
}
.dTile.horizontal{width:64px;height:32px}
.dTile.half{
 flex:1;
 position:relative;
 border-right:1px solid #9a9282
}
.dTile.half:last-child{border-right:0}
.dTile .dot{
 position:absolute;
 width:5px;
 height:5px;
 border-radius:50%;
 background:#1a1a1a
}
.dEndZone{
 flex:none;
 width:50px;
 height:60px;
 border-radius:10px;
 border:2px dashed rgba(255,255,255,.25);
 display:grid;
 place-items:center;
 color:var(--muted);
 font-size:11px;
 cursor:pointer
}
.dEndZone.highlight{
 border-color:var(--gold);
 background:rgba(229,189,97,.12);
 color:var(--gold);
 animation:pulse 1s infinite alternate
}
.dominoHand{
 display:flex;
 justify-content:center;
 flex-wrap:wrap;
 gap:8px;
 margin-top:20px
}
.dTile.vertical{
 width:52px;
 height:96px;
 flex-direction:column;
 cursor:pointer;
 transition:.2s transform
}
.dTile.vertical.half{border-right:0;border-bottom:1px solid #9a9282}
.dTile.vertical.half:last-child{border-bottom:0}
.dTile.vertical:hover{transform:translateY(-8px)}
.dTile.vertical.selected{
 transform:translateY(-14px);
 box-shadow:0 0 0 3px #e7bd54,0 0 24px #ffd86b
}
.dominoHud{
 display:flex;
 justify-content:center;
 gap:8px;
 flex-wrap:wrap;
 margin-bottom:14px
}
.dominoStatus{
 text-align:center;
 margin-top:10px;
 font-size:13px;
 color:var(--muted)
}
.dominoScorePanel{
 width:min(1100px,94vw);
 margin:14px auto 0;
 display:flex;
 gap:10px;
 flex-wrap:wrap;
 justify-content:center
}
.dominoScoreCard{
 padding:10px 16px;
 border-radius:14px;
 background:rgba(255,255,255,.06);
 text-align:center;
 min-width:110px
}
.dominoScoreCard b{display:block;font-size:20px;color:var(--gold)}
</style>
</head>

<body>

<div class="bg"></div>

<section id="auth">
 <div class="authbox glass">

  <div class="brand">
   WRITTEN <span>BURA</span>
  </div>

  <p style="color:#9eb1aa">
   წერითი ბურა · ონლაინ მაგიდა
  </p>

  <div class="tabs">
   <button
    id="loginTab"
    class="active">
    შესვლა
   </button>

   <button id="registerTab">
    რეგისტრაცია
   </button>
  </div>

  <input
   id="username"
   class="field"
   placeholder="Username"
   value="saba123">

  <input
   id="password"
   class="field"
   type="password"
   placeholder="Password">

  <div
   id="avatarBox"
   class="hidden">

   <small>
    აირჩიე ავატარი
   </small>

   <div class="avatarChoices">
    <button class="avatarChoice on">🦊</button>
    <button class="avatarChoice">😎</button>
    <button class="avatarChoice">🦁</button>
    <button class="avatarChoice">🐺</button>
    <button class="avatarChoice">👑</button>
    <button class="avatarChoice">🧙</button>
   </div>

   <input
    id="avatarFile"
    class="field"
    type="file"
    accept="image/png,image/jpeg,image/webp">
  </div>

  <div
   id="authError"
   class="error">
  </div>

  <button
   id="authBtn"
   class="primary">
   შესვლა
  </button>

  <button
   id="testerBtn"
   class="smallBtn">
   🧪 saba123 TEST MODE
  </button>

 </div>
</section>

<section
 id="lobby"
 class="hidden">

 <div class="top">

  <div class="brand">
   WRITTEN <span>BURA</span>
  </div>

  <div class="profile">

   <div
    id="profileAvatar"
    class="profileAvatar">
    🦊
   </div>

   <div>
    <b id="profileName">
     Player
    </b>

    <div>
     <span
      id="profileLevel"
      class="level">
      LVL 1
     </span>

     <span
      id="profileRank"
      class="rankPill">
      🥉 Bronze
     </span>

     <small id="profileXp">
      0 XP
     </small>

     <small id="profileCoins">
      🪙 0
     </small>
    </div>
   </div>

  </div>

  <div class="topBar">

   <button id="leaderboardBtn">
    🏆 რეიტინგი
   </button>

   <button id="friendsBtn">
    👥 მეგობრები
   </button>

   <button id="statsBtn">
    📊 სტატისტიკა
   </button>

   <button id="shopBtn">
    🛍️ მაღაზია
   </button>

   <button id="infoBtn">
    ℹ️ ინფო
   </button>

   <select
    id="langSelect"
    class="langSelect">
    <option value="ka">🇬🇪 ქართული</option>
    <option value="en">🇬🇧 English</option>
    <option value="ru">🇷🇺 Русский</option>
   </select>

  </div>
 </div>

 <div class="modeTabs">
  <button id="modeBuraTab" class="active">🎴 ბურა</button>
  <button id="modeDominoTab">🁫 დომინო</button>
 </div>

 <div class="grid">

  <div>

   <div id="buraLobbyPanels">

   <div class="panel glass">

    <h2>🎴 ახალი მაგიდა</h2>

    <input
     id="tableName"
     class="field"
     value="Written Bura"
     placeholder="მაგიდის სახელი">

    <div class="stakes">
     <button class="stake on" data-stake="5">$5</button>
     <button class="stake" data-stake="10">$10</button>
     <button class="stake" data-stake="25">$25</button>
     <button class="stake" data-stake="50">$50</button>
     <button class="stake" data-stake="100">$100</button>
    </div>

    <div style="display:flex;gap:8px;margin:12px 0">

     <select
      id="capacity"
      class="field">
      <option value="3">
       3 მოთამაშე
      </option>
      <option
       value="4"
       selected>
       4 მოთამაშე
      </option>
     </select>

     <select
      id="parties"
      class="field">
      <option value="1">1 პარტია</option>
      <option value="2">2 პარტია</option>
      <option value="3">3 პარტია</option>
      <option value="4">4 პარტია</option>
     </select>

    </div>

    <button
     id="createBtn"
     class="primary">
     შექმენი / შედი მაგიდაზე
    </button>

   </div>

   <div
    class="panel glass"
    style="margin-top:15px">

    <h2>🟢 აქტიური მაგიდები</h2>

    <div id="tables"></div>

   </div>

   </div>

   <div id="dominoLobbyPanels" class="hidden">

    <div class="panel glass">

     <h2>🁫 ახალი დომინოს მაგიდა</h2>

     <input
      id="dominoTableName"
      class="field"
      value="Domino Table"
      placeholder="მაგიდის სახელი">

     <div style="display:flex;gap:8px;margin:12px 0">

      <select id="dominoCapacity" class="field">
       <option value="2">2 მოთამაშე</option>
       <option value="3">3 მოთამაშე</option>
       <option value="4" selected>4 მოთამაშე</option>
      </select>

      <select id="dominoRounds" class="field">
       <option value="1" selected>1 რაუნდი</option>
       <option value="2">2 რაუნდი</option>
       <option value="3">3 რაუნდი</option>
       <option value="4">4 რაუნდი</option>
      </select>

     </div>

     <button id="dominoCreateBtn" class="primary">
      შექმენი / შედი მაგიდაზე
     </button>

    </div>

    <div class="panel glass" style="margin-top:15px">
     <h2>🟢 აქტიური დომინოს მაგიდები</h2>
     <div id="dominoTables"></div>
    </div>

   </div>

  </div>

  <div>

   <div class="panel glass">
    <h2>🎯 დღიური დავალებები</h2>
    <div id="quests"></div>
   </div>

   <div
    class="panel glass"
    style="margin-top:15px">

    <h2>🏆 ტურნირები</h2>

    <div id="tournaments"></div>

   </div>

  </div>

 </div>
</section>

<section
 id="game"
 class="hidden">

 <div class="hud">

  <div class="pill">
   🏆 პარტია
   <b id="hudParty">1</b>
  </div>

  <div class="pill">
   🎴 ხელი
   <b id="hudHand">1</b>
  </div>

  <div class="pill">
   ♛ კოზირი
   <b id="hudTrump">♠</b>
  </div>

  <div class="pill">
   🂠 დასტა
   <b id="hudDeck">0</b>
  </div>

  <div class="pill">
   💰 ფსონი
   <b id="hudStake">$5</b>
  </div>

 </div>

 <div class="gameButtons">

  <button
   id="feltBtn"
   class="smallBtn">
   🎨 მაგიდა
  </button>

  <button
   id="rulesBtn"
   class="smallBtn">
   📖 წესები
  </button>

  <button
   id="muteBtn"
   class="smallBtn">
   🔊
  </button>

  <div class="volumeRow smallBtn">
   <input
    id="volumeSlider"
    type="range"
    min="0"
    max="100"
    value="100">
  </div>

 </div>

 <div class="arena">

  <div class="wood">

   <div
    id="table"
    class="table">

    <div class="trump">

     <div class="trumpLabel">
      TRUMP
     </div>

     <div
      id="trumpSymbol"
      class="trumpSymbol">
      ♠
     </div>

    </div>

    <div class="deck"></div>

    <div
     id="centerCards"
     class="centerCards">
    </div>

    <div id="seats"></div>

    <div
     id="hand"
     class="hand">
    </div>

    <div class="actionArea">

     <button
      id="playBtn"
      class="playBtn"
      disabled>
      სვლის გაკეთება
     </button>

     <div
      id="status"
      class="status">
      ...
     </div>

    </div>

   </div>
  </div>

  <aside class="side">

   <div class="score glass">

    <h3>LIVE SCORE</h3>

    <div id="scorePlayers"></div>

    <div id="history"></div>

   </div>

   <div class="reactions glass">

    <button
     data-phrase="სიქიიიიიმ!">
     სიქიიიიიმ!
    </button>

    <button
     data-phrase="ყვერო, მალე!">
     ყვერო, მალე!
    </button>

    <button
     data-phrase="რას შვრები, ძმაო?!">
     რას შვრები, ძმაო?!
    </button>

    <button
     data-phrase="ვაჰ, კოზირი!">
     ვაჰ, კოზირი!
    </button>

   </div>

  </aside>

 </div>
</section>

<section id="dominoGame" class="hidden">

 <div class="dominoHud">
  <div class="pill">🁫 რაუნდი <b id="dHudRound">1</b>/<b id="dHudTotalRounds">1</b></div>
  <div class="pill">🪨 ბანკი <b id="dHudBoneyard">0</b></div>
 </div>

 <div class="arena">
  <div>

   <div class="dominoBoardWrap">
    <div id="dominoSeats" class="dominoSeats"></div>

    <div class="dominoChainScroll">
     <div id="dominoChain" class="dominoChain"></div>
    </div>

    <div id="dominoStatus" class="dominoStatus">...</div>

    <div id="dominoHand" class="dominoHand"></div>
   </div>

   <div id="dominoScorePanel" class="dominoScorePanel"></div>

  </div>
 </div>

</section>

<div
 id="giftMenu"
 class="giftMenu hidden">

 <button data-gift="tomato">
  🍅
 </button>

 <button data-gift="egg">
  🥚
 </button>

 <button data-gift="paper">
  🧻
 </button>

 <button data-gift="bomb">
  💣
 </button>

 <button data-gift="beer">
  🍺
 </button>

 <button data-gift="ice">
  ❄️
 </button>

 <button data-gift="rose">
  🌹
 </button>

</div>

<div
 id="feltMenu"
 class="feltMenu hidden">

 <button
  class="feltSwatch on"
  data-felt="classic"
  style="background:linear-gradient(135deg,#07513a,#052b21)"
  title="კლასიკური მწვანე">
 </button>

 <button
  class="feltSwatch"
  data-felt="royal"
  style="background:linear-gradient(135deg,#123a6b,#0a2242)"
  title="სამეფო ლურჯი">
 </button>

 <button
  class="feltSwatch"
  data-felt="wine"
  style="background:linear-gradient(135deg,#5c1023,#310511)"
  title="შინდისფერი წითელი">
 </button>

 <button
  class="feltSwatch"
  data-felt="violet"
  style="background:linear-gradient(135deg,#3b1f5c,#1c0e33)"
  title="იისფერი">
 </button>

 <button
  class="feltSwatch"
  data-felt="obsidian"
  style="background:linear-gradient(135deg,#242428,#060607)"
  title="შავი / Obsidian">
 </button>

 <button
  class="feltSwatch lockedSwatch"
  data-felt="sunset"
  data-shop="felt_sunset"
  style="background:linear-gradient(135deg,#ff8a3d,#c2185b)"
  title="მზის ჩასვლა (მაღაზია)">
 </button>

 <button
  class="feltSwatch lockedSwatch"
  data-felt="neon"
  data-shop="felt_neon"
  style="background:linear-gradient(135deg,#00e5ff,#ff00e5)"
  title="ნეონი (მაღაზია)">
 </button>

 <button
  class="feltSwatch lockedSwatch"
  data-felt="galaxy"
  data-shop="felt_galaxy"
  style="background:linear-gradient(135deg,#1a0b3d,#3d1a6b,#0b0b2e)"
  title="გალაქტიკა (მაღაზია)">
 </button>

 <button
  class="feltSwatch lockedSwatch"
  data-felt="rosegold"
  data-shop="felt_rosegold"
  style="background:linear-gradient(135deg,#f7c9c0,#b76e79)"
  title="ვარდისფერი ოქრო (მაღაზია)">
 </button>

</div>

<div
 id="rulesModal"
 class="modal hidden">

 <div class="modalBox">

  <button
   id="closeRules"
   class="smallBtn"
   style="float:right">
   ✕
  </button>

  <h2>
   📖 წერითი ბურას წესები
  </h2>

  <div class="rule">
   <b>🃏 დასტა</b><br>
   თამაშში გამოიყენება 36 კარტი:
   6, 7, 8, 9, J, Q, K, 10, A.
   თითოეულ მოთამაშეს ურიგდება 5 კარტი.
  </div>

  <div class="rule">
   <b>💯 ქულები</b><br>
   J=2, Q=3, K=4, 10=10, A=11.
   6–9 არის 0 ქულა.
   ხელში 0 აღებული ქულის შემთხვევაში
   მოთამაშე იღებს -120 ქულას.
  </div>

  <div class="rule">
   <b>✂️ ჭრა</b><br>
   თუ პირველი მოთამაშე ჩამოდის N კარტით,
   პასუხიც ზუსტად N კარტია.
   მაღალი იმავე მასტის კარტი ჭრის დაბალს;
   კოზირი ჭრის არაკოზირს.
   მრავალკარტიან სვლაზე სისტემა
   one-to-one matching-ს იყენებს.
  </div>

  <div class="rule">
   <b>🔥 მალიუტკა</b><br>
   5 ერთნაირი მასტის კარტი არის მალიუტკა.
   მალიუტკის შემდეგ მოთამაშეები ჩამოდიან
   მთელი დარჩენილი ხელით.
  </div>

  <div class="rule">
   <b>💀 გახიშტვა</b><br>
   თუ მოთამაშემ ხელში საერთოდ ვერ აიღო ქულა,
   მისი ხელის ქულაა -120.
  </div>

  <div class="rule">
   <b>🔄 შემდეგი ხელი</b><br>
   პირველ ხელს იწყებს პირველი მოთამაშე.
   შემდეგ ხელს იწყებს წინა ხელში ყველაზე
   დაბალი raw ქულის მქონე მოთამაშის შემდეგ მჯდომი.
  </div>

 </div>
</div>

<div
 id="leaderboardModal"
 class="modal hidden">

 <div class="modalBox">

  <button
   class="smallBtn closeModal"
   data-modal="leaderboardModal"
   style="float:right">
   ✕
  </button>

  <h2>🏆 გლობალური რეიტინგი</h2>

  <div id="leaderboardList"></div>

 </div>
</div>

<div
 id="friendsModal"
 class="modal hidden">

 <div class="modalBox">

  <button
   class="smallBtn closeModal"
   data-modal="friendsModal"
   style="float:right">
   ✕
  </button>

  <h2>👥 მეგობრები</h2>

  <div class="friendAdd">
   <input
    id="friendUsername"
    class="field"
    placeholder="Username">

   <button
    id="addFriendBtn"
    class="primary">
    დამატება
   </button>
  </div>

  <div id="friendsList"></div>

 </div>
</div>

<div
 id="statsModal"
 class="modal hidden">

 <div class="modalBox">

  <button
   class="smallBtn closeModal"
   data-modal="statsModal"
   style="float:right">
   ✕
  </button>

  <h2>📊 სტატისტიკა</h2>

  <div id="statGrid" class="statGrid"></div>

  <h3 style="margin-top:18px">ბოლო პარტიები</h3>

  <div id="sparkRow" class="sparkRow"></div>

  <div id="fairnessLog" class="fairBox"></div>

 </div>
</div>

<div
 id="shopModal"
 class="modal hidden">

 <div class="modalBox">

  <button
   class="smallBtn closeModal"
   data-modal="shopModal"
   style="float:right">
   ✕
  </button>

  <h2>🛍️ მაღაზია</h2>

  <p style="color:#9eb1aa">
   მხოლოდ კოსმეტიკური ნივთები · მონეტები არ იყიდება რეალურ ფულში
  </p>

  <div id="shopGrid" class="shopGrid"></div>

 </div>
</div>

<div
 id="infoModal"
 class="modal hidden">

 <div class="modalBox">

  <button
   class="smallBtn closeModal"
   data-modal="infoModal"
   style="float:right">
   ✕
  </button>

  <h2>ℹ️ წესები, კონფიდენციალურობა და პასუხისმგებლიანი თამაში</h2>

  <div class="rule">
   <b>18+</b><br>
   ეს პლატფორმა განკუთვნილია მხოლოდ 18 წლის და უფროსი ასაკის მომხმარებლებისთვის.
   ბალანსი ვირტუალურია და არ გაიცვლება რეალურ ფულში.
  </div>

  <div class="rule">
   <b>წესები და პირობები</b><br>
   რეგისტრაციით თანხმდები, რომ თამაშობ სამართლიანად, არ იყენებ ბოტებს/ავტომატიზაციას
   და პატივს სცემ სხვა მოთამაშეებს.
  </div>

  <div class="rule">
   <b>კონფიდენციალურობა</b><br>
   ვინახავთ მხოლოდ საჭირო მონაცემებს (username, პროფილის სტატისტიკა).
   პაროლები ინახება დაჰეშილი სახით და არასდროს ჩანს ღიად.
  </div>

  <div class="rule">
   <b>🛡 პასუხისმგებლიანი თამაში</b><br>
   თუ გრძნობ, რომ თამაში მეტისმეტ დროს/ყურადღებას გართმევს, გამოიყენე
   პაუზის ვარიანტები ქვემოთ. ეს დაუყოვნებლივ დაბლოკავს შენს შესვლას
   არჩეული პერიოდით.

   <div class="exclusionOptions">
    <button class="smallBtn selfExcludeBtn" data-duration="24h">⏸ 24 საათი</button>
    <button class="smallBtn selfExcludeBtn" data-duration="7d">⏸ 7 დღე</button>
    <button class="smallBtn selfExcludeBtn" data-duration="30d">⏸ 30 დღე</button>
    <button class="smallBtn selfExcludeBtn" data-duration="forever">⛔ სამუდამოდ</button>
   </div>
  </div>

 </div>
</div>

<canvas id="confettiCanvas" class="hidden"></canvas>

<script src="/socket.io/socket.io.js"></script>

<script>
(function () {
'use strict';

var socket = io();

var current = null;
var profile = null;

var selected = [];

var authMode = 'login';
var chosenAvatar = '🦊';

var stake = 5;

var giftTarget = null;

var muted = false;
var volume = 1;
var audio = null;

var pendingInvite = null;
var currentLang = 'ka';

var touchStart = {};

function el(id) {
 return document.getElementById(id);
}

function esc(value) {
 var div =
  document.createElement('div');

 div.textContent =
  String(
   value == null
    ? ''
    : value
  );

 return div.innerHTML;
}

function symbol(suit) {
 return {
  spades:'♠',
  hearts:'♥',
  diamonds:'♦',
  clubs:'♣',
  no_trump:'★'
 }[suit] || '★';
}

function suitClass(suit) {
 return suit || 'spades';
}

function show(id) {
 el(id).classList.remove(
  'hidden'
 );
}

function hide(id) {
 el(id).classList.add(
  'hidden'
 );
}

function setAvatar(node, value) {
 node.innerHTML = '';

 if (
  String(value || '')
   .indexOf(
    'data:image/'
   ) === 0
 ) {
  var img =
   document.createElement(
    'img'
   );

  img.src = value;

  node.appendChild(img);
 } else {
  node.textContent =
   value || '🦊';
 }
}

/* ============================================================
   AUDIO
   ============================================================ */

function initAudio() {
 if (audio) {
  return;
 }

 var AudioContextClass =
  window.AudioContext ||
  window.webkitAudioContext;

 if (AudioContextClass) {
  audio =
   new AudioContextClass();
 }
}

document.addEventListener(
 'pointerdown',
 function () {
  initAudio();

  if (
   audio &&
   audio.state ===
    'suspended'
  ) {
   audio.resume();
  }
 },
 { once:true }
);

function tone(
 freq,
 duration,
 type,
 vol,
 delay
) {
 if (
  muted ||
  volume <= 0
 ) {
  return;
 }

 initAudio();

 if (!audio) {
  return;
 }

 var oscillator =
  audio.createOscillator();

 var gain =
  audio.createGain();

 var time =
  audio.currentTime +
  (delay || 0);

 oscillator.type =
  type || 'sine';

 oscillator.frequency
  .setValueAtTime(
   freq,
   time
  );

 gain.gain
  .setValueAtTime(
   (vol || .04) * volume,
   time
  );

 gain.gain
  .exponentialRampToValueAtTime(
   .001,
   time + duration
  );

 oscillator.connect(gain);
 gain.connect(audio.destination);

 oscillator.start(time);

 oscillator.stop(
  time + duration
 );
}

function sfx(type) {
 if (type === 'deal') {
  tone(
   500,.05,
   'triangle',
   .025
  );

  tone(
   650,.05,
   'triangle',
   .02,.07
  );
 }

 if (type === 'place') {
  tone(
   150,.07,
   'triangle',
   .06
  );
 }

 if (type === 'cut') {
  tone(
   900,.08,
   'sawtooth',
   .05
  );

  tone(
   250,.12,
   'triangle',
   .04,.05
  );
 }

 if (type === 'win') {
  tone(
   523,.12,
   'triangle',
   .05
  );

  tone(
   659,.12,
   'triangle',
   .05,.12
  );

  tone(
   784,.25,
   'triangle',
   .05,.24
  );
 }

 if (type === 'lose') {
  tone(
   300,.18,
   'sine',
   .04
  );

  tone(
   220,.3,
   'sine',
   .04,.16
  );
 }
}

function speak(text) {
 if (
  muted ||
  volume <= 0
 ) {
  return;
 }

 if (
  'speechSynthesis'
  in window
 ) {
  try {
   var utterance =
    new SpeechSynthesisUtterance(
     text
    );

   utterance.volume =
    volume;

   utterance.lang =
    'ka-GE';

   utterance.rate =
    1.03;

   utterance.pitch =
    .92;

   var voices =
    speechSynthesis
     .getVoices();

   var georgian =
    voices.find(
     function (voice) {
      return String(
       voice.lang
      )
       .toLowerCase()
       .indexOf('ka') === 0;
     }
    );

   if (georgian) {
    utterance.voice =
     georgian;
   }

   speechSynthesis.cancel();

   speechSynthesis.speak(
    utterance
   );

   if (!georgian) {
    tone(
     520,.08,
     'square',
     .025
    );

    tone(
     690,.1,
     'triangle',
     .02,.1
    );
   }

   return;
  } catch (error) {}
 }

 tone(
  520,.08,
  'square',
  .025
 );

 tone(
  690,.1,
  'triangle',
  .02,.1
 );
}

/* ============================================================
   AUTH UI
   ============================================================ */

el('loginTab').onclick =
 function () {
  authMode = 'login';

  this.classList.add(
   'active'
  );

  el('registerTab')
   .classList.remove(
    'active'
   );

  hide('avatarBox');

  el('authBtn')
   .textContent =
    'შესვლა';
 };

el('registerTab').onclick =
 function () {
  authMode = 'register';

  this.classList.add(
   'active'
  );

  el('loginTab')
   .classList.remove(
    'active'
   );

  show('avatarBox');

  el('authBtn')
   .textContent =
    'რეგისტრაცია';
 };

document
 .querySelectorAll(
  '.avatarChoice'
 )
 .forEach(
  function (button) {
   button.onclick =
    function () {
     document
      .querySelectorAll(
       '.avatarChoice'
      )
      .forEach(
       function (item) {
        item.classList.remove(
         'on'
        );
       }
      );

     button.classList.add(
      'on'
     );

     chosenAvatar =
      button.textContent;
    };
  }
 );

el('avatarFile').onchange =
 function () {
  var file =
   this.files &&
   this.files[0];

  if (!file) {
   return;
  }

  if (
   file.size > 500000
  ) {
   el('authError')
    .textContent =
     'ავატარი მაქსიმუმ 500KB.';

   return;
  }

  var reader =
   new FileReader();

  reader.onload =
   function () {
    chosenAvatar =
     reader.result;
   };

  reader.readAsDataURL(
   file
  );
 };

el('authBtn').onclick =
 function () {
  el('authError')
   .textContent = '';

  var data = {
   username:
    el('username').value,

   password:
    el('password').value,

   avatar:
    chosenAvatar
  };

  socket.emit(
   authMode,
   data
  );
 };

el('testerBtn').onclick =
 function () {
  socket.emit(
   'testerLogin'
  );
 };

/* ============================================================
   AUTH SOCKETS
   ============================================================ */

socket.on(
 'authSuccess',
 function (data) {
  profile =
   data.profile;

  if (data.token) {
   localStorage.setItem(
    'buraToken',
    data.token
   );
  }

  hide('auth');
  show('lobby');

  renderProfile();

  if (
   data.streakBonus &&
   data.streakBonus > 0
  ) {
   streakToast(
    data.loginStreak,
    data.streakBonus
   );
  }

  if (pendingInvite) {
   var invite = pendingInvite;
   pendingInvite = null;

   socket.emit(
    'joinTable',
    { roomId:invite }
   );
  }
 }
);

socket.on(
 'authError',
 function (message) {
  el('authError')
   .textContent =
    message;
 }
);

socket.on(
 'sessionInvalid',
 function () {
  localStorage.removeItem(
   'buraToken'
  );
 }
);

socket.on(
 'sessionRecovered',
 function () {
  toast(
   '🔄 თამაში აღდგენილია'
  );
 }
);

/* ============================================================
   PROFILE
   ============================================================ */

function frameClass(value) {
 if (
  !value ||
  value === 'none'
 ) {
  return '';
 }

 return 'frame-' + value;
}

function renderProfile() {
 if (!profile) {
  return;
 }

 el('profileName')
  .textContent =
   profile.username;

 setAvatar(
  el('profileAvatar'),
  profile.avatar
 );

 el('profileAvatar')
  .className =
   'profileAvatar ' +
   frameClass(
    profile.equipped &&
    profile.equipped.frame
   );

 el('profileLevel')
  .textContent =
   'LVL ' +
   profile.level;

 if (profile.rank) {
  el('profileRank')
   .textContent =
    profile.rank.icon +
    ' ' +
    profile.rank.name +
    ' (' +
    profile.rating +
    ')';
 }

 el('profileXp')
  .textContent =
   profile.xp +
   ' XP';

 el('profileCoins')
  .textContent =
   '🪙 ' +
   (profile.coins || 0);

 renderQuests();

 if (
  typeof refreshFeltLocks ===
  'function'
 ) {
  refreshFeltLocks();
 }

 if (
  profile.equipped &&
  profile.equipped.felt &&
  typeof applyFelt === 'function'
 ) {
  applyFelt(
   profile.equipped.felt
  );
 }
}

socket.on(
 'profileUpdate',
 function (newProfile) {
  profile =
   newProfile;

  renderProfile();
 }
);

function streakToast(streak, bonus) {
 var node =
  document.createElement(
   'div'
  );

 node.className =
  'streakToast';

 node.innerHTML =
  '🔥 <b>' +
  streak +
  ' დღიანი სერია!</b><br>' +
  '+' +
  bonus +
  ' 🪙 მონეტა';

 document.body.appendChild(
  node
 );

 setTimeout(
  function () {
   node.remove();
  },
  3500
 );
}

function renderQuests() {
 if (!profile) {
  return;
 }

 var quest =
  profile.quests || {};

 var items = [
  [
   'მოიგე 3 პარტია',
   quest.wins || 0,
   3,
   '+100 XP'
  ],
  [
   'ჩადი მალიუტკა 1-ხელ',
   quest.maliutka || 0,
   1,
   '+250 XP'
  ],
  [
   'ითამაშე 5 მაგიდაზე',
   quest.tables || 0,
   5,
   '+50 XP'
  ]
 ];

 el('quests').innerHTML =
  items.map(
   function (item) {
    var percent =
     Math.min(
      100,
      (
       item[1] /
       item[2]
      ) * 100
     );

    return (
     '<div class="quest">' +
      '<b>' +
       esc(item[0]) +
      '</b> · ' +
      item[3] +
      '<br>' +
      '<small>' +
       item[1] +
       '/' +
       item[2] +
      '</small>' +
      '<div class="progress">' +
       '<i style="width:' +
        percent +
        '%"></i>' +
      '</div>' +
     '</div>'
    );
   }
  ).join('');
}

/* ============================================================
   STAKES
   ============================================================ */

document
 .querySelectorAll(
  '.stake'
 )
 .forEach(
  function (button) {
   button.onclick =
    function () {
     document
      .querySelectorAll(
       '.stake'
      )
      .forEach(
       function (item) {
        item.classList.remove(
         'on'
        );
       }
      );

     button.classList.add(
      'on'
     );

     stake =
      Number(
       button.dataset.stake
      );
    };
  }
 );

/* ============================================================
   CREATE TABLE
   ============================================================ */

el('createBtn').onclick =
 function () {
  socket.emit(
   'joinTable',
   {
    tableName:
     el('tableName')
      .value,

    capacity:
     Number(
      el('capacity')
       .value
     ),

    parties:
     Number(
      el('parties')
       .value
     ),

    stake:
     stake
   }
  );
 };

/* ============================================================
   LOBBY
   ============================================================ */

socket.on(
 'lobbyTables',
 function (list) {
  if (!list.length) {
   el('tables').innerHTML =
    '<p style="color:#91a49d">' +
    'ღია მაგიდები ჯერ არ არის.' +
    '</p>';

   return;
  }

  el('tables').innerHTML =
   list.map(
    function (table) {
     return (
      '<div class="tableRow">' +
       '<div>' +
        '<b>' +
         esc(table.name) +
        '</b>' +
        '<br>' +
        '<small>' +
         '$' +
         table.stake +
         ' · ' +
         table.players +
         '/' +
         table.capacity +
         ' · ' +
         table.parties +
         ' პარტია' +
        '</small>' +
       '</div>' +

       '<button ' +
        'class="primary joinRoom" ' +
        'data-id="' +
        esc(table.id) +
        '">' +
        'შეერთება' +
       '</button>' +
      '</div>'
     );
    }
   ).join('');

  document
   .querySelectorAll(
    '.joinRoom'
   )
   .forEach(
    function (button) {
     button.onclick =
      function () {
       socket.emit(
        'joinTable',
        {
         roomId:
          button.dataset.id
        }
       );
      };
    }
   );
 }
);

socket.on(
 'waitingForPlayers',
 function (data) {
  toast(
   'ველოდებით მოთამაშეებს ' +
   data.current +
   '/' +
   data.max
  );
 }
);

/* ============================================================
   TOURNAMENT
   ============================================================ */

socket.on(
 'tournaments',
 function (list) {
  el('tournaments').innerHTML =
   list.map(
    function (tournament) {
     return (
      '<div class="tourRow">' +
       '<div>' +
        '<b>' +
         esc(tournament.name) +
        '</b>' +
        '<br>' +
        '<small>' +
         esc(tournament.prize) +
         ' · ' +
         tournament.registered +
         '/' +
         tournament.maxPlayers +
        '</small>' +
        '<br>' +
        '<small ' +
         'class="countdown" ' +
         'data-time="' +
         tournament.startAt +
         '">' +
        '</small>' +
       '</div>' +

       '<button ' +
        'class="smallBtn regTour" ' +
        'data-id="' +
        esc(tournament.id) +
        '">' +
        'რეგისტრაცია' +
       '</button>' +
      '</div>'
     );
    }
   ).join('');

  document
   .querySelectorAll(
    '.regTour'
   )
   .forEach(
    function (button) {
     button.onclick =
      function () {
       socket.emit(
        'registerTournament',
        {
         id:
          button.dataset.id
        }
       );
      };
    }
   );
 }
);

setInterval(
 function () {
  document
   .querySelectorAll(
    '.countdown'
   )
   .forEach(
    function (node) {
     var milliseconds =
      Math.max(
       0,
       Number(
        node.dataset.time
       ) -
       Date.now()
      );

     var hours =
      Math.floor(
       milliseconds /
       3600000
      );

     var minutes =
      Math.floor(
       (
        milliseconds %
        3600000
       ) /
       60000
      );

     var seconds =
      Math.floor(
       (
        milliseconds %
        60000
       ) /
       1000
      );

     node.textContent =
      'დაწყებამდე ' +
      hours +
      'სთ ' +
      minutes +
      'წთ ' +
      seconds +
      'წმ';
    }
   );
 },
 1000
);

/* ============================================================
   GAME STATE
   ============================================================ */

socket.on(
 'gameStateUpdate',
 function (state) {
  current = state;
  selected = [];

  hide('auth');
  hide('lobby');
  hide('dominoGame');
  show('game');

  render();
 }
);

function render() {
 if (!current) {
  return;
 }

 el('hudParty')
  .textContent =
   current.partyIndex;

 el('hudHand')
  .textContent =
   current.handIndex +
   '/' +
   current.totalHands;

 el('hudTrump')
  .textContent =
   symbol(
    current.trump
   );

 el('hudDeck')
  .textContent =
   current.deckCount;

 el('hudStake')
  .textContent =
   '$' +
   current.stake;

 var trumpNode =
  el('trumpSymbol');

 trumpNode.textContent =
  symbol(
   current.trump
  );

 if (
  current.trump ===
  'hearts'
 ) {
  trumpNode.style.color =
   '#e63946';
 } else if (
  current.trump ===
  'diamonds'
 ) {
  trumpNode.style.color =
   '#0077b6';
 } else if (
  current.trump ===
  'clubs'
 ) {
  trumpNode.style.color =
   '#2a9d8f';
 } else {
  trumpNode.style.color =
   '#111111';
 }

 renderSeats();
 renderCenter();
 renderHand();
 renderScore();
 updateAction();
}

/* ============================================================
   SEATS
   ============================================================ */

function seatClass(
 index,
 total
) {
 var myIndex =
  current.players
   .findIndex(
    function (player) {
     return (
      player.id ===
      current.viewerId
     );
    }
   );

 var relative =
  (
   index -
   myIndex +
   total
  ) % total;

 if (relative === 0) {
  return 'me';
 }

 if (total === 3) {
  return (
   relative === 1
    ? 'leftSeat'
    : 'rightSeat'
  );
 }

 if (relative === 1) {
  return 'leftSeat';
 }

 if (relative === 2) {
  return 'topSeat';
 }

 return 'rightSeat';
}

function renderSeats() {
 var container =
  el('seats');

 container.innerHTML = '';

 current.players.forEach(
  function (player, index) {
   var seat =
    document.createElement(
     'div'
    );

   seat.className =
    'seat ' +
    seatClass(
     index,
     current.players.length
    ) +
    (
     player.isCurrent
      ? ' active'
      : ''
    );

   seat.dataset.player =
    player.id;

   var avatarWrap =
    document.createElement(
     'div'
    );

   avatarWrap.className =
    'avatarWrap';

   var avatar =
    document.createElement(
     'div'
    );

   avatar.className =
    'avatar ' +
    frameClass(
     player.frame
    );

   setAvatar(
    avatar,
    player.avatar
   );

   avatarWrap.appendChild(
    avatar
   );

   var timerRing =
    document.createElement(
     'div'
    );

   timerRing.className =
    'timerRing';

   avatarWrap.appendChild(
    timerRing
   );

   var level =
    document.createElement(
     'div'
    );

   level.className =
    'levelBadge';

   level.textContent =
    'L' +
    player.level;

   avatarWrap.appendChild(
    level
   );

   seat.appendChild(
    avatarWrap
   );

   var name =
    document.createElement(
     'div'
    );

   name.className =
    'seatName';

   name.textContent =
    player.name;

   seat.appendChild(
    name
   );

   var meta =
    document.createElement(
     'div'
    );

   meta.className =
    'seatMeta';

   meta.textContent =
    player.cardCount +
    ' კარტი · ' +
    player.totalPoints;

   seat.appendChild(
    meta
   );

   if (
    player.id !==
    current.viewerId
   ) {
    avatar.onclick =
     function (event) {
      giftTarget =
       player.id;

      var menu =
       el('giftMenu');

      menu.style.left =
       Math.min(
        window.innerWidth - 180,
        event.clientX
       ) +
       'px';

      menu.style.top =
       Math.min(
        window.innerHeight - 80,
        event.clientY
       ) +
       'px';

      show('giftMenu');
     };
   }

   container.appendChild(
    seat
   );
  }
 );
}

/* ============================================================
   CARDS
   ============================================================ */

function cardNode(
 card,
 index,
 own
) {
 var node =
  document.createElement(
   'div'
  );

 node.className =
  'card ' +
  suitClass(
   card.suit
  );

 node.innerHTML =
  '<div class="rank">' +
   esc(card.rank) +
  '</div>' +
  '<div class="suit">' +
   symbol(card.suit) +
  '</div>';

 if (own) {
  node.dataset.index =
   index;

  if (
   selected.includes(
    index
   )
  ) {
   node.classList.add(
    'selected'
   );
  }

  node.onclick =
   function () {
    toggle(index);
   };

  node.addEventListener(
   'touchstart',
   function (event) {
    touchStart[index] =
     event.touches[0]
      .clientY;
   },
   { passive:true }
  );

  node.addEventListener(
   'touchend',
   function (event) {
    var start =
     touchStart[index];

    var end =
     event.changedTouches[0]
      .clientY;

    if (
     start - end > 30
    ) {
     toggle(index);
    }
   },
   { passive:true }
  );
 }

 return node;
}

function renderCenter() {
 var container =
  el('centerCards');

 container.innerHTML = '';

 current.table.forEach(
  function (played) {
   var group =
    document.createElement(
     'div'
    );

   group.className =
    'playGroup';

   played.cards.forEach(
    function (card) {
     var node =
      cardNode(
       card,
       0,
       false
      );

     if (
      played.isWinning
     ) {
      node.classList.add(
       'cutGlow'
      );

      node.classList.add(
       'winnerGlow'
      );
     }

     group.appendChild(
      node
     );
    }
   );

   container.appendChild(
    group
   );
  }
 );
}

function myHand() {
 if (!current) {
  return [];
 }

 return (
  current.playersCards[
   current.viewerId
  ] || []
 );
}

function renderHand() {
 var handNode =
  el('hand');

 handNode.innerHTML = '';

 var cards =
  myHand();

 cards.forEach(
  function (card, index) {
   var node =
    cardNode(
     card,
     index,
     true
    );

   var middle =
    (
     cards.length - 1
    ) / 2;

   node.style.transform =
    'rotate(' +
    (
     (index - middle) *
     5
    ) +
    'deg) ' +
    'translateY(' +
    (
     Math.abs(
      index - middle
     ) * 2
    ) +
    'px)';

   handNode.appendChild(
    node
   );
  }
 );
}

/* ============================================================
   SELECTION
   ============================================================ */

function toggle(index) {
 if (!current) {
  return;
 }

 var myIndex =
  current.players
   .findIndex(
    function (player) {
     return (
      player.id ===
      current.viewerId
     );
    }
   );

 if (
  myIndex !==
  current.currentTurnIndex
 ) {
  return;
 }

 var position =
  selected.indexOf(
   index
  );

 if (position >= 0) {
  selected.splice(
   position,
   1
  );
 } else if (
  selected.length < 5
 ) {
  selected.push(
   index
  );
 }

 renderHand();
 updateAction();

 sfx('place');
}

function selectionValid() {
 if (
  !current ||
  !selected.length
 ) {
  return false;
 }

 var hand =
  myHand();

 var cards =
  selected
   .map(
    function (index) {
     return hand[index];
    }
   )
   .filter(Boolean);

 if (
  cards.length !==
  selected.length
 ) {
  return false;
 }

 /*
   Leader.
 */

 if (
  !current.table.length
 ) {
  return (
   cards.length <= 5 &&
   cards.every(
    function (card) {
     return (
      card.suit ===
      cards[0].suit
     );
    }
   )
  );
 }

 /*
   Maliutka.
 */

 if (
  current.leadWasMaliutka
 ) {
  return (
   cards.length ===
   hand.length
  );
 }

 /*
   Normal response.
 */

 if (
  cards.length !==
  current.leadCount
 ) {
  return false;
 }

 if (
  current.leadCount > 1
 ) {
  var counts = {};

  hand.forEach(
   function (card) {
    counts[card.suit] =
     (
      counts[card.suit] ||
      0
     ) + 1;
   }
  );

  var possible =
   Object
    .keys(counts)
    .some(
     function (suit) {
      return (
       counts[suit] >=
       current.leadCount
      );
     }
    );

  if (
   possible &&
   !cards.every(
    function (card) {
     return (
      card.suit ===
      cards[0].suit
     );
    }
   )
  ) {
   return false;
  }
 }

 return true;
}

function updateAction() {
 if (!current) {
  return;
 }

 var myIndex =
  current.players
   .findIndex(
    function (player) {
     return (
      player.id ===
      current.viewerId
     );
    }
   );

 var myTurn =
  myIndex ===
   current.currentTurnIndex &&
  !current.processing &&
  !current.gameOver;

 var valid =
  myTurn &&
  selectionValid();

 var button =
  el('playBtn');

 button.disabled =
  !valid;

 button.classList.toggle(
  'ready',
  valid
 );

 if (
  selected.length === 5 &&
  myHand().length === 5
 ) {
  var cards =
   selected.map(
    function (index) {
     return myHand()[index];
    }
   );

  if (
   cards.length === 5 &&
   cards.every(
    function (card) {
     return (
      card.suit ===
      cards[0].suit
     );
    }
   )
  ) {
   button.textContent =
    '🔥 ჩადი მალიუტკა!';
  } else {
   button.textContent =
    'ჩადი 5 კარტი';
  }
 } else if (
  selected.length
 ) {
  button.textContent =
   'ჩადი ' +
   selected.length +
   ' კარტი';
 } else {
  button.textContent =
   'სვლის გაკეთება';
 }

 if (
  current.gameOver
 ) {
  el('status')
   .textContent =
    'თამაში დასრულდა';
 } else if (myTurn) {
  el('status')
   .textContent =
    'შენი სვლაა';
 } else {
  el('status')
   .textContent =
    'მოწინააღმდეგის სვლა...';
 }
}

el('playBtn').onclick =
 function () {
  if (
   !selectionValid()
  ) {
   return;
  }

  socket.emit(
   'playCards',
   {
    cardIndices:
     selected.slice()
   }
  );

  selected = [];
 };

/* ============================================================
   SCORE
   ============================================================ */

function renderScore() {
 var bestTotal =
  current.players.length
   ? Math.max.apply(
      null,
      current.players.map(
       function (player) {
        return player.totalPoints;
       }
      )
     )
   : 0;

 var ranked =
  current.players
   .slice()
   .sort(
    function (a, b) {
     return (
      b.totalPoints -
      a.totalPoints
     );
    }
   );

 el('scorePlayers').innerHTML =
  ranked.map(
   function (player) {
    var isLeader =
     player.totalPoints ===
      bestTotal &&
     current.players.length > 1;

    return (
     '<div class="scorePlayer' +
      (
       isLeader
        ? ' leader'
        : ''
      ) +
      '">' +
      '<span class="scoreName">' +
       (
        isLeader
         ? '👑 '
         : ''
       ) +
       esc(player.name) +
      '</span>' +
      '<span class="total' +
       (
        player.totalPoints < 0
         ? ' negative'
         : ''
       ) +
       '">' +
       player.totalPoints +
      '</span>' +
     '</div>'
    );
   }
  ).join('');

 el('history').innerHTML =
  current.history
   .slice()
   .reverse()
   .map(
    function (history) {
     var raws =
      current.players
       .map(
        function (player) {
         var raw =
          history.rawScores &&
          history.rawScores[
           player.id
          ] != null
           ? history.rawScores[
              player.id
             ]
           : 0;

         return (
          '<span' +
          (
           raw === 0
            ? ' class="zero"'
            : ''
          ) +
          '>' +
          esc(player.name) +
          ': ' +
          raw +
          'pt' +
          (
           raw === 0
            ? ' (-120)'
            : ''
          ) +
          '</span>'
         );
        }
       )
       .join('');

     return (
      '<div class="historyItem">' +
       '<b>პარტია ' +
       history.party +
       ' · ხელი ' +
       history.hand +
       '</b> (' +
       symbol(
        history.trump
       ) +
       ')' +
       '<div class="historyRaw">' +
       raws +
       '</div>' +
      '</div>'
     );
    }
   )
   .join('');
}

/* ============================================================
   RULES / MUTE
   ============================================================ */

el('rulesBtn').onclick =
 function () {
  show('rulesModal');
 };

el('closeRules').onclick =
 function () {
  hide('rulesModal');
 };

el('rulesModal').onclick =
 function (event) {
  if (
   event.target === this
  ) {
   hide('rulesModal');
  }
 };

el('muteBtn').onclick =
 function () {
  muted = !muted;

  this.textContent =
   muted
    ? '🔇'
    : '🔊';
 };

el('volumeSlider').oninput =
 function () {
  volume =
   Number(this.value) / 100;

  muted =
   volume <= 0;

  el('muteBtn')
   .textContent =
    muted
     ? '🔇'
     : '🔊';

  try {
   localStorage.setItem(
    'buraVolume',
    this.value
   );
  } catch (error) {}
 };

try {
 var savedVolume =
  localStorage.getItem(
   'buraVolume'
  );

 if (savedVolume !== null) {
  el('volumeSlider').value =
   savedVolume;

  volume =
   Number(savedVolume) / 100;

  muted = volume <= 0;
 }
} catch (error) {}

/* ============================================================
   FELT PICKER
   ============================================================ */

function applyFelt(value) {
 var wood =
  document.querySelector(
   '.wood'
  );

 if (wood) {
  wood.dataset.felt =
   value;
 }

 document
  .querySelectorAll(
   '.feltSwatch'
  )
  .forEach(
   function (button) {
    button.classList.toggle(
     'on',
     button.dataset.felt ===
      value
    );
   }
  );
}

el('feltBtn').onclick =
 function (event) {
  var menu =
   el('feltMenu');

  if (
   menu.classList.contains(
    'hidden'
   )
  ) {
   var rect =
    this.getBoundingClientRect();

   menu.style.left =
    Math.min(
     window.innerWidth - 220,
     rect.left
    ) +
    'px';

   menu.style.top =
    (
     rect.bottom + 8
    ) +
    'px';

   show('feltMenu');
  } else {
   hide('feltMenu');
  }
 };

function refreshFeltLocks() {
 if (!profile) {
  return;
 }

 var owned =
  (profile.inventory &&
   profile.inventory.felts) ||
  [];

 document
  .querySelectorAll(
   '.feltSwatch'
  )
  .forEach(
   function (button) {
    var isFree =
     !button.dataset.shop;

    var isOwned =
     isFree ||
     owned.indexOf(
      button.dataset.felt
     ) >= 0;

    button.classList.toggle(
     'lockedSwatch',
     !isOwned
    );
   }
  );
}

document
 .querySelectorAll(
  '.feltSwatch'
 )
 .forEach(
  function (button) {
   button.onclick =
    function () {
     var value =
      button.dataset.felt;

     var owned =
      !profile ||
      !button.classList.contains(
       'lockedSwatch'
      );

     if (!owned) {
      hide('feltMenu');

      toast(
       '🔒 ეს ფერი მაღაზიაშია — გახსენი 🛍️ მაღაზია'
      );

      renderShop();
      openModal('shopModal');

      return;
     }

     applyFelt(value);

     try {
      localStorage.setItem(
       'buraFelt',
       value
      );
     } catch (error) {}

     if (profile) {
      socket.emit(
       'equipCosmetic',
       {
        slot:'felt',
        value:value
       }
      );
     }

     hide('feltMenu');
    };
  }
 );

document.addEventListener(
 'click',
 function (event) {
  if (
   !event.target.closest(
    '#feltBtn'
   ) &&
   !event.target.closest(
    '#feltMenu'
   )
  ) {
   hide('feltMenu');
  }
 }
);

try {
 var savedFelt =
  localStorage.getItem(
   'buraFelt'
  );

 if (savedFelt) {
  applyFelt(savedFelt);
 }
} catch (error) {}

/* ============================================================
   REACTIONS
   ============================================================ */

document
 .querySelectorAll(
  '[data-phrase]'
 )
 .forEach(
  function (button) {
   button.onclick =
    function () {
     var text =
      button.dataset.phrase;

     socket.emit(
      'quickMessage',
      {
       text:text
      }
     );

     speak(text);
    };
  }
 );

socket.on(
 'quickMessage',
 function (data) {
  toast(data.text);
  speak(data.text);
 }
);

/* ============================================================
   THROWABLES
   ============================================================ */

document
 .querySelectorAll(
  '[data-gift]'
 )
 .forEach(
  function (button) {
   button.onclick =
    function () {
     if (giftTarget) {
      socket.emit(
       'throwable',
       {
        targetPlayerId:
         giftTarget,

        type:
         button.dataset.gift
       }
      );
     }

     hide('giftMenu');
    };
  }
 );

document.addEventListener(
 'click',
 function (event) {
  if (
   !event.target.closest(
    '.avatar'
   ) &&
   !event.target.closest(
    '#giftMenu'
   )
  ) {
   hide('giftMenu');
  }
 }
);

socket.on(
 'throwableEvent',
 function (data) {
  animateThrowable(data);
 }
);

function seatAvatar(playerId) {
 var selector =
  '.seat[data-player="' +
  String(playerId)
   .replace(/"/g, '\\"') +
  '"] .avatar';

 return document
  .querySelector(
   selector
  );
}

function animateThrowable(data) {
 var from =
  seatAvatar(
   data.fromPlayerId
  );

 var to =
  seatAvatar(
   data.targetPlayerId
  );

 if (
  !from ||
  !to
 ) {
  return;
 }

 var start =
  from.getBoundingClientRect();

 var end =
  to.getBoundingClientRect();

 var icons = {
  tomato:'🍅',
  egg:'🥚',
  paper:'🧻',
  bomb:'💣',
  beer:'🍺',
  ice:'❄️',
  rose:'🌹'
 };

 var projectile =
  document.createElement(
   'div'
  );

 projectile.className =
  'projectile';

 projectile.textContent =
  icons[data.type] ||
  '🍅';

 projectile.style.left =
  (
   start.left +
   start.width / 2
  ) +
  'px';

 projectile.style.top =
  (
   start.top +
   start.height / 2
  ) +
  'px';

 document.body.appendChild(
  projectile
 );

 var dx =
  end.left -
  start.left;

 var dy =
  end.top -
  start.top;

 requestAnimationFrame(
  function () {
   projectile.style.transform =
    'translate3d(' +
    dx +
    'px,' +
    (dy - 50) +
    'px,0) rotate(360deg)';

   setTimeout(
    function () {
     projectile.style.transition =
      'transform .18s ease-in';

     projectile.style.transform =
      'translate3d(' +
      dx +
      'px,' +
      dy +
      'px,0) rotate(450deg)';
    },
    520
   );
  }
 );

 setTimeout(
  function () {
   projectile.remove();

   var splat =
    document.createElement(
     'div'
    );

   splat.className =
    'splat';

   var splatIcons = {
    tomato:'💥🍅',
    egg:'🍳',
    paper:'🧻',
    bomb:'💥',
    beer:'🍻',
    ice:'🧊',
    rose:'🌹'
   };

   splat.textContent =
    splatIcons[data.type] ||
    '💥';

   to.parentElement
    .appendChild(
     splat
    );

   if (data.type === 'bomb') {
    tone(
     90,.22,
     'sawtooth',
     .07
    );

    tone(
     55,.3,
     'square',
     .05,.05
    );
   } else if (
    data.type === 'ice'
   ) {
    tone(
     1200,.08,
     'sine',
     .04
    );

    tone(
     1500,.08,
     'sine',
     .03,.06
    );
   } else if (
    data.type === 'beer'
   ) {
    tone(
     180,.14,
     'triangle',
     .05
    );
   } else if (
    data.type === 'rose'
   ) {
    tone(
     700,.14,
     'sine',
     .04
    );

    tone(
     880,.16,
     'sine',
     .03,.08
    );
   } else {
    tone(
     data.type === 'egg'
      ? 230
      : 150,
     .12,
     'triangle',
     .05
    );
   }

   setTimeout(
    function () {
     splat.remove();
    },
    3000
   );
  },
  720
 );
}

/* ============================================================
   GAME FX
   ============================================================ */

socket.on(
 'dealAnimation',
 function () {
  sfx('deal');
 }
);

socket.on(
 'playFX',
 function (data) {
  sfx(
   data.cuts
    ? 'cut'
    : 'place'
  );

  if (data.cuts) {
   var table =
    el('table');

   table.style.filter =
    'brightness(1.3)';

   setTimeout(
    function () {
     table.style.filter = '';
    },
    150
   );
  }
 }
);

socket.on(
 'trickWon',
 function () {
  sfx('cut');
 }
);

socket.on(
 'botThinking',
 function (data) {
  el('status')
   .textContent =
    data.text ||
    '🤖 ბოტი ფიქრობს...';
 }
);

socket.on(
 'achievement',
 function (data) {
  toast(
   '🏆 ' +
   data.title
  );
 }
);

socket.on(
 'errorMessage',
 function (message) {
  toast(
   '⚠️ ' +
   message
  );
 }
);

socket.on(
 'gameWinner',
 function (data) {
  toast(
   '🏆 გამარჯვებულია ' +
   data.playerName
  );

  if (
   current &&
   data.playerId ===
    current.viewerId
  ) {
   sfx('win');
   confettiBurst();
  } else {
   sfx('lose');
  }
 }
);

/* ============================================================
   TOAST
   ============================================================ */

function toast(text) {
 var node =
  document.createElement(
   'div'
  );

 node.className =
  'toast';

 node.textContent =
  text;

 document.body.appendChild(
  node
 );

 setTimeout(
  function () {
   node.remove();
  },
  2800
 );
}

/* ============================================================
   TIMER DISPLAY
   ============================================================ */

setInterval(
 function () {
  if (
   !current ||
   current.gameOver
  ) {
   return;
  }

  var left =
   Math.max(
    0,
    current.turnEndsAt -
    Date.now()
   );

  var seconds =
   Math.ceil(
    left / 1000
   );

  var active =
   current.players[
    current.currentTurnIndex
   ];

  if (!active) {
   return;
  }

  var selector =
   '.seat[data-player="' +
   String(active.id)
    .replace(/"/g, '\\"') +
   '"] .seatMeta';

  var node =
   document.querySelector(
    selector
   );

  if (node) {
   node.textContent =
    active.cardCount +
    ' კარტი · ' +
    active.totalPoints +
    ' · ⏱ ' +
    seconds;
  }
 },
 250
);

/* ============================================================
   MODALS (generic open/close)
   ============================================================ */

function openModal(id) {
 show(id);
}

document
 .querySelectorAll(
  '.closeModal'
 )
 .forEach(
  function (button) {
   button.onclick =
    function () {
     hide(
      button.dataset.modal
     );
    };
  }
 );

document
 .querySelectorAll(
  '.modal'
 )
 .forEach(
  function (modal) {
   modal.addEventListener(
    'click',
    function (event) {
     if (event.target === modal) {
      modal.classList.add(
       'hidden'
      );
     }
    }
   );
  }
 );

/* ============================================================
   LEADERBOARD
   ============================================================ */

el('leaderboardBtn').onclick =
 function () {
  socket.emit(
   'getLeaderboard'
  );

  openModal(
   'leaderboardModal'
  );
 };

socket.on(
 'leaderboardData',
 function (list) {
  el('leaderboardList').innerHTML =
   list.map(
    function (player, index) {
     return (
      '<div class="lbRow">' +
       '<span class="lbRank">' +
        (index + 1) +
       '</span>' +
       '<span class="lbWho">' +
        '<span class="onlineDot' +
         (
          player.online
           ? ' on'
           : ''
         ) +
         '"></span>' +
        setAvatarHtml(
         player.avatar
        ) +
        '<span>' +
         esc(player.username) +
        '</span>' +
       '</span>' +
       '<span class="rankPill">' +
        player.rank.icon +
        ' ' +
        player.rating +
       '</span>' +
      '</div>'
     );
    }
   ).join('') ||
   '<p style="color:#91a49d">' +
   'ჯერ არავინაა რეიტინგში.' +
   '</p>';
 }
);

function setAvatarHtml(value) {
 if (
  String(value || '')
   .indexOf('data:image/') === 0
 ) {
  return (
   '<img src="' +
   value +
   '" style="width:22px;height:22px;' +
   'border-radius:50%;object-fit:cover">'
  );
 }

 return (
  '<span>' +
  esc(value || '🦊') +
  '</span>'
 );
}

/* ============================================================
   FRIENDS
   ============================================================ */

el('friendsBtn').onclick =
 function () {
  socket.emit(
   'getFriends'
  );

  openModal(
   'friendsModal'
  );
 };

el('addFriendBtn').onclick =
 function () {
  var value =
   el('friendUsername')
    .value
    .trim();

  if (!value) {
   return;
  }

  socket.emit(
   'addFriend',
   { username:value }
  );

  el('friendUsername')
   .value = '';
 };

socket.on(
 'friendsList',
 function (list) {
  if (!list.length) {
   el('friendsList').innerHTML =
    '<p style="color:#91a49d">' +
    'ჯერ არცერთი მეგობარი არ გყავს.' +
    '</p>';

   return;
  }

  el('friendsList').innerHTML =
   list.map(
    function (friend) {
     return (
      '<div class="friendRow">' +
       '<span class="friendWho">' +
        '<span class="onlineDot' +
         (
          friend.online
           ? ' on'
           : ''
         ) +
         '"></span>' +
        setAvatarHtml(
         friend.avatar
        ) +
        '<span>' +
         esc(friend.username) +
        '</span>' +
       '</span>' +
       '<span class="rankPill">' +
        friend.rank.icon +
        ' ' +
        friend.rating +
       '</span>' +
       '<button ' +
        'class="smallBtn removeFriendBtn" ' +
        'data-id="' +
        esc(friend.id) +
        '">✕</button>' +
      '</div>'
     );
    }
   ).join('');

  document
   .querySelectorAll(
    '.removeFriendBtn'
   )
   .forEach(
    function (button) {
     button.onclick =
      function () {
       socket.emit(
        'removeFriend',
        { id:button.dataset.id }
       );
      };
    }
   );
 }
);

/* ============================================================
   STATS
   ============================================================ */

el('statsBtn').onclick =
 function () {
  renderStats();

  openModal(
   'statsModal'
  );
 };

function renderStats() {
 if (!profile) {
  return;
 }

 var stats =
  profile.stats || {};

 var partyRate =
  stats.partiesPlayed
   ? Math.round(
      (
       stats.partiesWon /
       stats.partiesPlayed
      ) * 100
     )
   : 0;

 el('statGrid').innerHTML =
  [
   ['პარტიები მოგებული', stats.partiesWon || 0],
   ['პარტიები ნათამაშები', stats.partiesPlayed || 0],
   ['მოგების % ', partyRate + '%'],
   ['საუკეთესო სერია', stats.bestWinStreak || 0],
   ['დიდი მოგება', stats.biggestWin || 0],
   ['ხელები ნათამაშები', stats.handsPlayed || 0]
  ].map(
   function (row) {
    return (
     '<div class="statBox">' +
      '<b>' +
       row[1] +
      '</b>' +
      '<small>' +
       row[0] +
      '</small>' +
     '</div>'
    );
   }
  ).join('');

 var recent =
  stats.recentParties || [];

 el('sparkRow').innerHTML =
  recent.map(
   function (party) {
    var height =
     Math.min(
      100,
      10 +
      Math.abs(party.delta || 1)
     );

    return (
     '<div class="sparkBar ' +
      (
       party.won
        ? 'win'
        : 'loss'
      ) +
      '" style="height:' +
      height +
      '%" title="' +
      (
       party.won
        ? 'მოგება'
        : 'წაგება'
      ) +
      ' (' +
      party.delta +
      ')"></div>'
    );
   }
  ).join('') ||
  '<p style="color:#91a49d;font-size:12px">' +
  'ჯერ არცერთი პარტია არ დასრულებულა.' +
  '</p>';
}

var fairnessHistory = [];

socket.on(
 'fairnessReveal',
 function (data) {
  fairnessHistory.unshift(
   data
  );

  fairnessHistory =
   fairnessHistory.slice(0, 10);

  el('fairnessLog').innerHTML =
   '<b>🔒 Provably Fair</b><br>' +
   fairnessHistory.map(
    function (entry) {
     return (
      'ხელი #' +
      entry.hand +
      ' · seed: ' +
      entry.seed.slice(0, 16) +
      '… · hash: ' +
      entry.hash.slice(0, 16) +
      '…'
     );
    }
   ).join('<br>');
 }
);

/* ============================================================
   SHOP
   ============================================================ */

var SHOP_CATALOG = [
 { id:'felt_sunset', type:'felt', key:'sunset', name:'მზის ჩასვლა', price:300, swatch:'linear-gradient(135deg,#ff8a3d,#c2185b)' },
 { id:'felt_neon', type:'felt', key:'neon', name:'ნეონი', price:300, swatch:'linear-gradient(135deg,#00e5ff,#ff00e5)' },
 { id:'felt_galaxy', type:'felt', key:'galaxy', name:'გალაქტიკა', price:500, swatch:'linear-gradient(135deg,#1a0b3d,#3d1a6b,#0b0b2e)' },
 { id:'felt_rosegold', type:'felt', key:'rosegold', name:'ვარდისფერი ოქრო', price:500, swatch:'linear-gradient(135deg,#f7c9c0,#b76e79)' },
 { id:'frame_bronze', type:'frame', key:'bronze', name:'ბრინჯაოს ჩარჩო', price:150, swatch:'linear-gradient(135deg,#c98a4b,#7a4d24)' },
 { id:'frame_silver', type:'frame', key:'silver', name:'ვერცხლის ჩარჩო', price:250, swatch:'linear-gradient(135deg,#e6e6f0,#a0a0ad)' },
 { id:'frame_gold', type:'frame', key:'gold', name:'ოქროს ჩარჩო', price:400, swatch:'linear-gradient(135deg,#ffe27a,#c9970f)' },
 { id:'frame_diamond', type:'frame', key:'diamond', name:'ბრილიანტის ჩარჩო', price:700, swatch:'linear-gradient(135deg,#b6f3f7,#4fc3cf)' }
];

el('shopBtn').onclick =
 function () {
  renderShop();

  openModal(
   'shopModal'
  );
 };

function renderShop() {
 if (!profile) {
  return;
 }

 var inv =
  profile.inventory ||
  { felts:[], frames:[] };

 el('shopGrid').innerHTML =
  SHOP_CATALOG.map(
   function (item) {
    var owned =
     (
      item.type === 'felt'
       ? inv.felts
       : inv.frames
     ).indexOf(item.key) >= 0;

    var equipped =
     profile.equipped &&
     profile.equipped[item.type] ===
      item.key;

    var btnLabel =
     equipped
      ? '✓ გააქტიურებულია'
      : (
        owned
         ? 'გააქტიურება'
         : '🪙 ' + item.price
       );

    var btnClass =
     equipped
      ? 'owned'
      : (
        owned
         ? ''
         : (
           profile.coins < item.price
            ? 'locked'
            : ''
          )
       );

    return (
     '<div class="shopItem">' +
      '<div class="shopSwatch" ' +
       'style="background:' +
       item.swatch +
       '"></div>' +
      '<b>' +
       esc(item.name) +
      '</b>' +
      '<button ' +
       'class="shopBtn ' +
       btnClass +
       ' shopAction" ' +
       'data-id="' +
       item.id +
       '" ' +
       'data-owned="' +
       owned +
       '" ' +
       (
        equipped
         ? 'disabled'
         : ''
       ) +
       '>' +
       btnLabel +
      '</button>' +
     '</div>'
    );
   }
  ).join('');

 document
  .querySelectorAll(
   '.shopAction'
  )
  .forEach(
   function (button) {
    button.onclick =
     function () {
      var item =
       SHOP_CATALOG.find(
        function (candidate) {
         return (
          candidate.id ===
          button.dataset.id
         );
        }
       );

      if (!item) {
       return;
      }

      if (
       button.dataset.owned ===
       'true'
      ) {
       socket.emit(
        'equipCosmetic',
        {
         slot:item.type,
         value:item.key
        }
       );
      } else {
       socket.emit(
        'buyItem',
        { itemId:item.id }
       );
      }
     };
   }
  );
}

socket.on(
 'purchaseSuccess',
 function () {
  toast(
   '🛍️ ნივთი შეძენილია!'
  );

  renderShop();
 }
);

/* ============================================================
   SELF-EXCLUSION
   ============================================================ */

document
 .querySelectorAll(
  '.selfExcludeBtn'
 )
 .forEach(
  function (button) {
   button.onclick =
    function () {
     var duration =
      button.dataset.duration;

     var label =
      {
       '24h':'24 საათით',
       '7d':'7 დღით',
       '30d':'30 დღით',
       forever:'სამუდამოდ'
      }[duration];

     if (
      !confirm(
       'დარწმუნებული ხარ, რომ გინდა ანგარიშის ' +
       'დაბლოკვა ' +
       label +
       '? ეს დაუყოვნებლივ ამოგკეტავს სისტემიდან.'
      )
     ) {
      return;
     }

     socket.emit(
      'selfExclude',
      { duration:duration }
     );
    };
  }
 );

socket.on(
 'selfExcluded',
 function () {
  toast(
   '⏸ ანგარიში დაბლოკილია. ჯანმრთელობა პირველ ადგილზეა.'
  );

  setTimeout(
   function () {
    localStorage.removeItem(
     'buraToken'
    );

    location.reload();
   },
   2500
  );
 }
);

/* ============================================================
   CONFETTI
   ============================================================ */

function confettiBurst() {
 var canvas =
  el('confettiCanvas');

 canvas.width =
  window.innerWidth;

 canvas.height =
  window.innerHeight;

 canvas.classList.remove(
  'hidden'
 );

 var ctx =
  canvas.getContext('2d');

 var colors =
  ['#e5bd61','#49d69a','#e0616f','#7be0e6','#ffd75e'];

 var pieces = [];

 for (
  var i = 0;
  i < 140;
  i++
 ) {
  pieces.push({
   x:Math.random() * canvas.width,
   y:-20 - Math.random() * canvas.height * .5,
   w:6 + Math.random() * 6,
   h:8 + Math.random() * 10,
   speed:2 + Math.random() * 4,
   drift:(Math.random() - .5) * 2,
   rotate:Math.random() * 360,
   spin:(Math.random() - .5) * 12,
   color:colors[
    Math.floor(
     Math.random() * colors.length
    )
   ]
  });
 }

 var start = Date.now();

 function frame() {
  var elapsed = Date.now() - start;

  ctx.clearRect(
   0, 0,
   canvas.width,
   canvas.height
  );

  pieces.forEach(
   function (piece) {
    piece.y += piece.speed;
    piece.x += piece.drift;
    piece.rotate += piece.spin;

    ctx.save();

    ctx.translate(
     piece.x,
     piece.y
    );

    ctx.rotate(
     (piece.rotate * Math.PI) / 180
    );

    ctx.fillStyle =
     piece.color;

    ctx.fillRect(
     -piece.w / 2,
     -piece.h / 2,
     piece.w,
     piece.h
    );

    ctx.restore();
   }
  );

  if (elapsed < 3200) {
   requestAnimationFrame(frame);
  } else {
   canvas.classList.add(
    'hidden'
   );

   ctx.clearRect(
    0, 0,
    canvas.width,
    canvas.height
   );
  }
 }

 requestAnimationFrame(frame);
}

/* ============================================================
   LANGUAGE (i18n)
   ============================================================ */

var I18N = {
 ka:{
  loginTab:'შესვლა',
  registerTab:'რეგისტრაცია',
  newTable:'🎴 ახალი მაგიდა',
  activeTables:'🟢 აქტიური მაგიდები',
  quests:'🎯 დღიური დავალებები',
  tournaments:'🏆 ტურნირები',
  createBtn:'შექმენი / შედი მაგიდაზე'
 },
 en:{
  loginTab:'Login',
  registerTab:'Register',
  newTable:'🎴 New Table',
  activeTables:'🟢 Active Tables',
  quests:'🎯 Daily Quests',
  tournaments:'🏆 Tournaments',
  createBtn:'Create / Join Table'
 },
 ru:{
  loginTab:'Вход',
  registerTab:'Регистрация',
  newTable:'🎴 Новый стол',
  activeTables:'🟢 Активные столы',
  quests:'🎯 Ежедневные задания',
  tournaments:'🏆 Турниры',
  createBtn:'Создать / Войти'
 }
};

function applyLanguage(lang) {
 currentLang = lang;

 var dict =
  I18N[lang] ||
  I18N.ka;

 el('loginTab').firstChild &&
  (
   el('loginTab').textContent =
    dict.loginTab
  );

 el('registerTab').textContent =
  dict.registerTab;

 el('createBtn').textContent =
  dict.createBtn;

 document
  .querySelectorAll(
   '.panel h2'
  )
  .forEach(
   function (heading) {
    if (
     heading.textContent
      .indexOf('ახალი მაგიდა') >= 0 ||
     heading.textContent
      .indexOf('New Table') >= 0 ||
     heading.textContent
      .indexOf('Новый стол') >= 0
    ) {
     heading.textContent =
      dict.newTable;
    } else if (
     heading.textContent
      .indexOf('აქტიური მაგიდები') >= 0 ||
     heading.textContent
      .indexOf('Active Tables') >= 0 ||
     heading.textContent
      .indexOf('Активные столы') >= 0
    ) {
     heading.textContent =
      dict.activeTables;
    } else if (
     heading.textContent
      .indexOf('დღიური დავალებები') >= 0 ||
     heading.textContent
      .indexOf('Daily Quests') >= 0 ||
     heading.textContent
      .indexOf('Ежедневные задания') >= 0
    ) {
     heading.textContent =
      dict.quests;
    } else if (
     heading.textContent
      .indexOf('ტურნირები') >= 0 ||
     heading.textContent
      .indexOf('Tournaments') >= 0 ||
     heading.textContent
      .indexOf('Турниры') >= 0
    ) {
     heading.textContent =
      dict.tournaments;
    }
   }
  );

 try {
  localStorage.setItem(
   'buraLang',
   lang
  );
 } catch (error) {}
}

el('langSelect').onchange =
 function () {
  applyLanguage(
   this.value
  );
 };

try {
 var savedLang =
  localStorage.getItem(
   'buraLang'
  );

 if (savedLang) {
  el('langSelect').value =
   savedLang;

  applyLanguage(savedLang);
 }
} catch (error) {}

/* ============================================================
   DOMINO — CLIENT
   ============================================================ */

var dominoCurrent = null;
var dominoSelectedTile = null;

var DOMINO_DOTS = {
 0: [],
 1: [[50,50]],
 2: [[25,25],[75,75]],
 3: [[25,25],[50,50],[75,75]],
 4: [[25,25],[75,25],[25,75],[75,75]],
 5: [[25,25],[75,25],[50,50],[25,75],[75,75]],
 6: [[25,20],[75,20],[25,50],[75,50],[25,80],[75,80]]
};

function dominoHalfHtml(value) {
 var dots = DOMINO_DOTS[value] || [];
 return dots.map(function (pos) {
  return '<div class="dot" style="left:' + pos[0] + '%;top:' + pos[1] + '%;transform:translate(-50%,-50%)"></div>';
 }).join('');
}

function dominoTileHtml(a, b, vertical) {
 return (
  '<div class="dTile ' + (vertical ? 'vertical' : 'horizontal') + '">' +
   '<div class="dTile half">' + dominoHalfHtml(a) + '</div>' +
   '<div class="dTile half">' + dominoHalfHtml(b) + '</div>' +
  '</div>'
 );
}

/* ----- mode tabs ----- */

el('modeBuraTab').onclick = function () {
 el('modeBuraTab').classList.add('active');
 el('modeDominoTab').classList.remove('active');
 show('buraLobbyPanels');
 hide('dominoLobbyPanels');
};

el('modeDominoTab').onclick = function () {
 el('modeDominoTab').classList.add('active');
 el('modeBuraTab').classList.remove('active');
 hide('buraLobbyPanels');
 show('dominoLobbyPanels');
};

/* ----- create / join ----- */

el('dominoCreateBtn').onclick = function () {
 socket.emit('dominoJoinTable', {
  tableName: el('dominoTableName').value,
  capacity: Number(el('dominoCapacity').value),
  rounds: Number(el('dominoRounds').value)
 });
};

socket.on('dominoLobbyTables', function (list) {
 if (!list.length) {
  el('dominoTables').innerHTML = '<p style="color:#91a49d">ღია დომინოს მაგიდები ჯერ არ არის.</p>';
  return;
 }

 el('dominoTables').innerHTML = list.map(function (table) {
  return (
   '<div class="tableRow">' +
    '<div><b>' + esc(table.name) + '</b><br>' +
    '<small>' + table.players + '/' + table.capacity + ' · ' + table.rounds + ' რაუნდი</small></div>' +
    '<button class="primary joinDominoRoom" data-id="' + esc(table.id) + '">შეერთება</button>' +
   '</div>'
  );
 }).join('');

 document.querySelectorAll('.joinDominoRoom').forEach(function (button) {
  button.onclick = function () {
   socket.emit('dominoJoinTable', { roomId: button.dataset.id });
  };
 });
});

socket.on('dominoWaiting', function (data) {
 toast('ველოდებით მოთამაშეებს ' + data.current + '/' + data.max);
});

socket.on('dominoError', function (message) {
 toast('⚠️ ' + message);
});

socket.on('dominoDealAnimation', function () {
 sfx('deal');
});

socket.on('dominoPlayFX', function () {
 sfx('place');
});

/* ----- main state render ----- */

socket.on('dominoStateUpdate', function (state) {
 dominoCurrent = state;
 dominoSelectedTile = null;

 hide('auth');
 hide('lobby');
 hide('game');
 show('dominoGame');

 renderDomino();
});

function dominoMyIndex() {
 return dominoCurrent.players.findIndex(function (p) { return p.id === dominoCurrent.viewerId; });
}

function renderDomino() {
 if (!dominoCurrent) return;

 el('dHudRound').textContent = dominoCurrent.roundIndex;
 el('dHudTotalRounds').textContent = dominoCurrent.totalRounds;
 el('dHudBoneyard').textContent = dominoCurrent.boneyardCount;

 // seats
 el('dominoSeats').innerHTML = dominoCurrent.players.map(function (player) {
  return (
   '<div class="dominoSeat' + (player.isCurrent ? ' active' : '') + '">' +
    '<div class="avatar ' + frameClass(player.frame) + '">' + setAvatarHtml(player.avatar) + '</div>' +
    '<div><b>' + esc(player.name) + '</b><br><small>' + player.tileCount + ' კამათელი · ქულა ' + player.matchScore + '</small></div>' +
   '</div>'
  );
 }).join('');

 // chain + end zones
 var chainHtml = dominoCurrent.chain.map(function (t) {
  return dominoTileHtml(t.left, t.right, false);
 }).join('');

 var myIndex = dominoMyIndex();
 var myTurn = myIndex === dominoCurrent.currentTurnIndex && !dominoCurrent.processing && !dominoCurrent.gameOver;

 var leftMatches = dominoSelectedTile && (dominoSelectedTile.a === dominoCurrent.leftEnd || dominoSelectedTile.b === dominoCurrent.leftEnd);
 var rightMatches = dominoSelectedTile && (dominoSelectedTile.a === dominoCurrent.rightEnd || dominoSelectedTile.b === dominoCurrent.rightEnd);

 var leftZone = '<div class="dEndZone' + (leftMatches ? ' highlight' : '') + '" id="dLeftZone">' + (dominoCurrent.leftEnd === null ? '' : dominoCurrent.leftEnd) + '</div>';
 var rightZone = '<div class="dEndZone' + (rightMatches ? ' highlight' : '') + '" id="dRightZone">' + (dominoCurrent.rightEnd === null ? '' : dominoCurrent.rightEnd) + '</div>';

 el('dominoChain').innerHTML = dominoCurrent.chain.length
  ? (leftZone + chainHtml + rightZone)
  : '<p style="color:#91a49d">დაფა ცარიელია — პირველი კამათელი შენია!</p>';

 if (dominoCurrent.chain.length) {
  el('dLeftZone').onclick = function () {
   if (dominoSelectedTile && leftMatches) {
    socket.emit('dominoPlayTile', { tileId: dominoSelectedTile.id, side: 'left' });
    dominoSelectedTile = null;
   }
  };
  el('dRightZone').onclick = function () {
   if (dominoSelectedTile && rightMatches) {
    socket.emit('dominoPlayTile', { tileId: dominoSelectedTile.id, side: 'right' });
    dominoSelectedTile = null;
   }
  };
 }

 // hand
 var myHand = (dominoCurrent.hands && dominoCurrent.hands[dominoCurrent.viewerId]) || [];

 el('dominoHand').innerHTML = myHand.map(function (tile) {
  var selected = dominoSelectedTile && dominoSelectedTile.id === tile.id;
  return (
   '<div class="dTileWrap" data-id="' + tile.id + '">' +
    '<div class="dTile vertical' + (selected ? ' selected' : '') + '">' +
     '<div class="dTile half">' + dominoHalfHtml(tile.a) + '</div>' +
     '<div class="dTile half">' + dominoHalfHtml(tile.b) + '</div>' +
    '</div>' +
   '</div>'
  );
 }).join('');

 document.querySelectorAll('#dominoHand .dTileWrap').forEach(function (wrap) {
  wrap.onclick = function () {
   if (!myTurn) return;

   var tile = myHand.find(function (t) { return t.id === wrap.dataset.id; });
   if (!tile) return;

   if (!dominoCurrent.chain.length) {
    socket.emit('dominoPlayTile', { tileId: tile.id, side: 'right' });
    return;
   }

   var matchesLeft = tile.a === dominoCurrent.leftEnd || tile.b === dominoCurrent.leftEnd;
   var matchesRight = tile.a === dominoCurrent.rightEnd || tile.b === dominoCurrent.rightEnd;

   if (matchesLeft && matchesRight) {
    dominoSelectedTile = (dominoSelectedTile && dominoSelectedTile.id === tile.id) ? null : tile;
    renderDomino();
   } else if (matchesLeft) {
    socket.emit('dominoPlayTile', { tileId: tile.id, side: 'left' });
   } else if (matchesRight) {
    socket.emit('dominoPlayTile', { tileId: tile.id, side: 'right' });
   } else {
    toast('⚠️ ეს კამათელი ვერ ჩაერთვება დაფაზე');
   }
  };
 });

 // status
 if (dominoCurrent.gameOver) {
  el('dominoStatus').textContent = 'მატჩი დასრულდა';
 } else if (myTurn) {
  el('dominoStatus').textContent = 'შენი სვლაა — აირჩიე კამათელი';
 } else {
  var activeName = dominoCurrent.players[dominoCurrent.currentTurnIndex] && dominoCurrent.players[dominoCurrent.currentTurnIndex].name;
  el('dominoStatus').textContent = (activeName || '') + ' თამაშობს...';
 }

 // score panel
 el('dominoScorePanel').innerHTML = dominoCurrent.players.slice().sort(function (a, b) {
  return b.matchScore - a.matchScore;
 }).map(function (player) {
  return '<div class="dominoScoreCard"><b>' + player.matchScore + '</b><small>' + esc(player.name) + '</small></div>';
 }).join('');
}

socket.on('dominoRoundEnd', function (data) {
 var reasonText = data.reason === 'out' ? 'გავიდა კამათლებით' : 'დაბლოკილი რაუნდი — ყველაზე დაბალი ჯამი';
 toast('🁫 ' + data.winnerName + ' — ' + reasonText + ' (+' + data.awarded + ')');
 sfx('cut');
});

socket.on('dominoFairnessReveal', function (data) {
 fairnessHistory.unshift({ hand: 'დომინო რაუნდი ' + data.round, seed: data.seed, hash: data.hash });
 fairnessHistory = fairnessHistory.slice(0, 10);
});

socket.on('dominoMatchEnd', function (data) {
 toast('🏆 დომინოს გამარჯვებული: ' + data.winnerName);

 if (dominoCurrent && data.winnerId === dominoCurrent.viewerId) {
  sfx('win');
  confettiBurst();
 } else {
  sfx('lose');
 }
});



(function () {
 var params =
  new URLSearchParams(
   window.location.search
  );

 var invite =
  params.get('invite');

 if (invite) {
  pendingInvite = invite;
 }
})();



var savedToken =
 localStorage.getItem(
  'buraToken'
 );

if (savedToken) {
 socket.emit(
  'restoreSession',
  {
   token:
    savedToken
  }
 );
}

})();
</script>

</body>
</html>`;

/* ============================================================
   EXPRESS ROUTES — EXPRESS 5 SAFE
   ============================================================ */

/*
  IMPORTANT:

  DO NOT USE:

    app.get('*', ...)
    app.get('/*', ...)
    app.get(':*', ...)
    app.get('/:*', ...)

  With modern path-to-regexp / Express 5 these can cause:
    TypeError: Missing parameter name

  We only need "/" because the entire application
  is inside PAGE.
*/

app.get('/', function (req, res) {
  res
    .status(200)
    .type('html')
    .send(PAGE);
});

/*
  Render health check.
*/

app.get(
  '/health',
  function (req, res) {
    res.status(200).json({
      ok: true,
      service: 'Written Bura',
      version: 'monolithic-express5',
      cards: 36,
      tester: TESTER_NAME,
      rooms: rooms.size,
      users: users.size,
      uptime:
        Math.floor(
          process.uptime()
        ),
      timestamp:
        new Date()
          .toISOString()
    });
  }
);

/*
  Express 5 safe 404 handler.

  Notice:
  app.use() has NO "*" path.
  Therefore path-to-regexp does not need to parse a wildcard.
*/

app.use(function (req, res) {
  res
    .status(404)
    .type('html')
    .send(
      '<!doctype html>' +
      '<html lang="ka">' +
      '<head>' +
      '<meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>404 — Written Bura</title>' +
      '</head>' +
      '<body style="' +
       'margin:0;' +
       'min-height:100vh;' +
       'display:grid;' +
       'place-items:center;' +
       'background:#050b09;' +
       'color:#fff;' +
       'font-family:Arial,sans-serif;' +
       'text-align:center' +
      '">' +
       '<div>' +
        '<div style="font-size:70px">🃏</div>' +
        '<h1 style="color:#e5bd61">404</h1>' +
        '<h2>გვერდი ვერ მოიძებნა</h2>' +
        '<p>' +
         '<a href="/" style="color:#e5bd61">' +
          'Written Bura-ზე დაბრუნება' +
         '</a>' +
        '</p>' +
       '</div>' +
      '</body>' +
      '</html>'
    );
});

/* ============================================================
   PERIODIC CLEANUP
   ============================================================ */

setInterval(
  function () {
    rooms.forEach(
      function (room, id) {
        const connectedHumans =
          room.players.filter(
            function (player) {
              return (
                !player.isBot &&
                player.connected
              );
            }
          );

        if (
          room.game &&
          room.game.gameOver &&
          connectedHumans.length === 0
        ) {
          cleanupRoom(room);
          rooms.delete(id);
          return;
        }

        if (
          !room.game &&
          room.players.length === 0
        ) {
          cleanupRoom(room);
          rooms.delete(id);
        }
      }
    );

    broadcastLobby();
  },
  60000
);

/* ============================================================
   SHUTDOWN
   ============================================================ */

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log(
    '[SHUTDOWN]',
    signal || ''
  );

  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }

  rooms.forEach(
    function (room) {
      cleanupRoom(room);
    }
  );

  try {
    await saveUsersNow();
  } catch (error) {
    console.error(
      '[SHUTDOWN SAVE]',
      error
    );
  }

  server.close(
    function () {
      process.exit(0);
    }
  );

  setTimeout(
    function () {
      process.exit(0);
    },
    5000
  ).unref();
}

process.on(
  'SIGTERM',
  function () {
    shutdown('SIGTERM');
  }
);

process.on(
  'SIGINT',
  function () {
    shutdown('SIGINT');
  }
);

process.on(
  'unhandledRejection',
  function (error) {
    console.error(
      '[UNHANDLED REJECTION]',
      error
    );
  }
);

process.on(
  'uncaughtException',
  function (error) {
    console.error(
      '[UNCAUGHT EXCEPTION]',
      error
    );
  }
);

/* ============================================================
   BOOT
   ============================================================ */

async function boot() {
  await loadUsers();

  server.listen(
    PORT,
    '0.0.0.0',
    function () {
      console.log(
        '=========================================='
      );

      console.log(
        ' WRITTEN BURA ONLINE'
      );

      console.log(
        '=========================================='
      );

      console.log(
        ' PORT:',
        PORT
      );

      console.log(
        ' ROOT ROUTE: /'
      );

      console.log(
        ' HEALTH ROUTE: /health'
      );

      console.log(
        ' UI: MONOLITHIC PAGE'
      );

      console.log(
        ' public/: NOT REQUIRED'
      );

      console.log(
        ' EXPRESS 5 WILDCARD: NOT USED'
      );

      console.log(
        ' TESTER:',
        TESTER_NAME
      );

      console.log(
        ' USERS:',
        users.size
      );

      console.log(
        '=========================================='
      );
    }
  );
}

boot().catch(
  function (error) {
    console.error(
      '[BOOT ERROR]',
      error
    );

    process.exit(1);
  }
);
