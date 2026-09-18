'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;

const TURN_SECONDS = 20;
const RECONNECT_MS = 45000;
const TRICK_CLEAR_DELAY = 1800;

const CAPACITIES = [3, 4];
const STAKES = [5, 10, 25, 50, 100];
const MAX_PARTIES = 4;

const CARD_VALUES = {
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
  '6',
  '7',
  '8',
  '9',
  'J',
  'Q',
  'K',
  '10',
  'A'
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
const reconnectSessions = new Map();

/* =========================================================
   HELPERS
========================================================= */

function cleanName(value) {
  return String(value || '')
    .trim()
    .slice(0, 20);
}

function isTesterName(value) {
  return cleanName(value).toLowerCase() === TESTER_NAME;
}

function makeId(prefix) {
  return (
    prefix +
    '_' +
    Date.now() +
    '_' +
    Math.floor(Math.random() * 1000000)
  );
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

/* =========================================================
   DECK
========================================================= */

function createDeck() {
  const deck = [];

  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        suit,
        rank,
        value: CARD_VALUES[rank]
      });
    }
  }

  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    [deck[i], deck[j]] =
      [deck[j], deck[i]];
  }

  return deck;
}

/* =========================================================
   ROOM
========================================================= */

function createRoom(capacity, parties, stake) {
  const room = {
    id: makeId('room'),

    capacity,
    parties,
    stake,

    players: [],

    game: null,

    timer: null,
    botTimer: null,
    trickTimer: null
  };

  rooms.set(room.id, room);

  return room;
}

/* =========================================================
   START HAND
========================================================= */

function startHand(room, previous = null) {
  const deck = createDeck();

  const hands = {};
  const taken = {};
  const totals = {};

  for (const player of room.players) {
    hands[player.id] = deck.splice(0, 5);

    taken[player.id] = [];

    totals[player.id] =
      previous
        ? previous.totals[player.id] || 0
        : 0;
  }

  const handIndex =
    previous
      ? previous.handIndex + 1
      : 1;

  const leaderIndex =
    previous &&
    Number.isInteger(previous.nextLeaderIndex)
      ? previous.nextLeaderIndex
      : 0;

  return {
    deck,

    hands,

    taken,

    totals,

    table: [],

    handIndex,

    partyIndex:
      Math.ceil(handIndex / 5),

    trump:
      TRUMPS[
        (handIndex - 1) %
        TRUMPS.length
      ],

    currentTurnIndex:
      leaderIndex,

    nextLeaderIndex:
      leaderIndex,

    leadCount: null,

    leadMaliutka: false,

    lastTrickOrder: [],

    processing: false,

    gameOver: false,

    lastHandScores:
      previous
        ? previous.lastHandScores || {}
        : {},

    history:
      previous
        ? previous.history || []
        : [],

    turnEndsAt:
      Date.now() +
      TURN_SECONDS * 1000
  };
}

/* =========================================================
   CARD BEATING
========================================================= */

function cardBeats(attacker, defender, trump) {
  const attackerTrump =
    isTrump(attacker, trump);

  const defenderTrump =
    isTrump(defender, trump);

  /*
    defender ცდილობს attacker-ის გაჭრას
  */

  if (
    defenderTrump &&
    !attackerTrump
  ) {
    return true;
  }

  if (
    attackerTrump &&
    !defenderTrump
  ) {
    return false;
  }

  if (
    attacker.suit !==
    defender.suit
  ) {
    return false;
  }

  return (
    rankIndex(defender) >
    rankIndex(attacker)
  );
}

/* =========================================================
   MULTI CARD BACKTRACKING MATCHER

   IMPORTANT:
   საპასუხო კარტები შეიძლება სხვადასხვა მასტის იყოს.

   მაგალითად:
   attacker = 3 cards
   defender = 2 spades + 1 diamond

   სისტემა ეძებს სწორ pairing-ს.
========================================================= */

function canBeatSet(
  attackers,
  defenders,
  trump
) {
  if (
    !Array.isArray(attackers) ||
    !Array.isArray(defenders) ||
    attackers.length !== defenders.length
  ) {
    return false;
  }

  const used =
    new Array(defenders.length)
      .fill(false);

  function match(index) {
    if (
      index >=
      attackers.length
    ) {
      return true;
    }

    for (
      let j = 0;
      j < defenders.length;
      j++
    ) {
      if (used[j]) {
        continue;
      }

      if (
        cardBeats(
          attackers[index],
          defenders[j],
          trump
        )
      ) {
        used[j] = true;

        if (
          match(index + 1)
        ) {
          return true;
        }

        used[j] = false;
      }
    }

    return false;
  }

  return match(0);
}

function playBeats(
  leadPlay,
  challengePlay,
  trump
) {
  return canBeatSet(
    leadPlay.cards,
    challengePlay.cards,
    trump
  );
}

function winningPlayIndex(game) {
  if (
    !game.table.length
  ) {
    return -1;
  }

  let winner = 0;

  for (
    let i = 1;
    i < game.table.length;
    i++
  ) {
    if (
      playBeats(
        game.table[winner],
        game.table[i],
        game.trump
      )
    ) {
      winner = i;
    }
  }

  return winner;
}

/* =========================================================
   CLIENT STATE
========================================================= */

function clientState(
  room,
  viewerId,
  revealAll = false
) {
  const game = room.game;

  if (!game) {
    return null;
  }

  const visibleCards = {};

  if (revealAll) {
    for (
      const player of
      room.players
    ) {
      visibleCards[player.id] =
        game.hands[player.id] || [];
    }
  } else if (
    viewerId &&
    game.hands[viewerId]
  ) {
    visibleCards[viewerId] =
      game.hands[viewerId];
  }

  const winIndex =
    winningPlayIndex(game);

  return {
    roomId:
      room.id,

    stake:
      room.stake,

    capacity:
      room.capacity,

    parties:
      room.parties,

    totalHands:
      room.parties * 5,

    handIndex:
      game.handIndex,

    partyIndex:
      game.partyIndex,

    trump:
      game.trump,

    deckCount:
      game.deck.length,

    currentTurnIndex:
      game.currentTurnIndex,

    processing:
      game.processing,

    gameOver:
      game.gameOver,

    viewingPlayerId:
      viewerId,

    revealAll:
      Boolean(revealAll),

    leadCount:
      game.leadCount,

    leadWasMaliutka:
      Boolean(game.leadMaliutka),

    lastHandScores:
      game.lastHandScores,

    history:
      game.history || [],

    playersCards:
      visibleCards,

    turnEndsAt:
      game.turnEndsAt,

    turnSeconds:
      TURN_SECONDS,

    table:
      game.table.map(
        (play, index) => ({
          ...play,

          isWinning:
            index === winIndex
        })
      ),

    players:
      room.players.map(
        (player, index) => ({
          id:
            player.id,

          name:
            player.name,

          isBot:
            Boolean(player.isBot),

          isTester:
            Boolean(player.isTester),

          balance:
            player.balance,

          avatar:
            player.avatar || '🦊',

          cardCount:
            (
              game.hands[player.id] ||
              []
            ).length,

          handPoints:
            (
              game.taken[player.id] ||
              []
            ).reduce(
              (sum, card) =>
                sum +
                (card.value || 0),
              0
            ),

          totalPoints:
            game.totals[player.id] ||
            0,

          isCurrent:
            index ===
            game.currentTurnIndex
        })
      )
  };
}

/* =========================================================
   BROADCAST
========================================================= */

function broadcast(room) {
  for (
    const player of
    room.players
  ) {
    if (
      player.isBot ||
      !player.socketId
    ) {
      continue;
    }

    io
      .to(player.socketId)
      .emit(
        'gameStateUpdate',

        clientState(
          room,
          player.id,
          player.isTester
        )
      );
  }
}

/* =========================================================
   TURN TIMER
========================================================= */

function setTurn(room, index) {
  if (
    !room.game ||
    room.game.gameOver
  ) {
    return;
  }

  room.game.currentTurnIndex =
    index;

  room.game.turnEndsAt =
    Date.now() +
    TURN_SECONDS * 1000;

  clearTimeout(room.timer);

  room.timer =
    setTimeout(
      () => {
        autoPlayCurrent(room);
      },

      TURN_SECONDS * 1000 +
      100
    );
}

/* =========================================================
   REFILL CARDS
========================================================= */

function refill(
  room,
  winnerIndex
) {
  const game =
    room.game;

  while (
    game.deck.length
  ) {
    let dealt = false;

    for (
      let step = 0;
      step < room.players.length;
      step++
    ) {
      const player =
        room.players[
          (
            winnerIndex +
            step
          ) %
          room.players.length
        ];

      const hand =
        game.hands[player.id];

      if (
        hand.length < 5 &&
        game.deck.length
      ) {
        hand.push(
          game.deck.pop()
        );

        dealt = true;

        io
          .to(room.id)
          .emit(
            'dealCard',
            {
              playerId:
                player.id
            }
          );
      }
    }

    if (!dealt) {
      break;
    }
  }
}

/* =========================================================
   FINISH HAND
========================================================= */

function finishHand(room) {
  const game =
    room.game;

  const scores = {};
  const rawScores = {};

  let minRaw =
    Infinity;

  let minIndex =
    0;

  const zeroPlayers = [];

  room.players.forEach(
    (player, index) => {
      const raw =
        (
          game.taken[player.id] ||
          []
        ).reduce(
          (sum, card) =>
            sum +
            (card.value || 0),
          0
        );

      const score =
        raw === 0
          ? -120
          : raw;

      rawScores[player.id] =
        raw;

      scores[player.id] =
        score;

      game.totals[player.id] =
        (
          game.totals[player.id] ||
          0
        ) +
        score;

      if (
        raw === 0
      ) {
        zeroPlayers.push(
          player.id
        );
      }

      if (
        raw < minRaw
      ) {
        minRaw =
          raw;

        minIndex =
          index;
      }
    }
  );

  game.lastHandScores = {
    ...scores
  };

  game.history.push({
    hand:
      game.handIndex,

    trump:
      game.trump,

    rawScores:
      { ...rawScores },

    scores:
      { ...scores },

    totals:
      { ...game.totals }
  });

  /*
    გახიშტვის სპეციალური წესი:
    თუ რამდენიმე მოთამაშეს აქვს 0,
    ვეძებთ ბოლო ტრიკის რიგში
    ბოლოს მყოფ zero scorer-ს.
  */

  if (
    zeroPlayers.length > 1 &&
    game.lastTrickOrder.length
  ) {
    let lastZeroId = null;

    for (
      const id of
      game.lastTrickOrder
    ) {
      if (
        zeroPlayers.includes(id)
      ) {
        lastZeroId = id;
      }
    }

    if (lastZeroId) {
      const index =
        room.players.findIndex(
          player =>
            player.id ===
            lastZeroId
        );

      if (
        index >= 0
      ) {
        minIndex = index;
      }
    }
  }

  if (
    game.handIndex >=
    room.parties * 5
  ) {
    game.gameOver =
      true;

    clearTimeout(
      room.timer
    );

    clearTimeout(
      room.botTimer
    );

    broadcast(room);

    io
      .to(room.id)
      .emit(
        'sfxEvent',
        {
          type: 'win'
        }
      );

    return;
  }

  game.nextLeaderIndex =
    (
      minIndex + 1
    ) %
    room.players.length;

  room.game =
    startHand(
      room,
      game
    );

  room.game.lastHandScores = {
    ...scores
  };

  setTurn(
    room,
    room.game.currentTurnIndex
  );

  broadcast(room);

  io
    .to(room.id)
    .emit(
      'sfxEvent',
      {
        type: 'deal'
      }
    );

  scheduleBot(room);
}

/* =========================================================
   COMPLETE TRICK
   1.8 SECOND TABLE CLEAR DELAY
========================================================= */

function completeTrick(room) {
  const game =
    room.game;

  if (
    !game ||
    game.processing ||
    game.table.length !==
      room.players.length
  ) {
    return;
  }

  const winIndex =
    winningPlayIndex(game);

  const winnerPlay =
    game.table[winIndex];

  if (!winnerPlay) {
    return;
  }

  const winnerIndex =
    room.players.findIndex(
      player =>
        player.id ===
        winnerPlay.playerId
    );

  if (
    winnerIndex < 0
  ) {
    return;
  }

  /*
    აქ მაგიდა არ იწმინდება.

    clientState-ში winning card-ს
    isWinning=true აქვს.

    CSS-ში მას ოქროსფერი glow
    ექნება.
  */

  game.processing =
    true;

  clearTimeout(
    room.timer
  );

  clearTimeout(
    room.botTimer
  );

  broadcast(room);

  io
    .to(room.id)
    .emit(
      'trickPreview',
      {
        winnerId:
          winnerPlay.playerId,

        winnerPlayIndex:
          winIndex,

        delay:
          TRICK_CLEAR_DELAY
      }
    );

  io
    .to(room.id)
    .emit(
      'sfxEvent',
      {
        type: 'cut'
      }
    );

  room.trickTimer =
    setTimeout(
      () => {
        if (
          !rooms.has(room.id) ||
          room.game !== game
        ) {
          return;
        }

        const allCards =
          game.table.flatMap(
            play =>
              play.cards
          );

        game
          .taken[
            winnerPlay.playerId
          ]
          .push(
            ...allCards
          );

        game.lastTrickOrder =
          game.table.map(
            play =>
              play.playerId
          );

        io
          .to(room.id)
          .emit(
            'trickWon',
            {
              winnerId:
                winnerPlay.playerId
            }
          );

        game.table = [];

        game.leadCount =
          null;

        game.leadMaliutka =
          false;

        refill(
          room,
          winnerIndex
        );

        game.processing =
          false;

        const allEmpty =
          room.players.every(
            player =>
              (
                game.hands[
                  player.id
                ] ||
                []
              ).length === 0
          );

        if (allEmpty) {
          finishHand(room);
        } else {
          setTurn(
            room,
            winnerIndex
          );

          broadcast(room);

          scheduleBot(room);
        }
      },

      TRICK_CLEAR_DELAY
    );
}

/* =========================================================
   COMBINATIONS FOR SMART BOT
========================================================= */

function combinations(
  indexes,
  count
) {
  const result = [];

  function walk(
    start,
    picked
  ) {
    if (
      picked.length ===
      count
    ) {
      result.push(
        picked.slice()
      );

      return;
    }

    for (
      let i = start;
      i < indexes.length;
      i++
    ) {
      picked.push(
        indexes[i]
      );

      walk(
        i + 1,
        picked
      );

      picked.pop();
    }
  }

  walk(0, []);

  return result;
}

/* =========================================================
   BOT COST
========================================================= */

function cardCost(
  card,
  trump
) {
  return (
    (card.value || 0) *
      10 +

    rankIndex(card) +

    (
      isTrump(
        card,
        trump
      )
        ? 1000
        : 0
    )
  );
}

function lowestDiscard(
  hand,
  count,
  trump
) {
  return hand
    .map(
      (card, index) => ({
        index,
        card,

        cost:
          cardCost(
            card,
            trump
          )
      })
    )
    .sort(
      (a, b) =>
        a.cost -
          b.cost ||
        rankIndex(a.card) -
          rankIndex(b.card)
    )
    .slice(
      0,
      Math.min(
        count,
        hand.length
      )
    )
    .map(
      item =>
        item.index
    );
}

function cheapestCut(
  hand,
  count,
  targetCards,
  trump
) {
  if (
    count <= 0 ||
    count > hand.length
  ) {
    return null;
  }

  let best =
    null;

  let bestCost =
    Infinity;

  const indexes =
    hand.map(
      (_, index) =>
        index
    );

  for (
    const combo of
    combinations(
      indexes,
      count
    )
  ) {
    const cards =
      combo.map(
        index =>
          hand[index]
      );

    if (
      !canBeatSet(
        targetCards,
        cards,
        trump
      )
    ) {
      continue;
    }

    const cost =
      cards.reduce(
        (sum, card) =>
          sum +
          cardCost(
            card,
            trump
          ),
        0
      );

    if (
      cost < bestCost
    ) {
      bestCost =
        cost;

      best =
        combo;
    }
  }

  return best;
}

function firstSameSuitGroup(
  hand,
  count
) {
  for (
    const suit of
    SUITS
  ) {
    const indexes =
      hand
        .map(
          (card, index) =>
            card.suit === suit
              ? index
              : -1
        )
        .filter(
          index =>
            index >= 0
        );

    if (
      indexes.length >=
      count
    ) {
      return indexes.slice(
        0,
        count
      );
    }
  }

  return null;
}

/* =========================================================
   SMART BOT
========================================================= */

function botChoice(
  room,
  bot
) {
  const game =
    room.game;

  const hand =
    game.hands[bot.id] ||
    [];

  if (
    !hand.length
  ) {
    return [];
  }

  /*
    BOT არის პირველი
  */

  if (
    !game.table.length
  ) {
    const maliutka =
      firstSameSuitGroup(
        hand,
        5
      );

    if (
      maliutka &&
      Math.random() < 0.35
    ) {
      return maliutka;
    }

    /*
      ჩვეულებრივ ყველაზე იაფი
      კარტით იწყებს.
    */

    return lowestDiscard(
      hand,
      1,
      game.trump
    );
  }

  /*
    მალიუტკის პასუხი:
    ყველა დარჩენილი კარტი.
  */

  if (
    game.leadMaliutka
  ) {
    return hand.map(
      (_, index) =>
        index
    );
  }

  const count =
    Math.min(
      game.leadCount || 1,
      hand.length
    );

  const winningIndex =
    winningPlayIndex(game);

  const currentWinner =
    game.table[
      winningIndex
    ];

  /*
    ცდილობს მიმდინარე გამარჯვებულის
    გაჭრას ყველაზე იაფი კომბინაციით.
  */

  const cut =
    currentWinner
      ? cheapestCut(
          hand,
          count,
          currentWinner.cards,
          game.trump
        )
      : null;

  if (cut) {
    return cut;
  }

  /*
    ვერ ჭრის:
    აგდებს ყველაზე დაბალქულიანებს.
    პრიორიტეტი 6/7/8/9.
  */

  return lowestDiscard(
    hand,
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

  const player =
    room.players[
      room.game.currentTurnIndex
    ];

  if (
    !player ||
    !player.isBot
  ) {
    return;
  }

  clearTimeout(
    room.botTimer
  );

  io
    .to(room.id)
    .emit(
      'botThinking',
      {
        playerId:
          player.id,

        text:
          '🤖 BOT ფიქრობს...'
      }
    );

  /*
    1.2 - 1.5 sec
  */

  const delay =
    1200 +
    Math.floor(
      Math.random() *
      301
    );

  room.botTimer =
    setTimeout(
      () => {
        botTurn(
          room,
          player
        );
      },

      delay
    );
}

/* =========================================================
   VALIDATION

   პირველი:
   1-5 კარტი,
   აუცილებლად ერთი მასტი.

   პასუხი:
   ზუსტად N კარტი.
   მასტების შერევა ნებადართულია.
========================================================= */

function validateSelection(
  game,
  hand,
  indexes
) {
  if (
    !Array.isArray(indexes) ||
    !indexes.length
  ) {
    return {
      ok: false,
      message:
        'აირჩიე მინიმუმ 1 კარტი.'
    };
  }

  if (
    indexes.length > 5 ||
    new Set(indexes).size !==
      indexes.length
  ) {
    return {
      ok: false,
      message:
        'არასწორი არჩევანი.'
    };
  }

  const cards =
    indexes.map(
      index =>
        hand[index]
    );

  if (
    cards.some(
      card => !card
    )
  ) {
    return {
      ok: false,
      message:
        'არჩეული კარტი ვერ მოიძებნა.'
    };
  }

  /*
    FIRST PLAYER
  */

  if (
    !game.table.length
  ) {
    const sameSuit =
      cards.every(
        card =>
          card.suit ===
          cards[0].suit
      );

    if (!sameSuit) {
      return {
        ok: false,

        message:
          'პირველი სვლის კარტები ერთი მასტის უნდა იყოს.'
      };
    }

    return {
      ok: true,
      cards
    };
  }

  /*
    MALIUTKA
  */

  if (
    game.leadMaliutka
  ) {
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
      cards
    };
  }

  /*
    NORMAL RESPONSE:
    ONLY EXACT NUMBER MATTERS.

    SUITS MAY BE MIXED.
  */

  const required =
    game.leadCount || 1;

  if (
    cards.length !==
    required
  ) {
    return {
      ok: false,

      message:
        `უნდა მონიშნო ზუსტად ${required} კარტი.`
    };
  }

  return {
    ok: true,
    cards
  };
}

/* =========================================================
   APPLY PLAY
========================================================= */

function applyPlay(
  room,
  player,
  indexes
) {
  const game =
    room.game;

  const hand =
    game.hands[player.id] ||
    [];

  const valid =
    validateSelection(
      game,
      hand,
      indexes
    );

  if (
    !valid.ok
  ) {
    return valid;
  }

  /*
    პირველი ჩამოსვლა
  */

  if (
    !game.table.length
  ) {
    game.leadCount =
      valid.cards.length;

    game.leadMaliutka =
      valid.cards.length === 5;
  }

  /*
    Remove cards from hand.
  */

  game.hands[player.id] =
    hand.filter(
      (_, index) =>
        !indexes.includes(index)
    );

  /*
    Put cards on table.
  */

  game.table.push({
    playerId:
      player.id,

    playerName:
      player.name,

    cards:
      valid.cards
  });

  io
    .to(room.id)
    .emit(
      'sfxEvent',
      {
        type:
          game.table.length > 1
            ? 'cut'
            : 'play'
      }
    );

  /*
    ყველა მოთამაშემ ითამაშა.
  */

  if (
    game.table.length ===
    room.players.length
  ) {
    completeTrick(room);
  } else {
    setTurn(
      room,

      (
        game.currentTurnIndex +
        1
      ) %
      room.players.length
    );

    broadcast(room);

    scheduleBot(room);
  }

  return {
    ok: true
  };
}

/* =========================================================
   BOT TURN
========================================================= */

function botTurn(
  room,
  bot
) {
  if (
    !rooms.has(room.id) ||
    !room.game ||
    room.game.processing ||
    room.game.gameOver
  ) {
    return;
  }

  const active =
    room.players[
      room.game.currentTurnIndex
    ];

  if (
    !active ||
    active.id !== bot.id ||
    !active.isBot
  ) {
    return;
  }

  const indexes =
    botChoice(
      room,
      bot
    );

  applyPlay(
    room,
    bot,
    indexes
  );
}

/* =========================================================
   TIMER AUTO PLAY
========================================================= */

function autoPlayCurrent(room) {
  if (
    !rooms.has(room.id) ||
    !room.game ||
    room.game.processing ||
    room.game.gameOver
  ) {
    return;
  }

  const player =
    room.players[
      room.game.currentTurnIndex
    ];

  if (!player) {
    return;
  }

  const hand =
    room.game.hands[
      player.id
    ] || [];

  if (
    !hand.length
  ) {
    return;
  }

  const indexes =
    botChoice(
      room,
      player
    );

  io
    .to(room.id)
    .emit(
      'quickMessage',
      {
        playerId:
          player.id,

        playerName:
          player.name,

        text:
          '⏱ ავტომატური სვლა'
      }
    );

  applyPlay(
    room,
    player,
    indexes
  );
}

/* =========================================================
   SOCKET
========================================================= */

io.on(
  'connection',

  socket => {

    /* -----------------------------------------------------
       JOIN TABLE
    ----------------------------------------------------- */

    socket.on(
      'joinTable',

      data => {
        const name =
          cleanName(
            data &&
            data.name
          );

        if (!name) {
          socket.emit(
            'errorMessage',
            'შეიყვანე მოთამაშის სახელი.'
          );

          return;
        }

        if (
          socket.roomId
        ) {
          socket.emit(
            'errorMessage',
            'უკვე მაგიდაზე ხარ.'
          );

          return;
        }

        let capacity =
          parseInt(
            data.capacity,
            10
          );

        if (
          !CAPACITIES.includes(
            capacity
          )
        ) {
          capacity = 3;
        }

        let parties =
          parseInt(
            data.parties,
            10
          );

        if (
          !Number.isInteger(
            parties
          )
        ) {
          parties = 1;
        }

        parties =
          Math.max(
            1,

            Math.min(
              MAX_PARTIES,
              parties
            )
          );

        let stake =
          Number(
            data.stake
          );

        if (
          !STAKES.includes(
            stake
          )
        ) {
          stake = 5;
        }

        const tester =
          isTesterName(name);

        let room =
          Array.from(
            rooms.values()
          ).find(
            candidate =>
              !candidate.game &&

              candidate.capacity ===
                capacity &&

              candidate.parties ===
                parties &&

              candidate.stake ===
                stake &&

              candidate.players.length <
                candidate.capacity
          );

        if (!room) {
          room =
            createRoom(
              capacity,
              parties,
              stake
            );
        }

        const userKey =
          String(
            data &&
            data.userKey ||
            makeId('user')
          ).slice(
            0,
            100
          );

        const playerId =
          makeId('player');

        socket.roomId =
          room.id;

        socket.data.playerId =
          playerId;

        socket.data.userKey =
          userKey;

        socket.join(
          room.id
        );

        room.players.push({
          id:
            playerId,

          socketId:
            socket.id,

          userKey,

          name,

          isBot:
            false,

          isTester:
            tester,

          balance:
            START_BALANCE,

          avatar:
            '🦊',

          disconnectedAt:
            null
        });

        socket.emit(
          'sessionKey',
          {
            userKey
          }
        );

        /*
          TESTER:
          ავტომატურად შეავსოს BOT-ებით.
        */

        if (tester) {
          let number = 1;

          while (
            room.players.length <
            room.capacity
          ) {
            room.players.push({
              id:
                makeId('bot'),

              socketId:
                null,

              userKey:
                null,

              name:
                `BOT ${number++}`,

              isBot:
                true,

              isTester:
                false,

              balance:
                START_BALANCE,

              avatar:
                '🤖',

              disconnectedAt:
                null
            });
          }
        }

        /*
          START GAME
        */

        if (
          room.players.length ===
          room.capacity
        ) {
          room.game =
            startHand(room);

          setTurn(
            room,
            room.game.currentTurnIndex
          );

          broadcast(room);

          io
            .to(room.id)
            .emit(
              'sfxEvent',
              {
                type: 'deal'
              }
            );

          scheduleBot(room);
        } else {
          io
            .to(room.id)
            .emit(
              'waitingForPlayers',
              {
                current:
                  room.players.length,

                max:
                  room.capacity,

                stake:
                  room.stake
              }
            );
        }
      }
    );

    /* -----------------------------------------------------
       SESSION RESTORE
    ----------------------------------------------------- */

    socket.on(
      'restoreSession',

      data => {
        const userKey =
          String(
            data &&
            data.userKey ||
            ''
          );

        if (!userKey) {
          return;
        }

        for (
          const room of
          rooms.values()
        ) {
          const player =
            room.players.find(
              candidate =>
                !candidate.isBot &&

                candidate.userKey ===
                  userKey &&

                candidate.disconnectedAt &&

                Date.now() -
                  candidate.disconnectedAt <=
                  RECONNECT_MS
            );

          if (!player) {
            continue;
          }

          player.socketId =
            socket.id;

          player.disconnectedAt =
            null;

          player.isBot =
            false;

          socket.roomId =
            room.id;

          socket.data.playerId =
            player.id;

          socket.data.userKey =
            userKey;

          socket.join(
            room.id
          );

          socket.emit(
            'sessionRecovered'
          );

          broadcast(room);

          if (
            room.game &&
            room.players[
              room.game
                .currentTurnIndex
            ]?.id ===
              player.id
          ) {
            setTurn(
              room,
              room.game
                .currentTurnIndex
            );
          }

          return;
        }

        socket.emit(
          'sessionInvalid'
        );
      }
    );

    /* -----------------------------------------------------
       PLAY CARDS
    ----------------------------------------------------- */

    socket.on(
      'playCards',

      data => {
        const room =
          socket.roomId
            ? rooms.get(
                socket.roomId
              )
            : null;

        if (
          !room ||
          !room.game ||
          room.game.processing ||
          room.game.gameOver
        ) {
          return;
        }

        const active =
          room.players[
            room.game
              .currentTurnIndex
          ];

        if (
          !active ||
          active.socketId !==
            socket.id
        ) {
          socket.emit(
            'errorMessage',
            'ახლა შენი სვლა არ არის.'
          );

          return;
        }

        const hand =
          room.game.hands[
            active.id
          ] || [];

        let indexes =
          Array.isArray(
            data &&
            data.cardIndices
          )
            ? [
                ...new Set(
                  data.cardIndices
                )
              ]
            : [];

        indexes =
          indexes
            .filter(
              index =>
                Number.isInteger(
                  index
                ) &&

                index >= 0 &&

                index <
                  hand.length
            )
            .sort(
              (a, b) =>
                a - b
            );

        const result =
          applyPlay(
            room,
            active,
            indexes
          );

        if (
          !result.ok
        ) {
          socket.emit(
            'errorMessage',
            result.message
          );
        }
      }
    );

    /* -----------------------------------------------------
       THROWABLE
    ----------------------------------------------------- */

    socket.on(
      'throwable',

      data => {
        const room =
          socket.roomId
            ? rooms.get(
                socket.roomId
              )
            : null;

        if (!room) {
          return;
        }

        const from =
          room.players.find(
            player =>
              player.socketId ===
              socket.id
          );

        const target =
          room.players.find(
            player =>
              player.id ===
              String(
                data &&
                data.targetId ||
                ''
              )
          );

        const item =
          String(
            data &&
            data.item ||
            ''
          );

        if (
          !from ||
          !target ||
          from.id ===
            target.id ||
          ![
            '🍅',
            '🥚',
            '🧻'
          ].includes(item)
        ) {
          return;
        }

        io
          .to(room.id)
          .emit(
            'throwable',
            {
              fromId:
                from.id,

              targetId:
                target.id,

              item
            }
          );
      }
    );

    /* -----------------------------------------------------
       QUICK MESSAGE
    ----------------------------------------------------- */

    socket.on(
      'quickMessage',

      data => {
        const room =
          socket.roomId
            ? rooms.get(
                socket.roomId
              )
            : null;

        if (!room) {
          return;
        }

        const player =
          room.players.find(
            candidate =>
              candidate.socketId ===
              socket.id
          );

        if (!player) {
          return;
        }

        const allowed = [
          '👍 კარგი იყო',
          '⚡ სწრაფად',
          '😂 ჰაჰა',
          '🔥 მაგარია',
          '👏 ბრავო',
          '🤝 წარმატებები',
          'სიქიიიიიმ!',
          'ყვერო, მალე!',
          'რას შვრები, ძმაო?!',
          'ვაჰ, კოზირი!'
        ];

        const text =
          String(
            data &&
            data.text ||
            ''
          );

        if (
          !allowed.includes(
            text
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
                player.id,

              playerName:
                player.name,

              text
            }
          );
      }
    );

    /* -----------------------------------------------------
       DISCONNECT — 45 SEC RECOVERY
    ----------------------------------------------------- */

    socket.on(
      'disconnect',

      () => {
        const room =
          socket.roomId
            ? rooms.get(
                socket.roomId
              )
            : null;

        if (!room) {
          return;
        }

        const player =
          room.players.find(
            candidate =>
              candidate.socketId ===
              socket.id
          );

        if (!player) {
          return;
        }

        /*
          თამაში ჯერ არ დაწყებულა.
        */

        if (!room.game) {
          room.players =
            room.players.filter(
              candidate =>
                candidate.id !==
                player.id
            );

          if (
            !room.players.some(
              candidate =>
                !candidate.isBot
            )
          ) {
            clearTimeout(
              room.timer
            );

            clearTimeout(
              room.botTimer
            );

            clearTimeout(
              room.trickTimer
            );

            rooms.delete(
              room.id
            );
          }

          return;
        }

        /*
          მიმდინარე თამაში:
          მოთამაშეს 45 წამს ვუტოვებთ.
        */

        player.socketId =
          null;

        player.disconnectedAt =
          Date.now();

        reconnectSessions.set(
          player.userKey,
          {
            roomId:
              room.id,

            playerId:
              player.id,

            expiresAt:
              Date.now() +
              RECONNECT_MS
          }
        );

        setTimeout(
          () => {
            if (
              !rooms.has(
                room.id
              )
            ) {
              return;
            }

            if (
              !player.disconnectedAt
            ) {
              return;
            }

            if (
              Date.now() -
                player.disconnectedAt <
              RECONNECT_MS
            ) {
              return;
            }

            /*
              45 sec გავიდა:
              BOT takeover.
            */

            player.isBot =
              true;

            if (
              !player.name.includes(
                ' · BOT'
              )
            ) {
              player.name +=
                ' · BOT';
            }

            if (
              room.game &&
              room.players[
                room.game
                  .currentTurnIndex
              ]?.id ===
                player.id
            ) {
              scheduleBot(room);
            }

            broadcast(room);
          },

          RECONNECT_MS + 50
        );
      }
    );
  }
);

/* =========================================================
   MONOLITHIC HTML
========================================================= */

const PAGE = String.raw`
<!doctype html>

<html lang="ka">

<head>

<meta charset="utf-8">

<meta
  name="viewport"
  content="width=device-width,initial-scale=1,viewport-fit=cover"
>

<title>Written Bura</title>

<script src="/socket.io/socket.io.js"></script>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  min-height: 100%;
}

body {
  font-family:
    Arial,
    sans-serif;

  color: #eef7f2;

  background:
    radial-gradient(
      circle at 50% -10%,
      rgba(52,211,153,.16),
      transparent 36%
    ),
    linear-gradient(
      160deg,
      #050a09,
      #091412 52%,
      #07100e
    );

  overflow-x: hidden;
}

button,
input,
select {
  font: inherit;
}

:root {
  --gold: #e9c46a;
  --gold2: #ffdc86;
  --green: #34d399;
  --green2: #10b981;
  --muted: #9fb2aa;
  --line: rgba(255,255,255,.12);
}

.glass {
  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.08),
      rgba(255,255,255,.025)
    );

  border:
    1px solid
    var(--line);

  backdrop-filter:
    blur(18px);

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.3);
}

/* ================================
   LOBBY
================================ */

#lobby {
  min-height: 100vh;
  padding: 24px;
}

.shell {
  width:
    min(
      1160px,
      100%
    );

  margin: auto;
}

.top {
  display: flex;

  justify-content:
    space-between;

  align-items:
    center;

  gap: 16px;

  margin-bottom:
    24px;
}

.brand {
  font-size:
    26px;

  font-weight:
    900;
}

.brand span {
  color:
    var(--gold);
}

.testerHint {
  color:
    var(--muted);

  font-size:
    12px;
}

.hero {
  display:
    grid;

  grid-template-columns:
    1.2fr .8fr;

  gap:
    18px;
}

.heroCard,
.joinCard {
  padding:
    28px;

  border-radius:
    24px;
}

.heroCard h1 {
  margin:
    20px 0 12px;

  font-size:
    44px;

  line-height:
    1.08;
}

.heroCard p {
  color:
    var(--muted);

  line-height:
    1.7;
}

.eyebrow {
  display:
    inline-flex;

  padding:
    7px 11px;

  border-radius:
    999px;

  color:
    #86efc2;

  border:
    1px solid
    rgba(52,211,153,.24);

  background:
    rgba(52,211,153,.10);

  font-size:
    11px;

  font-weight:
    800;
}

.field {
  margin:
    12px 0;
}

.field label {
  display:
    block;

  margin-bottom:
    7px;

  color:
    #b9cbc3;

  font-size:
    11px;

  font-weight:
    700;
}

.field input,
.field select {
  width:
    100%;

  height:
    44px;

  border-radius:
    12px;

  border:
    1px solid
    var(--line);

  background:
    rgba(3,9,8,.65);

  color:
    white;

  padding:
    0 12px;

  outline:
    none;
}

.row2 {
  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    10px;
}

.primary {
  width:
    100%;

  height:
    46px;

  border:
    0;

  border-radius:
    13px;

  background:
    linear-gradient(
      135deg,
      var(--green),
      var(--green2)
    );

  color:
    #04271b;

  font-weight:
    900;

  cursor:
    pointer;
}

.wait {
  min-height:
    20px;

  margin-top:
    10px;

  color:
    var(--gold2);

  font-size:
    12px;
}

.stakes {
  display:
    grid;

  grid-template-columns:
    repeat(5,1fr);

  gap:
    10px;

  margin-top:
    18px;
}

.stake {
  padding:
    16px;

  border-radius:
    16px;

  border:
    1px solid
    var(--line);

  background:
    rgba(255,255,255,.035);

  color:
    var(--muted);

  cursor:
    pointer;

  transition:
    .2s;
}

.stake:hover,
.stake.active {
  transform:
    translateY(-4px);

  border-color:
    rgba(233,196,106,.7);

  background:
    rgba(233,196,106,.10);

  color:
    var(--gold2);
}

.stake b {
  display:
    block;

  font-size:
    20px;
}

/* ================================
   GAME
================================ */

#game {
  display:
    none;

  min-height:
    100vh;

  padding:
    14px;
}

.gameShell {
  width:
    min(
      1500px,
      100%
    );

  margin:
    auto;
}

.gameTop {
  display:
    grid;

  grid-template-columns:
    1fr auto auto;

  gap:
    12px;

  align-items:
    center;

  margin-bottom:
    10px;
}

.titleBlock {
  padding:
    14px 16px;

  border-radius:
    16px;
}

.titleBlock b {
  font-size:
    18px;
}

.titleBlock span {
  display:
    block;

  color:
    var(--muted);

  font-size:
    11px;
}

.hud {
  display:
    flex;

  gap:
    8px;

  flex-wrap:
    wrap;
}

.hudBox {
  min-width:
    82px;

  padding:
    10px 12px;

  border-radius:
    14px;

  text-align:
    center;
}

.hudBox small {
  display:
    block;

  color:
    var(--muted);

  font-size:
    9px;
}

.hudBox b {
  color:
    var(--gold2);
}

.sfxBtn,
.exitBtn {
  height:
    42px;

  padding:
    0 14px;

  border-radius:
    12px;

  border:
    1px solid
    var(--line);

  color:
    white;

  background:
    rgba(255,255,255,.05);

  cursor:
    pointer;
}

.status {
  min-height:
    38px;

  display:
    grid;

  place-items:
    center;

  color:
    var(--gold2);

  font-weight:
    800;
}

.layout {
  display:
    grid;

  grid-template-columns:
    minmax(0,1fr)
    300px;

  gap:
    14px;
}

/* ================================
   TABLE
================================ */

.tableStage {
  position:
    relative;

  height:
    700px;

  overflow:
    hidden;

  border-radius:
    26px;

  background:
    #050908;
}

.tableWood {
  position:
    absolute;

  inset:
    32px;

  border-radius:
    50%;

  background:
    radial-gradient(
      ellipse,
      #81501f,
      #4b2912 58%,
      #261408 100%
    );

  box-shadow:
    inset 0 0 0 10px
    rgba(255,220,150,.08),
    0 30px 80px
    rgba(0,0,0,.65);
}

.felt {
  position:
    absolute;

  inset:
    74px;

  border-radius:
    50%;

  background:
    radial-gradient(
      ellipse,
      #147455,
      #0c4f3c 55%,
      #07382c
    );

  box-shadow:
    inset 0 0 50px
    rgba(0,0,0,.45);
}

/* ================================
   PLAYERS
================================ */

.seat {
  position:
    absolute;

  width:
    140px;

  transform:
    translate(
      -50%,
      -50%
    );

  z-index:
    10;

  text-align:
    center;
}

.seatBox {
  position:
    relative;
}

.avatar {
  position:
    relative;

  width:
    54px;

  height:
    54px;

  margin:
    auto;

  display:
    grid;

  place-items:
    center;

  border-radius:
    50%;

  border:
    3px solid
    rgba(233,196,106,.55);

  background:
    linear-gradient(
      145deg,
      #26332f,
      #0d1513
    );

  font-size:
    27px;

  cursor:
    pointer;

  box-shadow:
    0 8px 20px
    rgba(0,0,0,.45);
}

.seat.current .avatar {
  box-shadow:
    0 0 25px
    rgba(255,220,100,.85),
    0 8px 20px
    rgba(0,0,0,.45);
}

.timerRing {
  --turn: 0%;

  position:
    absolute;

  inset:
    -7px;

  border-radius:
    50%;

  background:
    conic-gradient(
      #ffd76a
      var(--turn),
      rgba(255,255,255,.12)
      0
    );

  z-index:
    -1;
}

.timerRing::after {
  content:
    '';

  position:
    absolute;

  inset:
    4px;

  border-radius:
    50%;

  background:
    #101916;
}

.seatName {
  margin-top:
    6px;

  font-size:
    11px;

  font-weight:
    800;
}

.seatInfo {
  color:
    var(--muted);

  font-size:
    8px;

  margin-top:
    2px;
}

.backs {
  display:
    flex;

  justify-content:
    center;

  margin-top:
    5px;
}

.back {
  width:
    18px;

  height:
    27px;

  margin-left:
    -8px;

  border-radius:
    3px;

  border:
    1px solid
    rgba(255,255,255,.35);

  background:
    repeating-linear-gradient(
      45deg,
      #7b1625,
      #7b1625 3px,
      #b2293c 3px,
      #b2293c 6px
    );
}

/* ================================
   DECK
================================ */

.deckZone {
  position:
    absolute;

  left:
    50%;

  top:
    42%;

  transform:
    translate(
      -50%,
      -50%
    );

  display:
    flex;

  align-items:
    center;

  gap:
    18px;

  z-index:
    5;
}

.deckStack,
.trumpSlot {
  width:
    58px;

  height:
    82px;

  border-radius:
    8px;
}

.deckStack {
  background:
    repeating-linear-gradient(
      45deg,
      #6d1020,
      #6d1020 5px,
      #b1243d 5px,
      #b1243d 10px
    );

  border:
    3px solid
    white;

  box-shadow:
    4px 4px 0
    rgba(255,255,255,.18),
    8px 8px 0
    rgba(0,0,0,.18);
}

.deckLabel {
  margin-top:
    5px;

  text-align:
    center;

  color:
    var(--muted);

  font-size:
    9px;
}

/* ================================
   TABLE CARDS
================================ */

.tableCards {
  position:
    absolute;

  left:
    50%;

  top:
    58%;

  transform:
    translate(
      -50%,
      -50%
    );

  display:
    flex;

  gap:
    12px;

  z-index:
    8;

  max-width:
    75%;

  justify-content:
    center;

  flex-wrap:
    wrap;
}

.playGroup {
  display:
    flex;

  position:
    relative;

  padding-top:
    20px;

  transition:
    transform .3s;
}

.playGroup .card {
  margin-left:
    -15px;

  animation:
    cardToTable
    .45s
    cubic-bezier(.2,.8,.2,1);
}

.playGroup .card:first-of-type {
  margin-left:
    0;
}

.playName {
  position:
    absolute;

  top:
    0;

  left:
    50%;

  transform:
    translateX(-50%);

  white-space:
    nowrap;

  font-size:
    9px;

  color:
    white;
}

/*
  WINNER GLOW DURING 1.8 SEC DELAY
*/

.playGroup.winner .card {
  box-shadow:
    0 0 0 2px
    rgba(255,218,100,.95),
    0 0 22px
    rgba(255,205,70,.95),
    0 0 45px
    rgba(255,190,50,.55);

  animation:
    winnerGlow
    .75s
    ease-in-out
    infinite alternate;
}

@keyframes winnerGlow {
  from {
    filter:
      brightness(1);
  }

  to {
    filter:
      brightness(1.25);
  }
}

@keyframes cardToTable {
  from {
    opacity:
      0;

    transform:
      translateY(80px)
      scale(.75)
      rotate(-12deg);
  }

  to {
    opacity:
      1;

    transform:
      translateY(0)
      scale(1)
      rotate(0);
  }
}

/* ================================
   CARDS
================================ */

.card {
  width:
    70px;

  height:
    102px;

  padding:
    6px;

  border-radius:
    10px;

  border:
    1px solid
    rgba(0,0,0,.2);

  background:
    white;

  display:
    flex;

  flex-direction:
    column;

  justify-content:
    space-between;

  font-weight:
    900;

  box-shadow:
    0 8px 22px
    rgba(0,0,0,.38);

  user-select:
    none;

  touch-action:
    none;
}

.cardTop,
.cardBottom {
  display:
    flex;

  gap:
    3px;

  font-size:
    13px;

  line-height:
    1;
}

.cardCenter {
  text-align:
    center;

  font-size:
    34px;
}

.cardBottom {
  transform:
    rotate(180deg);
}

.suit-spades {
  color:
    #050505;
}

.suit-clubs {
  color:
    #007a58;

  background:
    linear-gradient(
      white,
      #f0fbf6
    );
}

.suit-diamonds {
  color:
    #0a2a66;

  background:
    linear-gradient(
      white,
      #f1f5ff
    );
}

.suit-hearts {
  color:
    #74152c;

  background:
    linear-gradient(
      white,
      #fff2f5
    );
}

/* ================================
   HAND
================================ */

.handZone {
  position:
    absolute;

  left:
    50%;

  bottom:
    15px;

  transform:
    translateX(-50%);

  width:
    min(
      850px,
      95%
    );

  z-index:
    15;

  text-align:
    center;
}

.hand {
  height:
    135px;

  display:
    flex;

  justify-content:
    center;

  align-items:
    flex-end;

  position:
    relative;
}

.hand .card {
  position:
    relative;

  margin-left:
    -18px;

  transform-origin:
    50% 120%;

  transition:
    transform .2s,
    filter .2s,
    box-shadow .2s;

  animation:
    dealFly
    .5s
    cubic-bezier(.2,.8,.2,1);
}

.hand .card:first-child {
  margin-left:
    0;
}

.hand .card:hover {
  transform:
    translateY(-18px)
    scale(1.05)
    !important;

  z-index:
    30;
}

.hand .card.selected {
  transform:
    translateY(-28px)
    scale(1.06)
    !important;

  z-index:
    40;

  box-shadow:
    0 0 0 3px
    rgba(52,211,153,.7),
    0 15px 30px
    rgba(0,0,0,.4);
}

@keyframes dealFly {
  from {
    opacity:
      0;

    transform:
      translate(
        0,
        -250px
      )
      scale(.4);
  }

  to {
    opacity:
      1;
  }
}

.playBtn {
  min-width:
    200px;

  height:
    44px;

  border:
    0;

  border-radius:
    999px;

  background:
    linear-gradient(
      135deg,
      var(--green),
      var(--green2)
    );

  color:
    #02261a;

  font-weight:
    900;

  cursor:
    pointer;
}

.playBtn:disabled {
  background:
    #2b3431;

  color:
    #72837d;

  cursor:
    not-allowed;
}

.selectedCount {
  margin-top:
    5px;

  color:
    var(--muted);

  font-size:
    11px;
}

/* ================================
   SIDE PANELS
================================ */

.scorePanel,
.quickPanel {
  padding:
    14px;

  border-radius:
    20px;

  margin-bottom:
    12px;
}

.scoreHead {
  display:
    flex;

  justify-content:
    space-between;

  gap:
    8px;

  align-items:
    center;

  margin-bottom:
    8px;
}

.scoreHead span {
  color:
    var(--muted);

  font-size:
    9px;
}

.scoreRow {
  display:
    grid;

  grid-template-columns:
    35px 1fr 55px 55px;

  gap:
    5px;

  padding:
    9px 4px;

  border-top:
    1px solid
    var(--line);

  font-size:
    10px;
}

.scoreRow .total {
  color:
    var(--gold2);

  font-weight:
    900;

  text-align:
    right;
}

.history {
  margin-top:
    12px;

  max-height:
    300px;

  overflow-y:
    auto;
}

.historyRow {
  padding:
    8px 4px;

  border-top:
    1px solid
    var(--line);

  color:
    #b9cbc3;

  font-size:
    9px;

  line-height:
    1.6;
}

.quickGrid {
  display:
    grid;

  grid-template-columns:
    1fr 1fr;

  gap:
    6px;

  margin-top:
    8px;
}

.quickBtn {
  border:
    1px solid
    var(--line);

  background:
    rgba(255,255,255,.04);

  color:
    white;

  border-radius:
    10px;

  padding:
    8px;

  font-size:
    9px;

  cursor:
    pointer;
}

.reactionBubble {
  position:
    absolute;

  left:
    50%;

  bottom:
    100%;

  transform:
    translateX(-50%);

  padding:
    6px 8px;

  border-radius:
    10px;

  background:
    white;

  color:
    #101614;

  font-size:
    10px;

  white-space:
    nowrap;

  z-index:
    100;

  animation:
    reactionBubble
    2.5s
    forwards;
}

@keyframes reactionBubble {
  0% {
    opacity:
      0;

    transform:
      translate(
        -50%,
        10px
      );
  }

  15%,
  80% {
    opacity:
      1;
  }

  100% {
    opacity:
      0;

    transform:
      translate(
        -50%,
        -15px
      );
  }
}

/* ================================
   MOBILE
================================ */

@media (
  max-width: 1100px
) {
  .layout {
    grid-template-columns:
      1fr;
  }

  .tableStage {
    height:
      650px;
  }
}

@media (
  max-width: 800px
) {
  #lobby {
    padding:
      14px;
  }

  .hero {
    grid-template-columns:
      1fr;
  }

  .heroCard h1 {
    font-size:
      34px;
  }

  .gameTop {
    grid-template-columns:
      1fr;
  }

  .tableStage {
    height:
      590px;
  }

  .tableWood {
    inset:
      38px 20px 70px;
  }

  .felt {
    inset:
      75px 48px 115px;
  }

  .card {
    width:
      58px;

    height:
      86px;
  }

  .cardCenter {
    font-size:
      27px;
  }

  .hand {
    height:
      120px;
  }
}

@media (
  max-width: 520px
) {
  .heroCard,
  .joinCard {
    padding:
      20px;
  }

  .row2 {
    grid-template-columns:
      1fr;
  }

  .stakes {
    grid-template-columns:
      1fr 1fr;
  }

  .tableStage {
    height:
      545px;

    border-radius:
      18px;
  }

  .tableWood {
    inset:
      30px 6px 65px;
  }

  .felt {
    inset:
      70px 25px 118px;
  }

  .seat {
    width:
      100px;
  }

  .avatar {
    width:
      40px;

    height:
      40px;

    font-size:
      20px;
  }

  .seatName {
    font-size:
      9px;
  }

  .seatInfo {
    font-size:
      7px;
  }

  .tableCards {
    top:
      55%;

    max-width:
      82%;

    gap:
      5px;
  }

  .card {
    width:
      50px;

    height:
      74px;

    padding:
      4px;
  }

  .cardCenter {
    font-size:
      22px;
  }

  /*
    MOBILE FAN OUT
  */

  .hand {
    height:
      105px;
  }

  .hand .card {
    margin-left:
      -18px;
  }

  .quickGrid {
    grid-template-columns:
      1fr;
  }
}

</style>

</head>

<body>

<section id="lobby">

<div class="shell">

  <div class="top">

    <div class="brand">
      WRITTEN
      <span>BURA</span>
    </div>

    <div class="testerHint">
      TEST:
      <b>saba123</b>
      — BOT-ებით ავტომატურად იწყება
    </div>

  </div>

  <div class="hero">

    <div class="heroCard glass">

      <div class="eyebrow">
        LIVE CARD ROOM
      </div>

      <h1>
        წერითი ბურა
      </h1>

      <p>
        პირველი მოთამაშე ჩამოდის
        1–5 ერთი მასტის კარტით.
        5 ერთმასტიანი კარტი არის
        მალიუტკა.
        საპასუხო მოთამაშემ უნდა
        ჩამოიტანოს ზუსტად იგივე
        რაოდენობა, თუმცა საპასუხო
        კარტები შეიძლება სხვადასხვა
        მასტის იყოს.
      </p>

    </div>

    <div class="joinCard glass">

      <h2>
        მაგიდაზე შესვლა
      </h2>

      <div class="field">

        <label>
          მოთამაშის სახელი
        </label>

        <input
          id="playerName"
          value="saba123"
          maxlength="20"
        >

      </div>

      <div class="row2">

        <div class="field">

          <label>
            მოთამაშეები
          </label>

          <select id="capacity">

            <option value="3">
              3 მოთამაშე
            </option>

            <option value="4">
              4 მოთამაშე
            </option>

          </select>

        </div>

        <div class="field">

          <label>
            პარტიები
          </label>

          <select id="parties">

            <option value="1">
              1 პარტია
            </option>

            <option value="2">
              2 პარტია
            </option>

            <option value="3">
              3 პარტია
            </option>

            <option value="4">
              4 პარტია
            </option>

          </select>

        </div>

      </div>

      <input
        type="hidden"
        id="stake"
        value="5"
      >

      <button
        class="primary"
        onclick="joinGame()"
      >
        თამაშში შესვლა
      </button>

      <div
        id="wait"
        class="wait"
      ></div>

    </div>

  </div>

  <div class="stakes">

    <button
      class="stake active"
      onclick="chooseStake(5,this)"
    >
      <b>$5</b>
      CLASSIC
    </button>

    <button
      class="stake"
      onclick="chooseStake(10,this)"
    >
      <b>$10</b>
      STANDARD
    </button>

    <button
      class="stake"
      onclick="chooseStake(25,this)"
    >
      <b>$25</b>
      PREMIUM
    </button>

    <button
      class="stake"
      onclick="chooseStake(50,this)"
    >
      <b>$50</b>
      VIP
    </button>

    <button
      class="stake"
      onclick="chooseStake(100,this)"
    >
      <b>$100</b>
      ELITE
    </button>

  </div>

</div>

</section>

<section id="game">

<div class="gameShell">

  <div class="gameTop">

    <div class="titleBlock glass">

      <b>
        WRITTEN BURA
      </b>

      <span id="tableSub">
        Live Table
      </span>

    </div>

    <div class="hud">

      <div class="hudBox glass">
        <small>პარტია</small>
        <b id="hudParty">-</b>
      </div>

      <div class="hudBox glass">
        <small>ხელი</small>
        <b id="hudHand">-</b>
      </div>

      <div class="hudBox glass">
        <small>კოზირი</small>
        <b id="hudTrump">-</b>
      </div>

      <div class="hudBox glass">
        <small>დასტა</small>
        <b id="hudDeck">-</b>
      </div>

      <div class="hudBox glass">
        <small>ფსონი</small>
        <b id="hudStake">-</b>
      </div>

    </div>

    <div>

      <button
        id="sfxBtn"
        class="sfxBtn"
        onclick="toggleSfx()"
      >
        🔊 SFX
      </button>

      <button
        class="exitBtn"
        onclick="location.reload()"
      >
        გასვლა
      </button>

    </div>

  </div>

  <div
    id="status"
    class="status"
  ></div>

  <div class="layout">

    <div>

      <div class="tableStage">

        <div class="tableWood"></div>

        <div
          id="felt"
          class="felt"
        ></div>

        <div class="deckZone">

          <div>

            <div
              id="deckStack"
              class="deckStack"
            ></div>

            <div class="deckLabel">
              Deck
              <span id="centerDeck">
                36
              </span>
            </div>

          </div>

          <div>

            <div
              id="trumpSlot"
              class="trumpSlot"
            ></div>

            <div class="deckLabel">
              კოზირი
            </div>

          </div>

        </div>

        <div id="players"></div>

        <div
          id="tableCards"
          class="tableCards"
        ></div>

        <div class="handZone">

          <div
            id="myCards"
            class="hand"
          ></div>

          <button
            id="playBtn"
            class="playBtn"
            disabled
            onclick="playSelected()"
          >
            სვლის გაკეთება
          </button>

          <div
            id="selectedCount"
            class="selectedCount"
          >
            არჩეული: 0 / 5
          </div>

        </div>

      </div>

    </div>

    <aside>

      <div class="scorePanel glass">

        <div class="scoreHead">

          <b>
            🏆 SCOREBOARD
          </b>

          <span>
            Round history
          </span>

        </div>

        <div id="score"></div>

        <div
          id="history"
          class="history"
        ></div>

      </div>

      <div class="quickPanel glass">

        <b>
          💬 რეაქციები
        </b>

        <div class="quickGrid">

          <button
            class="quickBtn"
            onclick="sendQuick('სიქიიიიიმ!')"
          >
            სიქიიიიიმ!
          </button>

          <button
            class="quickBtn"
            onclick="sendQuick('ყვერო, მალე!')"
          >
            ყვერო, მალე!
          </button>

          <button
            class="quickBtn"
            onclick="sendQuick('რას შვრები, ძმაო?!')"
          >
            რას შვრები?!
          </button>

          <button
            class="quickBtn"
            onclick="sendQuick('ვაჰ, კოზირი!')"
          >
            ვაჰ, კოზირი!
          </button>

        </div>

      </div>

    </aside>

  </div>

</div>

</section>

<script>

'use strict';

const socket =
  io();

let current =
  null;

let selected =
  [];

let timerRAF =
  null;

let audioContext =
  null;

let sfxEnabled =
  true;

let touchStartY =
  null;

/* =========================================================
   AUDIO — ONE GLOBAL AUDIO CONTEXT
========================================================= */

function ensureAudio() {
  if (
    !sfxEnabled
  ) {
    return null;
  }

  if (
    !audioContext
  ) {
    const AudioCtor =
      window.AudioContext ||
      window.webkitAudioContext;

    if (!AudioCtor) {
      return null;
    }

    audioContext =
      new AudioCtor();
  }

  if (
    audioContext.state ===
    'suspended'
  ) {
    audioContext
      .resume()
      .catch(() => {});
  }

  return audioContext;
}

document.addEventListener(
  'pointerdown',

  () => {
    ensureAudio();
  },

  {
    once: true
  }
);

function tone(
  frequency,
  duration,
  gain = .035,
  delay = 0,
  type = 'sine'
) {
  const ctx =
    ensureAudio();

  if (!ctx) {
    return;
  }

  const start =
    ctx.currentTime +
    delay;

  const oscillator =
    ctx.createOscillator();

  const volume =
    ctx.createGain();

  oscillator.type =
    type;

  oscillator.frequency
    .setValueAtTime(
      frequency,
      start
    );

  volume.gain
    .setValueAtTime(
      gain,
      start
    );

  volume.gain
    .exponentialRampToValueAtTime(
      .0001,
      start + duration
    );

  oscillator.connect(
    volume
  );

  volume.connect(
    ctx.destination
  );

  oscillator.start(
    start
  );

  oscillator.stop(
    start + duration
  );
}

function playSfx(type) {
  if (
    !sfxEnabled
  ) {
    return;
  }

  if (
    type === 'deal'
  ) {
    tone(
      650,
      .035,
      .025,
      0,
      'triangle'
    );

    tone(
      760,
      .035,
      .02,
      .045,
      'triangle'
    );

    return;
  }

  if (
    type === 'play'
  ) {
    tone(
      180,
      .07,
      .04,
      0,
      'triangle'
    );

    return;
  }

  if (
    type === 'cut'
  ) {
    tone(
      220,
      .08,
      .045,
      0,
      'square'
    );

    tone(
      420,
      .08,
      .025,
      .06,
      'triangle'
    );

    return;
  }

  if (
    type === 'select'
  ) {
    tone(
      650,
      .025,
      .015
    );

    return;
  }

  if (
    type === 'win'
  ) {
    tone(
      523,
      .22,
      .035
    );

    tone(
      659,
      .22,
      .035,
      .05
    );

    tone(
      784,
      .32,
      .04,
      .10
    );
  }
}

function toggleSfx() {
  sfxEnabled =
    !sfxEnabled;

  document
    .getElementById(
      'sfxBtn'
    )
    .textContent =
      sfxEnabled
        ? '🔊 SFX'
        : '🔇 SFX';

  if (sfxEnabled) {
    ensureAudio();
  }
}

/* =========================================================
   HELPERS
========================================================= */

function esc(value) {
  return String(
    value == null
      ? ''
      : value
  )
    .replace(
      /&/g,
      '&amp;'
    )
    .replace(
      /</g,
      '&lt;'
    )
    .replace(
      />/g,
      '&gt;'
    )
    .replace(
      /"/g,
      '&quot;'
    )
    .replace(
      /'/g,
      '&#039;'
    );
}

function suitSymbol(suit) {
  return {
    spades:
      '♠',

    clubs:
      '♣',

    diamonds:
      '♦',

    hearts:
      '♥'
  }[suit] || '';
}

function trumpText(trump) {
  return (
    trump === 'no_trump'
      ? 'Ø'
      : suitSymbol(
          trump
        )
  );
}

/* =========================================================
   LOBBY
========================================================= */

function chooseStake(
  value,
  element
) {
  document
    .getElementById(
      'stake'
    )
    .value =
      value;

  document
    .querySelectorAll(
      '.stake'
    )
    .forEach(
      item =>
        item.classList.remove(
          'active'
        )
    );

  element.classList.add(
    'active'
  );
}

function joinGame() {
  const name =
    document
      .getElementById(
        'playerName'
      )
      .value
      .trim();

  if (!name) {
    alert(
      'შეიყვანე მოთამაშის სახელი'
    );

    return;
  }

  const userKey =
    localStorage.getItem(
      'buraUserKey'
    ) || '';

  document
    .getElementById(
      'wait'
    )
    .textContent =
      name.toLowerCase() ===
      'saba123'
        ? 'TEST მაგიდა მზადდება...'
        : 'ვეძებთ მოთამაშეებს...';

  socket.emit(
    'joinTable',

    {
      name,

      capacity:
        document
          .getElementById(
            'capacity'
          )
          .value,

      parties:
        document
          .getElementById(
            'parties'
          )
          .value,

      stake:
        Number(
          document
            .getElementById(
              'stake'
            )
            .value
        ),

      userKey
    }
  );
}

/* =========================================================
   CARD ELEMENT
========================================================= */

function cardElement(card) {
  const element =
    document.createElement(
      'div'
    );

  element.className =
    'card suit-' +
    card.suit;

  const symbol =
    suitSymbol(
      card.suit
    );

  element.innerHTML =
    '<div class="cardTop">' +
      '<span>' +
        esc(card.rank) +
      '</span>' +
      '<span>' +
        symbol +
      '</span>' +
    '</div>' +

    '<div class="cardCenter">' +
      symbol +
    '</div>' +

    '<div class="cardBottom">' +
      '<span>' +
        esc(card.rank) +
      '</span>' +
      '<span>' +
        symbol +
      '</span>' +
    '</div>';

  return element;
}

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
  'waitingForPlayers',

  data => {
    document
      .getElementById(
        'wait'
      )
      .textContent =
        'ველოდებით მოთამაშეებს: ' +
        data.current +
        ' / ' +
        data.max;
  }
);

socket.on(
  'errorMessage',

  message => {
    const status =
      document.getElementById(
        'status'
      );

    if (status) {
      status.textContent =
        message;
    }

    alert(message);
  }
);

socket.on(
  'sessionKey',

  data => {
    if (
      data &&
      data.userKey
    ) {
      localStorage.setItem(
        'buraUserKey',
        data.userKey
      );
    }
  }
);

socket.on(
  'sessionRecovered',

  () => {
    document
      .getElementById(
        'wait'
      )
      .textContent =
        '♻️ სესია აღდგენილია';
  }
);

socket.on(
  'sessionInvalid',

  () => {
    localStorage.removeItem(
      'buraUserKey'
    );
  }
);

socket.on(
  'gameStateUpdate',

  state => {
    current =
      state;

    selected =
      [];

    document
      .getElementById(
        'lobby'
      )
      .style.display =
        'none';

    document
      .getElementById(
        'game'
      )
      .style.display =
        'block';

    render(state);
  }
);

socket.on(
  'sfxEvent',

  event => {
    if (
      event &&
      event.type
    ) {
      playSfx(
        event.type
      );
    }
  }
);

socket.on(
  'botThinking',

  data => {
    const status =
      document.getElementById(
        'status'
      );

    if (status) {
      status.textContent =
        data &&
        data.text
          ? data.text
          : '🤖 BOT ფიქრობს...';
    }
  }
);

socket.on(
  'quickMessage',

  data => {
    showReaction(
      data
    );

    if (
      'speechSynthesis' in
      window
    ) {
      try {
        const utterance =
          new SpeechSynthesisUtterance(
            data.text
          );

        utterance.lang =
          'ka-GE';

        utterance.rate =
          1.05;

        speechSynthesis.speak(
          utterance
        );
      } catch (_) {}
    }
  }
);

/* =========================================================
   THROWABLE ANIMATION
========================================================= */

socket.on(
  'throwable',

  data => {
    const from =
      document.querySelector(
        '.seat[data-player-id="' +
        CSS.escape(
          data.fromId
        ) +
        '"] .avatar'
      );

    const target =
      document.querySelector(
        '.seat[data-player-id="' +
        CSS.escape(
          data.targetId
        ) +
        '"] .avatar'
      );

    if (
      !from ||
      !target
    ) {
      return;
    }

    const a =
      from.getBoundingClientRect();

    const b =
      target.getBoundingClientRect();

    const object =
      document.createElement(
        'div'
      );

    object.textContent =
      data.item;

    object.style.position =
      'fixed';

    object.style.left =
      a.left + 'px';

    object.style.top =
      a.top + 'px';

    object.style.fontSize =
      '36px';

    object.style.zIndex =
      '99999';

    object.style.pointerEvents =
      'none';

    object.style.transition =
      'transform .7s cubic-bezier(.2,.8,.2,1)';

    document.body.appendChild(
      object
    );

    requestAnimationFrame(
      () => {
        object.style.transform =
          'translate(' +
          (b.left - a.left) +
          'px,' +
          (b.top - a.top - 30) +
          'px) rotate(540deg)';
      }
    );

    setTimeout(
      () => {
        object.textContent =
          '💥';

        object.style.fontSize =
          '42px';

        setTimeout(
          () => {
            object.remove();
          },

          2300
        );
      },

      720
    );
  }
);

/* =========================================================
   RENDER
========================================================= */

function render(state) {
  document
    .getElementById(
      'tableSub'
    )
    .textContent =
      state.capacity +
      ' players · $' +
      state.stake;

  document
    .getElementById(
      'hudParty'
    )
    .textContent =
      state.partyIndex +
      ' / ' +
      state.parties;

  document
    .getElementById(
      'hudHand'
    )
    .textContent =
      state.handIndex +
      ' / ' +
      state.totalHands;

  document
    .getElementById(
      'hudTrump'
    )
    .textContent =
      trumpText(
        state.trump
      );

  document
    .getElementById(
      'hudDeck'
    )
    .textContent =
      state.deckCount;

  document
    .getElementById(
      'centerDeck'
    )
    .textContent =
      state.deckCount;

  document
    .getElementById(
      'hudStake'
    )
    .textContent =
      '$' +
      state.stake;

  renderTrump(
    state.trump
  );

  renderPlayers(
    state
  );

  renderTable(
    state
  );

  renderHand(
    state
  );

  renderScore(
    state
  );

  updateStatus(
    state
  );

  startTimerLoop();
}

/* =========================================================
   TRUMP
========================================================= */

function renderTrump(trump) {
  const root =
    document.getElementById(
      'trumpSlot'
    );

  root.innerHTML =
    '';

  if (
    trump ===
    'no_trump'
  ) {
    const card =
      document.createElement(
        'div'
      );

    card.className =
      'card';

    card.style.display =
      'grid';

    card.style.placeItems =
      'center';

    card.style.color =
      '#222';

    card.style.fontSize =
      '28px';

    card.textContent =
      'Ø';

    root.appendChild(
      card
    );

    return;
  }

  root.appendChild(
    cardElement({
      rank:
        'K',

      suit:
        trump
    })
  );
}

/* =========================================================
   PLAYER POSITIONS
========================================================= */

function seatPosition(
  index,
  count,
  myId,
  players
) {
  let myIndex =
    players.findIndex(
      player =>
        player.id ===
        myId
    );

  if (
    myIndex < 0
  ) {
    myIndex = 0;
  }

  const relative =
    (
      index -
      myIndex +
      count
    ) %
    count;

  const positions3 = [
    {
      left: 50,
      top: 84
    },

    {
      left: 18,
      top: 28
    },

    {
      left: 82,
      top: 28
    }
  ];

  const positions4 = [
    {
      left: 50,
      top: 84
    },

    {
      left: 14,
      top: 50
    },

    {
      left: 50,
      top: 15
    },

    {
      left: 86,
      top: 50
    }
  ];

  return (
    count === 4
      ? positions4
      : positions3
  )[relative];
}

/* =========================================================
   PLAYERS
========================================================= */

function renderPlayers(state) {
  const root =
    document.getElementById(
      'players'
    );

  root.innerHTML =
    '';

  state.players.forEach(
    (player, index) => {
      const position =
        seatPosition(
          index,
          state.players.length,
          state.viewingPlayerId,
          state.players
        );

      const seat =
        document.createElement(
          'div'
        );

      seat.className =
        'seat' +
        (
          player.isCurrent
            ? ' current'
            : ''
        );

      seat.dataset.playerId =
        player.id;

      seat.style.left =
        position.left +
        '%';

      seat.style.top =
        position.top +
        '%';

      let backs =
        '';

      if (
        player.id !==
        state.viewingPlayerId
      ) {
        for (
          let i = 0;
          i < player.cardCount;
          i++
        ) {
          backs +=
            '<div class="back"></div>';
        }
      }

      seat.innerHTML =
        '<div class="seatBox">' +

          '<div class="avatar">' +
            '<div class="timerRing"></div>' +
            (
              player.isBot
                ? '🤖'
                : esc(
                    player.avatar ||
                    '🦊'
                  )
            ) +
          '</div>' +

          '<div class="seatName">' +
            esc(player.name) +
          '</div>' +

          '<div class="seatInfo">' +
            '💰 ' +
            player.balance +
            ' · hand ' +
            player.handPoints +
            ' · total ' +
            player.totalPoints +
          '</div>' +

          '<div class="backs">' +
            backs +
          '</div>' +

        '</div>';

      const avatar =
        seat.querySelector(
          '.avatar'
        );

      avatar.addEventListener(
        'click',

        () => {
          openThrowMenu(
            player.id
          );
        }
      );

      root.appendChild(
        seat
      );
    }
  );
}

/* =========================================================
   TABLE
========================================================= */

function renderTable(state) {
  const root =
    document.getElementById(
      'tableCards'
    );

  root.innerHTML =
    '';

  state.table.forEach(
    play => {
      const group =
        document.createElement(
          'div'
        );

      group.className =
        'playGroup' +
        (
          play.isWinning
            ? ' winner'
            : ''
        );

      const name =
        document.createElement(
          'div'
        );

      name.className =
        'playName';

      name.textContent =
        play.playerName;

      group.appendChild(
        name
      );

      play.cards.forEach(
        card => {
          group.appendChild(
            cardElement(card)
          );
        }
      );

      root.appendChild(
        group
      );
    }
  );
}

/* =========================================================
   HAND / FAN OUT / SWIPE UP
========================================================= */

function renderHand(state) {
  const root =
    document.getElementById(
      'myCards'
    );

  root.innerHTML =
    '';

  const cards =
    state.playersCards[
      state.viewingPlayerId
    ] || [];

  const middle =
    (
      cards.length - 1
    ) /
    2;

  cards.forEach(
    (card, index) => {
      const element =
        cardElement(card);

      const delta =
        index -
        middle;

      const rotation =
        delta * 4;

      const vertical =
        Math.abs(delta) *
        2;

      element.style.transform =
        'rotate(' +
        rotation +
        'deg) translateY(' +
        vertical +
        'px)';

      element.addEventListener(
        'click',

        () => {
          toggleCard(
            index,
            element
          );
        }
      );

      /*
        SWIPE UP
      */

      element.addEventListener(
        'touchstart',

        event => {
          if (
            event.touches &&
            event.touches[0]
          ) {
            touchStartY =
              event
                .touches[0]
                .clientY;
          }
        },

        {
          passive: true
        }
      );

      element.addEventListener(
        'touchend',

        event => {
          if (
            touchStartY ==
            null
          ) {
            return;
          }

          const touch =
            event.changedTouches &&
            event.changedTouches[0];

          if (!touch) {
            return;
          }

          const deltaY =
            touchStartY -
            touch.clientY;

          touchStartY =
            null;

          if (
            deltaY > 35
          ) {
            if (
              !selected.includes(
                index
              )
            ) {
              toggleCard(
                index,
                element
              );
            }

            if (
              selectionValidClient()
            ) {
              playSelected();
            }
          }
        },

        {
          passive: true
        }
      );

      root.appendChild(
        element
      );
    }
  );

  updatePlayButton(
    state
  );

  updateSelectedCount();
}

function toggleCard(
  index,
  element
) {
  const position =
    selected.indexOf(
      index
    );

  if (
    position >= 0
  ) {
    selected.splice(
      position,
      1
    );

    element.classList.remove(
      'selected'
    );
  } else {
    if (
      selected.length >= 5
    ) {
      return;
    }

    selected.push(
      index
    );

    element.classList.add(
      'selected'
    );
  }

  playSfx(
    'select'
  );

  updatePlayButton(
    current
  );

  updateSelectedCount();
}

function updateSelectedCount() {
  document
    .getElementById(
      'selectedCount'
    )
    .textContent =
      'არჩეული: ' +
      selected.length +
      ' / 5';
}

/* =========================================================
   CLIENT VALIDATION

   პასუხისას მასტების შერევა ნებადართულია.
========================================================= */

function selectionValidClient() {
  if (
    !current ||
    !selected.length
  ) {
    return false;
  }

  const cards =
    current.playersCards[
      current.viewingPlayerId
    ] || [];

  const chosen =
    selected
      .map(
        index =>
          cards[index]
      )
      .filter(Boolean);

  if (
    chosen.length !==
      selected.length ||
    chosen.length > 5
  ) {
    return false;
  }

  /*
    LEAD
  */

  if (
    current.table.length === 0
  ) {
    return chosen.every(
      card =>
        card.suit ===
        chosen[0].suit
    );
  }

  /*
    MALIUTKA RESPONSE
  */

  if (
    current.leadWasMaliutka
  ) {
    return (
      chosen.length ===
      cards.length
    );
  }

  /*
    RESPONSE:
    EXACT N ONLY.
    SUITS MAY BE MIXED.
  */

  return (
    chosen.length ===
    (
      current.leadCount ||
      1
    )
  );
}

function updatePlayButton(state) {
  const button =
    document.getElementById(
      'playBtn'
    );

  const active =
    state
      ? state.players[
          state.currentTurnIndex
        ]
      : null;

  button.disabled =
    !state ||
    !active ||
    active.id !==
      state.viewingPlayerId ||
    !selectionValidClient() ||
    state.processing ||
    state.gameOver;
}

function playSelected() {
  if (
    !selectionValidClient()
  ) {
    alert(
      'პირველი სვლისას კარტები ერთი მასტის უნდა იყოს. საპასუხო სვლისას მონიშნე ზუსტად იგივე რაოდენობა — მასტების შერევა შეიძლება.'
    );

    return;
  }

  socket.emit(
    'playCards',

    {
      cardIndices:
        selected.slice()
    }
  );

  selected =
    [];

  updateSelectedCount();
}

/* =========================================================
   STATUS
========================================================= */

function updateStatus(state) {
  const element =
    document.getElementById(
      'status'
    );

  if (
    state.gameOver
  ) {
    element.textContent =
      '🏆 თამაში დასრულებულია';

    return;
  }

  if (
    state.processing
  ) {
    element.textContent =
      '✨ გამარჯვებული სვლა — მაგიდა 1.8 წამში გაიწმინდება...';

    return;
  }

  const player =
    state.players[
      state.currentTurnIndex
    ];

  if (!player) {
    return;
  }

  if (
    player.id ===
    state.viewingPlayerId
  ) {
    element.textContent =
      '🎯 შენი სვლაა';
  } else if (
    player.isBot
  ) {
    element.textContent =
      '🤖 BOT ფიქრობს...';
  } else {
    element.textContent =
      player.name +
      '-ის სვლაა';
  }
}

/* =========================================================
   SCOREBOARD + HISTORY
========================================================= */

function renderScore(state) {
  const root =
    document.getElementById(
      'score'
    );

  const last =
    state.lastHandScores ||
    {};

  const players =
    state.players
      .slice()
      .sort(
        (a, b) =>
          (
            b.totalPoints ||
            0
          ) -
          (
            a.totalPoints ||
            0
          )
      );

  let html =
    '';

  players.forEach(
    (player, index) => {
      const place =
        index === 0
          ? '🥇'
          : index === 1
            ? '🥈'
            : index === 2
              ? '🥉'
              : '#' +
                (
                  index + 1
                );

      const lastScore =
        typeof last[
          player.id
        ] === 'number'
          ? last[
              player.id
            ]
          : '-';

      html +=
        '<div class="scoreRow">' +

          '<div>' +
            place +
          '</div>' +

          '<div>' +
            esc(
              player.name
            ) +
          '</div>' +

          '<div>' +
            lastScore +
          '</div>' +

          '<div class="total">' +
            player.totalPoints +
          '</div>' +

        '</div>';
    }
  );

  root.innerHTML =
    html;

  const historyRoot =
    document.getElementById(
      'history'
    );

  historyRoot.innerHTML =
    (
      state.history ||
      []
    )
      .slice()
      .reverse()
      .map(
        round => {
          const details =
            state.players
              .map(
                player => {
                  const raw =
                    round.rawScores &&
                    round.rawScores[
                      player.id
                    ] !== undefined
                      ? round
                          .rawScores[
                            player.id
                          ]
                      : 0;

                  const score =
                    round.scores &&
                    round.scores[
                      player.id
                    ] !== undefined
                      ? round
                          .scores[
                            player.id
                          ]
                      : raw;

                  return (
                    esc(
                      player.name
                    ) +
                    ': ' +
                    raw +
                    ' (' +
                    score +
                    ')'
                  );
                }
              )
              .join(
                ' · '
              );

          return (
            '<div class="historyRow">' +
              '<b>Round ' +
                round.hand +
                ' · ' +
                trumpText(
                  round.trump
                ) +
              '</b>' +
              '<br>' +
              details +
            '</div>'
          );
        }
      )
      .join('');
}

/* =========================================================
   TIMER PROGRESS RING
========================================================= */

function startTimerLoop() {
  if (
    timerRAF
  ) {
    cancelAnimationFrame(
      timerRAF
    );
  }

  function tick() {
    if (!current) {
      return;
    }

    const remaining =
      Math.max(
        0,

        current.turnEndsAt -
        Date.now()
      );

    const percentage =
      Math.max(
        0,

        Math.min(
          100,

          (
            remaining /
            (
              current.turnSeconds *
              1000
            )
          ) *
          100
        )
      );

    document
      .querySelectorAll(
        '.seat'
      )
      .forEach(
        seat => {
          const ring =
            seat.querySelector(
              '.timerRing'
            );

          if (!ring) {
            return;
          }

          const playerId =
            seat.dataset.playerId;

          const active =
            current.players[
              current.currentTurnIndex
            ];

          ring.style.setProperty(
            '--turn',

            active &&
            active.id ===
              playerId
              ? percentage +
                '%'
              : '0%'
          );
        }
      );

    timerRAF =
      requestAnimationFrame(
        tick
      );
  }

  tick();
}

/* =========================================================
   QUICK REACTIONS
========================================================= */

function sendQuick(text) {
  socket.emit(
    'quickMessage',
    {
      text
    }
  );
}

function showReaction(data) {
  if (!data) {
    return;
  }

  const seat =
    document.querySelector(
      '.seat[data-player-id="' +
      CSS.escape(
        data.playerId
      ) +
      '"] .seatBox'
    );

  if (!seat) {
    return;
  }

  seat
    .querySelectorAll(
      '.reactionBubble'
    )
    .forEach(
      element =>
        element.remove()
    );

  const bubble =
    document.createElement(
      'div'
    );

  bubble.className =
    'reactionBubble';

  bubble.textContent =
    data.text;

  seat.appendChild(
    bubble
  );

  setTimeout(
    () => {
      bubble.remove();
    },

    2500
  );
}

/* =========================================================
   THROWABLE MENU
========================================================= */

function openThrowMenu(playerId) {
  if (
    !current ||
    playerId ===
      current.viewingPlayerId
  ) {
    return;
  }

  const choice =
    prompt(
      'აირჩიე: 🍅  🥚  🧻',
      '🍅'
    );

  if (
    ![
      '🍅',
      '🥚',
      '🧻'
    ].includes(choice)
  ) {
    return;
  }

  socket.emit(
    'throwable',

    {
      targetId:
        playerId,

      item:
        choice
    }
  );
}

/* =========================================================
   SKINS
========================================================= */

const savedFelt =
  localStorage.getItem(
    'buraFelt'
  ) || 'green';

const savedBack =
  localStorage.getItem(
    'buraBack'
  ) || 'red';

function applySkins() {
  const felt =
    document.getElementById(
      'felt'
    );

  if (!felt) {
    return;
  }

  if (
    savedFelt ===
    'black'
  ) {
    felt.style.background =
      'radial-gradient(ellipse,#252525,#101010 65%,#050505)';
  }

  if (
    savedFelt ===
    'blue'
  ) {
    felt.style.background =
      'radial-gradient(ellipse,#174c8c,#0a315f 65%,#061d38)';
  }
}

applySkins();

/* =========================================================
   AUTO SESSION RESTORE
========================================================= */

const savedUserKey =
  localStorage.getItem(
    'buraUserKey'
  );

if (
  savedUserKey
) {
  socket.emit(
    'restoreSession',

    {
      userKey:
        savedUserKey
    }
  );
}

</script>

</body>

</html>
`;

/* =========================================================
   ROUTING

   MONOLITHIC SERVER:
   "/" ALWAYS RETURNS THE GAME.
========================================================= */

app.get(
  '/',

  (req, res) => {
    res
      .status(200)
      .type('html')
      .send(PAGE);
  }
);

app.get(
  '/health',

  (req, res) => {
    res
      .status(200)
      .json({
        ok:
          true,

        game:
          'Written Bura',

        cards:
          36,

        tester:
          TESTER_NAME,

        turnSeconds:
          TURN_SECONDS,

        reconnectSeconds:
          RECONNECT_MS /
          1000,

        tableClearDelay:
          TRICK_CLEAR_DELAY
      });
  }
);

/* =========================================================
   404
========================================================= */

app.use(
  (req, res) => {
    res
      .status(404)
      .type('text')
      .send(
        'Not Found'
      );
  }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
  PORT,

  () => {
    console.log(
      '======================================'
    );

    console.log(
      'WRITTEN BURA SERVER RUNNING'
    );

    console.log(
      'PORT:',
      PORT
    );

    console.log(
      'DECK:',
      createDeck().length
    );

    console.log(
      'TESTER:',
      TESTER_NAME
    );

    console.log(
      'TURN:',
      TURN_SECONDS +
      ' sec'
    );

    console.log(
      'TRICK CLEAR:',
      TRICK_CLEAR_DELAY +
      ' ms'
    );

    console.log(
      'RECONNECT:',
      RECONNECT_MS /
      1000 +
      ' sec'
    );

    console.log(
      '======================================'
    );
  }
);
