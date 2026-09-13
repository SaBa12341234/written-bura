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

/* =========================================================
   GENERAL HELPERS
========================================================= */

function cleanName(value) {
  return String(value || '')
    .trim()
    .slice(0, 20);
}

function isTesterName(value) {
  return (
    cleanName(value).toLowerCase() ===
    TESTER_NAME
  );
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

function cardPoints(cards) {
  return (cards || []).reduce(
    function (sum, card) {
      return sum + card.value;
    },
    0
  );
}

function allSameSuit(cards) {
  if (!cards.length) {
    return false;
  }

  return cards.every(
    function (card) {
      return card.suit === cards[0].suit;
    }
  );
}

function isMaliutka(cards) {
  return (
    cards.length === 5 &&
    allSameSuit(cards)
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
        suit: suit,
        rank: rank,
        value: CARD_VALUES[rank]
      });
    }
  }

  for (
    let i = deck.length - 1;
    i > 0;
    i--
  ) {
    const j = Math.floor(
      Math.random() * (i + 1)
    );

    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }

  return deck;
}

/* =========================================================
   PLAYER STATS
========================================================= */

function createStats() {
  return {
    xp: 0,
    level: 1,
    wins: 0,
    streak: 0,
    achievements: []
  };
}

function recalcLevel(player) {
  player.stats.level =
    Math.max(
      1,
      Math.floor(player.stats.xp / 100) + 1
    );
}

function playerFrame(player) {
  const wins =
    player.stats.wins || 0;

  if (wins >= 10) {
    return 'diamond';
  }

  if (wins >= 3) {
    return 'gold';
  }

  return 'bronze';
}

function awardAchievement(
  room,
  player,
  key,
  title
) {
  if (
    !player ||
    !player.stats
  ) {
    return;
  }

  if (
    player.stats.achievements.includes(key)
  ) {
    return;
  }

  player.stats.achievements.push(key);

  player.stats.xp += 40;

  recalcLevel(player);

  io.to(room.id).emit(
    'achievement',
    {
      playerId: player.id,
      playerName: player.name,
      key: key,
      title: title
    }
  );
}

/* =========================================================
   ROOM
========================================================= */

function createRoom(
  capacity,
  parties,
  stake
) {
  const room = {
    id: makeId('room'),

    capacity: capacity,

    parties: parties,

    stake: stake,

    players: [],

    game: null,

    timer: null
  };

  rooms.set(
    room.id,
    room
  );

  return room;
}

/* =========================================================
   START HAND
========================================================= */

function startHand(
  room,
  previous
) {
  const deck =
    createDeck();

  const hands = {};
  const taken = {};
  const totals = {};

  for (
    const player of
    room.players
  ) {
    hands[player.id] =
      deck.splice(0, 5);

    taken[player.id] =
      [];

    totals[player.id] =
      previous
        ? (
          previous.totals[player.id] ||
          0
        )
        : 0;
  }

  const handIndex =
    previous
      ? previous.handIndex + 1
      : 1;

  /*
    პირველი ხელი იწყება პირველი
    შემოსული მოთამაშით: index 0.

    შემდეგ ხელებზე გამოიყენება
    previous.nextLeaderIndex.
  */

  const leaderIndex =
    previous &&
    Number.isInteger(
      previous.nextLeaderIndex
    )
      ? previous.nextLeaderIndex
      : 0;

  return {
    deck: deck,

    hands: hands,

    taken: taken,

    totals: totals,

    table: [],

    handIndex: handIndex,

    partyIndex:
      Math.ceil(
        handIndex / 5
      ),

    trump:
      TRUMPS[
        (
          handIndex - 1
        ) %
        TRUMPS.length
      ],

    currentTurnIndex:
      leaderIndex,

    nextLeaderIndex:
      leaderIndex,

    leadCount:
      null,

    leadWasMaliutka:
      false,

    leadPlayerId:
      null,

    processing:
      false,

    gameOver:
      false,

    lastHandScores:
      previous
        ? (
          previous.lastHandScores ||
          {}
        )
        : {},

    history:
      previous
        ? previous.history
        : [],

    /*
      ბოლო ტრიკზე ვის რა რიგით ჰქონდა სვლა.
      საჭიროა რამდენიმე გახიშტულის წესისთვის.
    */

    lastTrickOrder:
      [],

    turnEndsAt:
      Date.now() +
      TURN_SECONDS * 1000
  };
}

/* =========================================================
   CARD COMPARISON
========================================================= */

function cardBeats(
  defender,
  attacker,
  trump
) {
  const defenderTrump =
    isTrump(
      defender,
      trump
    );

  const attackerTrump =
    isTrump(
      attacker,
      trump
    );

  /*
    კოზირი ჭრის არაკოზირს.
  */

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

  /*
    არცერთი არაა კოზირი,
    ან ორივე კოზირია.

    თუ მასტი სხვადასხვა აქვს და
    კოზირი არ მუშაობს, ვერ ჭრის.
  */

  if (
    defender.suit !==
    attacker.suit
  ) {
    return false;
  }

  return (
    rankIndex(attacker) >
    rankIndex(defender)
  );
}

function sortPlayCards(
  cards,
  trump
) {
  return cards
    .slice()
    .sort(
      function (a, b) {
        const aTrump =
          isTrump(a, trump)
            ? 1
            : 0;

        const bTrump =
          isTrump(b, trump)
            ? 1
            : 0;

        if (
          aTrump !==
          bTrump
        ) {
          return (
            bTrump -
            aTrump
          );
        }

        return (
          rankIndex(b) -
          rankIndex(a)
        );
      }
    );
}

/*
  2, 3, 4 ან 5 კარტიანი
  კომბინაციის ჭრა.

  საპასუხო კომბინაციამ
  ყოველი შესაბამისი კარტი უნდა აჯობოს.
*/

function playBeats(
  currentWinner,
  challenger,
  trump
) {
  if (
    currentWinner.cards.length !==
    challenger.cards.length
  ) {
    return false;
  }

  const base =
    sortPlayCards(
      currentWinner.cards,
      trump
    );

  const challenge =
    sortPlayCards(
      challenger.cards,
      trump
    );

  for (
    let i = 0;
    i < base.length;
    i++
  ) {
    if (
      !cardBeats(
        base[i],
        challenge[i],
        trump
      )
    ) {
      return false;
    }
  }

  return true;
}

function winningPlayIndex(game) {
  if (
    !game.table.length
  ) {
    return -1;
  }

  let winnerIndex =
    0;

  for (
    let i = 1;
    i < game.table.length;
    i++
  ) {
    if (
      playBeats(
        game.table[winnerIndex],
        game.table[i],
        game.trump
      )
    ) {
      winnerIndex =
        i;
    }
  }

  return winnerIndex;
}

/* =========================================================
   SAME SUIT HELPERS
========================================================= */

function hasSameSuitGroup(
  hand,
  count
) {
  if (
    count <= 1
  ) {
    return true;
  }

  return SUITS.some(
    function (suit) {
      return (
        hand.filter(
          function (card) {
            return (
              card.suit ===
              suit
            );
          }
        ).length >= count
      );
    }
  );
}

function firstSameSuitGroup(
  hand,
  count
) {
  if (
    !hand.length
  ) {
    return [];
  }

  if (
    count <= 1
  ) {
    return [0];
  }

  for (
    const suit of
    SUITS
  ) {
    const indexes = [];

    for (
      let index = 0;
      index < hand.length;
      index++
    ) {
      if (
        hand[index].suit ===
        suit
      ) {
        indexes.push(index);
      }

      if (
        indexes.length ===
        count
      ) {
        return indexes;
      }
    }
  }

  const fallback = [];

  for (
    let i = 0;
    i <
    Math.min(
      count,
      hand.length
    );
    i++
  ) {
    fallback.push(i);
  }

  return fallback;
}

/* =========================================================
   CLIENT STATE
========================================================= */

function getClientState(
  room,
  viewerId,
  revealAll
) {
  const game =
    room.game;

  if (
    !game
  ) {
    return null;
  }

  const visibleCards = {};

  if (
    revealAll
  ) {
    for (
      const player of
      room.players
    ) {
      visibleCards[player.id] =
        game.hands[player.id] ||
        [];
    }
  } else {
    visibleCards[viewerId] =
      game.hands[viewerId] ||
      [];
  }

  const winningIndex =
    winningPlayIndex(
      game
    );

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
      !!revealAll,

    playersCards:
      visibleCards,

    lastHandScores:
      game.lastHandScores,

    turnEndsAt:
      game.turnEndsAt,

    turnSeconds:
      TURN_SECONDS,

    leadCount:
      game.leadCount,

    leadWasMaliutka:
      game.leadWasMaliutka,

    table:
      game.table.map(
        function (
          play,
          index
        ) {
          return {
            playerId:
              play.playerId,

            playerName:
              play.playerName,

            cards:
              play.cards,

            isWinning:
              index ===
              winningIndex
          };
        }
      ),

    players:
      room.players.map(
        function (
          player,
          index
        ) {
          return {
            id:
              player.id,

            name:
              player.name,

            isBot:
              !!player.isBot,

            isTester:
              !!player.isTester,

            balance:
              player.balance,

            cardCount:
              (
                game.hands[
                  player.id
                ] ||
                []
              ).length,

            handPoints:
              cardPoints(
                game.taken[
                  player.id
                ]
              ),

            totalPoints:
              game.totals[
                player.id
              ] ||
              0,

            isCurrent:
              index ===
              game.currentTurnIndex,

            xp:
              player.stats.xp,

            level:
              player.stats.level,

            wins:
              player.stats.wins,

            streak:
              player.stats.streak,

            frame:
              playerFrame(
                player
              ),

            achievements:
              player.stats
                .achievements
                .slice()
          };
        }
      )
  };
}

function broadcast(room) {
  for (
    const player of
    room.players
  ) {
    if (
      player.isBot
    ) {
      continue;
    }

    io.to(
      player.id
    ).emit(
      'gameStateUpdate',
      getClientState(
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

function setTurn(
  room,
  playerIndex
) {
  if (
    !room.game ||
    room.game.gameOver
  ) {
    return;
  }

  clearTimeout(
    room.timer
  );

  room.game.currentTurnIndex =
    playerIndex;

  room.game.turnEndsAt =
    Date.now() +
    TURN_SECONDS * 1000;

  room.timer =
    setTimeout(
      function () {
        autoPlayCurrent(
          room
        );
      },
      TURN_SECONDS * 1000 +
      150
    );
}

/* =========================================================
   REFILL
========================================================= */

function refillCards(
  room,
  winnerIndex
) {
  const game =
    room.game;

  while (
    game.deck.length
  ) {
    let dealt =
      false;

    /*
      გამარჯვებულიდან იწყება დარიგება.
    */

    for (
      let offset = 0;
      offset <
      room.players.length;
      offset++
    ) {
      const player =
        room.players[
          (
            winnerIndex +
            offset
          ) %
          room.players.length
        ];

      const hand =
        game.hands[
          player.id
        ];

      if (
        hand.length < 5 &&
        game.deck.length
      ) {
        hand.push(
          game.deck.pop()
        );

        dealt =
          true;
      }
    }

    if (
      !dealt
    ) {
      break;
    }
  }
}

/* =========================================================
   NEXT HAND LEADER
========================================================= */

function getNextHandLeader(
  room,
  game,
  rawScores
) {
  const zeroPlayers =
    room.players.filter(
      function (player) {
        return (
          rawScores[
            player.id
          ] === 0
        );
      }
    );

  /*
    თუ ორი ან მეტი გაიხიშტა:
    ბოლო ტრიკზე რომელი გახიშტული
    ითამაშა ბოლოს, მის შემდეგ იწყება.
  */

  if (
    zeroPlayers.length >= 2 &&
    game.lastTrickOrder.length
  ) {
    const zeroIds =
      zeroPlayers.map(
        function (player) {
          return player.id;
        }
      );

    let lastZeroId =
      null;

    for (
      const playerId of
      game.lastTrickOrder
    ) {
      if (
        zeroIds.includes(
          playerId
        )
      ) {
        lastZeroId =
          playerId;
      }
    }

    if (
      lastZeroId
    ) {
      const index =
        room.players.findIndex(
          function (player) {
            return (
              player.id ===
              lastZeroId
            );
          }
        );

      return (
        (
          index + 1
        ) %
        room.players.length
      );
    }
  }

  /*
    ჩვეულებრივი წესი:
    ვისაც ნაკლები raw ქულა აქვს,
    იმის მომდევნო იწყებს.
  */

  let minimum =
    Infinity;

  let minimumIndex =
    0;

  room.players.forEach(
    function (
      player,
      index
    ) {
      const raw =
        rawScores[
          player.id
        ];

      if (
        raw < minimum
      ) {
        minimum =
          raw;

        minimumIndex =
          index;
      }
    }
  );

  return (
    (
      minimumIndex + 1
    ) %
    room.players.length
  );
}

/* =========================================================
   FINISH HAND
========================================================= */

function finishHand(room) {
  const game =
    room.game;

  const rawScores = {};
  const scores = {};

  for (
    const player of
    room.players
  ) {
    const raw =
      cardPoints(
        game.taken[
          player.id
        ]
      );

    rawScores[
      player.id
    ] =
      raw;

    /*
      ამჟამინდელი სატესტო ქულები:
      0 = -120.
    */

    const score =
      raw === 0
        ? -120
        : raw;

    scores[
      player.id
    ] =
      score;

    game.totals[
      player.id
    ] =
      (
        game.totals[
          player.id
        ] ||
        0
      ) +
      score;

    player.stats.xp +=
      Math.max(
        5,
        Math.floor(
          raw / 4
        )
      );

    recalcLevel(
      player
    );
  }

  game.lastHandScores =
    Object.assign(
      {},
      scores
    );

  game.history.push({
    hand:
      game.handIndex,

    rawScores:
      Object.assign(
        {},
        rawScores
      ),

    scores:
      Object.assign(
        {},
        scores
      ),

    totals:
      Object.assign(
        {},
        game.totals
      )
  });

  /*
    მთელი მატჩი დასრულდა.
  */

  if (
    game.handIndex >=
    room.parties * 5
  ) {
    game.gameOver =
      true;

    clearTimeout(
      room.timer
    );

    let winner =
      room.players[0];

    for (
      const player of
      room.players
    ) {
      if (
        (
          game.totals[
            player.id
          ] || 0
        )
        >
        (
          game.totals[
            winner.id
          ] || 0
        )
      ) {
        winner =
          player;
      }
    }

    winner.stats.wins +=
      1;

    winner.stats.xp +=
      100;

    recalcLevel(
      winner
    );

    broadcast(
      room
    );

    io.to(
      room.id
    ).emit(
      'sfxEvent',
      {
        type:
          'win'
      }
    );

    io.to(
      room.id
    ).emit(
      'gameWinner',
      {
        playerId:
          winner.id,

        playerName:
          winner.name
      }
    );

    return;
  }

  game.nextLeaderIndex =
    getNextHandLeader(
      room,
      game,
      rawScores
    );

  room.game =
    startHand(
      room,
      game
    );

  room.game.lastHandScores =
    Object.assign(
      {},
      scores
    );

  setTurn(
    room,
    room.game.currentTurnIndex
  );

  broadcast(
    room
  );

  io.to(
    room.id
  ).emit(
    'sfxEvent',
    {
      type:
        'deal'
    }
  );

  scheduleBot(
    room
  );
}

/* =========================================================
   COMPLETE TRICK
========================================================= */

function completeTrick(room) {
  const game =
    room.game;

  const winnerTableIndex =
    winningPlayIndex(
      game
    );

  const winnerPlay =
    game.table[
      winnerTableIndex
    ];

  if (
    !winnerPlay
  ) {
    return;
  }

  const allCards = [];

  for (
    const play of
    game.table
  ) {
    allCards.push(
      ...play.cards
    );
  }

  /*
    მალიუტკის შემთხვევაშიც მხოლოდ
    ამ სვლაში მაგიდაზე დადებული
    კარტები მიდის გამარჯვებულთან.
  */

  game.taken[
    winnerPlay.playerId
  ].push(
    ...allCards
  );

  game.lastTrickOrder =
    game.table.map(
      function (play) {
        return play.playerId;
      }
    );

  const winnerIndex =
    room.players.findIndex(
      function (player) {
        return (
          player.id ===
          winnerPlay.playerId
        );
      }
    );

  const winner =
    room.players[
      winnerIndex
    ];

  if (
    winner
  ) {
    winner.stats.streak +=
      1;

    winner.stats.xp +=
      10;

    recalcLevel(
      winner
    );

    for (
      const player of
      room.players
    ) {
      if (
        player.id !==
        winner.id
      ) {
        player.stats.streak =
          0;
      }
    }

    if (
      winner.stats.streak >= 3
    ) {
      awardAchievement(
        room,
        winner,
        'triple_streak',
        '3-ჯერ ზედიზედ მოგება'
      );
    }

    if (
      winnerTableIndex > 0
    ) {
      const cutWithTrump =
        winnerPlay.cards.some(
          function (card) {
            return isTrump(
              card,
              game.trump
            );
          }
        );

      if (
        cutWithTrump
      ) {
        awardAchievement(
          room,
          winner,
          'invisible_cut',
          'უხილავი ჭრა'
        );
      }
    }
  }

  game.processing =
    true;

  clearTimeout(
    room.timer
  );

  broadcast(
    room
  );

  io.to(
    room.id
  ).emit(
    'sfxEvent',
    {
      type:
        winnerTableIndex === 0
          ? 'take'
          : 'cut'
    }
  );

  setTimeout(
    function () {
      if (
        !rooms.has(
          room.id
        )
        ||
        room.game !==
        game
      ) {
        return;
      }

      game.table =
        [];

      game.leadCount =
        null;

      game.leadWasMaliutka =
        false;

      game.leadPlayerId =
        null;

      /*
        მალიუტკის შემდეგაც ჩვეულებრივ
        ვავსებთ ხელებს დასტიდან.
      */

      refillCards(
        room,
        winnerIndex
      );

      game.processing =
        false;

      const allHandsEmpty =
        room.players.every(
          function (player) {
            return (
              (
                game.hands[
                  player.id
                ] ||
                []
              ).length === 0
            );
          }
        );

      if (
        allHandsEmpty &&
        game.deck.length === 0
      ) {
        finishHand(
          room
        );

        return;
      }

      /*
        ტრიკის გამარჯვებული იწყებს
        შემდეგ ჩვეულებრივ სვლას.
      */

      setTurn(
        room,
        winnerIndex
      );

      broadcast(
        room
      );

      scheduleBot(
        room
      );
    },
    900
  );
}

/* =========================================================
   VALIDATE SELECTION
========================================================= */

function validateSelection(
  game,
  hand,
  indexes
) {
  if (
    !indexes.length
  ) {
    return {
      ok: false,
      message:
        'აირჩიე მინიმუმ 1 კარტი.'
    };
  }

  if (
    indexes.length > 5
  ) {
    return {
      ok: false,
      message:
        'ერთ სვლაზე მაქსიმუმ 5 კარტი შეგიძლია.'
    };
  }

  const cards =
    indexes.map(
      function (index) {
        return hand[index];
      }
    );

  if (
    cards.some(
      function (card) {
        return !card;
      }
    )
  ) {
    return {
      ok: false,
      message:
        'კარტის არჩევაში შეცდომაა.'
    };
  }

  const sameSuit =
    allSameSuit(
      cards
    );

  /*
    პირველი სვლა:
    1-5 კარტი.
    2+ კარტი ერთი მასტის.
    5 = მალიუტკა.
  */

  if (
    game.table.length === 0
  ) {
    if (
      !sameSuit
    ) {
      return {
        ok: false,
        message:
          'ერთად ჩასული კარტები ერთი მასტის უნდა იყოს.'
      };
    }

    if (
      cards.length === 5 &&
      !isMaliutka(cards)
    ) {
      return {
        ok: false,
        message:
          '5 კარტით სვლა მხოლოდ მალიუტკაა.'
      };
    }

    return {
      ok: true,
      cards: cards
    };
  }

  /*
    MALYUTKA:
    ყველა მოთამაშე აგდებს
    ხელში არსებულ ყველა კარტს.
  */

  if (
    game.leadWasMaliutka
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
      cards: cards
    };
  }

  const required =
    game.leadCount ||
    1;

  /*
    ჩვეულებრივი საპასუხო სვლა:
    ზუსტად იგივე რაოდენობა.
  */

  if (
    cards.length !==
    required
  ) {
    return {
      ok: false,
      message:
        'უნდა ჩამოხვიდე ზუსტად ' +
        required +
        ' კარტი.'
    };
  }

  /*
    თუ შეუძლია საჭირო რაოდენობის
    ერთი მასტის კარტის შეკრება,
    არჩეულიც ერთი მასტის უნდა იყოს.
  */

  if (
    hasSameSuitGroup(
      hand,
      required
    )
    &&
    !sameSuit
  ) {
    return {
      ok: false,
      message:
        'თუ გაქვს საშუალება, არჩეული კარტები ერთი მასტის უნდა იყოს.'
    };
  }

  return {
    ok: true,
    cards: cards
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

  if (
    !game ||
    game.processing ||
    game.gameOver
  ) {
    return {
      ok: false,
      message:
        'ახლა სვლა შეუძლებელია.'
    };
  }

  const hand =
    game.hands[
      player.id
    ] ||
    [];

  const result =
    validateSelection(
      game,
      hand,
      indexes
    );

  if (
    !result.ok
  ) {
    return result;
  }

  /*
    პირველი ჩამსვლელი განსაზღვრავს
    კარტების რაოდენობას.
  */

  if (
    game.table.length === 0
  ) {
    game.leadCount =
      result.cards.length;

    game.leadWasMaliutka =
      isMaliutka(
        result.cards
      );

    game.leadPlayerId =
      player.id;

    if (
      game.leadWasMaliutka
    ) {
      awardAchievement(
        room,
        player,
        'maliutka_master',
        'მალიუტკის ოსტატი'
      );
    }
  }

  /*
    ხელიდან კარტების ამოღება.
  */

  game.hands[
    player.id
  ] =
    hand.filter(
      function (
        card,
        index
      ) {
        return (
          !indexes.includes(
            index
          )
        );
      }
    );

  game.table.push({
    playerId:
      player.id,

    playerName:
      player.name,

    cards:
      result.cards
  });

  io.to(
    room.id
  ).emit(
    'sfxEvent',
    {
      type:
        game.table.length > 1
          ? 'cut'
          : 'play'
    }
  );

  /*
    ყველა მოთამაშემ დადო.
  */

  if (
    game.table.length ===
    room.players.length
  ) {
    completeTrick(
      room
    );
  } else {
    setTurn(
      room,
      (
        game.currentTurnIndex + 1
      ) %
      room.players.length
    );

    broadcast(
      room
    );

    scheduleBot(
      room
    );
  }

  return {
    ok: true
  };
}

/* =========================================================
   BOT
========================================================= */

function chooseBotLeadCount(
  hand
) {
  /*
    ზოგჯერ ბოტმაც ითამაშოს
    2/3/4/5 კარტი.
  */

  if (
    Math.random() > 0.30
  ) {
    return 1;
  }

  for (
    let count =
      Math.min(
        5,
        hand.length
      );
    count >= 2;
    count--
  ) {
    if (
      hasSameSuitGroup(
        hand,
        count
      )
    ) {
      return count;
    }
  }

  return 1;
}

function botChoice(
  room,
  bot
) {
  const game =
    room.game;

  const hand =
    game.hands[
      bot.id
    ] ||
    [];

  if (
    !hand.length
  ) {
    return [];
  }

  /*
    მალიუტკაზე ბოტი აგდებს
    მთელ ხელს.
  */

  if (
    game.leadWasMaliutka &&
    game.table.length
  ) {
    return hand.map(
      function (
        card,
        index
      ) {
        return index;
      }
    );
  }

  /*
    პირველი სვლა.
  */

  if (
    game.table.length === 0
  ) {
    const count =
      chooseBotLeadCount(
        hand
      );

    return firstSameSuitGroup(
      hand,
      count
    );
  }

  /*
    საპასუხო სვლა.
  */

  const required =
    Math.min(
      game.leadCount || 1,
      hand.length
    );

  return firstSameSuitGroup(
    hand,
    required
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

  setTimeout(
    function () {
      botTurn(
        room,
        player
      );
    },
    650
  );
}

function botTurn(
  room,
  bot
) {
  if (
    !rooms.has(
      room.id
    )
    ||
    !room.game
    ||
    room.game.processing
    ||
    room.game.gameOver
  ) {
    return;
  }

  const currentPlayer =
    room.players[
      room.game.currentTurnIndex
    ];

  if (
    !currentPlayer ||
    currentPlayer.id !==
    bot.id
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
   AUTO PLAY AFTER TIMER
========================================================= */

function autoPlayCurrent(room) {
  if (
    !rooms.has(
      room.id
    )
    ||
    !room.game
    ||
    room.game.processing
    ||
    room.game.gameOver
  ) {
    return;
  }

  const game =
    room.game;

  const player =
    room.players[
      game.currentTurnIndex
    ];

  if (
    !player
  ) {
    return;
  }

  const hand =
    game.hands[
      player.id
    ] ||
    [];

  if (
    !hand.length
  ) {
    return;
  }

  let indexes;

  if (
    game.leadWasMaliutka &&
    game.table.length
  ) {
    indexes =
      hand.map(
        function (
          card,
          index
        ) {
          return index;
        }
      );
  } else if (
    game.table.length
  ) {
    indexes =
      firstSameSuitGroup(
        hand,
        Math.min(
          game.leadCount || 1,
          hand.length
        )
      );
  } else {
    indexes =
      [0];
  }

  io.to(
    room.id
  ).emit(
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
   SOCKET.IO
========================================================= */

io.on(
  'connection',
  function (socket) {

    /* =====================================================
       JOIN
    ===================================================== */

    socket.on(
      'joinTable',
      function (data) {
        const name =
          cleanName(
            data &&
            data.name
          );

        if (
          !name
        ) {
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
          capacity =
            3;
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
          parties =
            1;
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
          stake =
            5;
        }

        const tester =
          isTesterName(
            name
          );

        /*
          მხოლოდ ჯერ არდაწყებული
          შესაბამისი ოთახის ძებნა.
        */

        let room =
          Array
            .from(
              rooms.values()
            )
            .find(
              function (item) {
                return (
                  !item.game &&
                  item.capacity ===
                    capacity &&
                  item.parties ===
                    parties &&
                  item.stake ===
                    stake &&
                  item.players.length <
                    item.capacity
                );
              }
            );

        if (
          !room
        ) {
          room =
            createRoom(
              capacity,
              parties,
              stake
            );
        }

        socket.roomId =
          room.id;

        socket.join(
          room.id
        );

        room.players.push({
          id:
            socket.id,

          name:
            name,

          isBot:
            false,

          isTester:
            tester,

          balance:
            START_BALANCE,

          stats:
            createStats()
        });

        /*
          saba123:
          დარჩენილი ადგილები ბოტებით.
        */

        if (
          tester
        ) {
          let botNumber =
            1;

          while (
            room.players.length <
            room.capacity
          ) {
            room.players.push({
              id:
                makeId(
                  'bot'
                ),

              name:
                'BOT ' +
                botNumber,

              isBot:
                true,

              isTester:
                false,

              balance:
                START_BALANCE,

              stats:
                createStats()
            });

            botNumber++;
          }
        }

        /*
          თამაში იწყება ოთახის შევსებისას.
        */

        if (
          room.players.length ===
          room.capacity
        ) {
          room.game =
            startHand(
              room,
              null
            );

          /*
            პირველი შემოსული იწყებს.
          */

          setTurn(
            room,
            0
          );

          broadcast(
            room
          );

          io.to(
            room.id
          ).emit(
            'sfxEvent',
            {
              type:
                'deal'
            }
          );

          scheduleBot(
            room
          );
        } else {
          io.to(
            room.id
          ).emit(
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

    /* =====================================================
       PLAY CARDS
    ===================================================== */

    socket.on(
      'playCards',
      function (data) {
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

        const activePlayer =
          room.players[
            room.game.currentTurnIndex
          ];

        if (
          !activePlayer ||
          activePlayer.id !==
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
            socket.id
          ] ||
          [];

        let indexes =
          Array.isArray(
            data &&
            data.cardIndices
          )
            ? Array.from(
              new Set(
                data.cardIndices
              )
            )
            : [];

        indexes =
          indexes
            .filter(
              function (index) {
                return (
                  Number.isInteger(
                    index
                  )
                  &&
                  index >= 0
                  &&
                  index <
                  hand.length
                );
              }
            )
            .sort(
              function (a, b) {
                return a - b;
              }
            );

        const result =
          applyPlay(
            room,
            activePlayer,
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

    /* =====================================================
       QUICK CHAT
    ===================================================== */

    socket.on(
      'quickMessage',
      function (data) {
        const room =
          socket.roomId
            ? rooms.get(
              socket.roomId
            )
            : null;

        if (
          !room
        ) {
          return;
        }

        const player =
          room.players.find(
            function (item) {
              return (
                item.id ===
                socket.id
              );
            }
          );

        if (
          !player
        ) {
          return;
        }

        const allowed = [
          '⚡ სწრაფად!',
          '⏳ მალდე!',
          '👍 კარგი იყო',
          '🃏 ვაჰ, კოზირი!'
        ];

        const text =
          String(
            (
              data &&
              data.text
            ) ||
            ''
          );

        if (
          !allowed.includes(
            text
          )
        ) {
          return;
        }

        io.to(
          room.id
        ).emit(
          'quickMessage',
          {
            playerId:
              player.id,

            playerName:
              player.name,

            text:
              text
          }
        );
      }
    );

    /* =====================================================
       GIFTS
    ===================================================== */

    socket.on(
      'sendGift',
      function (data) {
        const room =
          socket.roomId
            ? rooms.get(
              socket.roomId
            )
            : null;

        if (
          !room
        ) {
          return;
        }

        const sender =
          room.players.find(
            function (player) {
              return (
                player.id ===
                socket.id
              );
            }
          );

        const targetId =
          String(
            (
              data &&
              data.targetPlayerId
            ) ||
            ''
          );

        const target =
          room.players.find(
            function (player) {
              return (
                player.id ===
                targetId
              );
            }
          );

        const type =
          String(
            (
              data &&
              data.type
            ) ||
            ''
          );

        const allowed = [
          'coffee',
          'egg',
          'clap',
          'heart'
        ];

        if (
          !sender ||
          !target ||
          sender.id ===
          target.id ||
          !allowed.includes(
            type
          )
        ) {
          return;
        }

        io.to(
          room.id
        ).emit(
          'giftEvent',
          {
            fromPlayerId:
              sender.id,

            fromPlayerName:
              sender.name,

            targetPlayerId:
              target.id,

            type:
              type
          }
        );
      }
    );

    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on(
      'disconnect',
      function () {
        const room =
          socket.roomId
            ? rooms.get(
              socket.roomId
            )
            : null;

        if (
          !room
        ) {
          return;
        }

        const remainingHumans =
          room.players.filter(
            function (player) {
              return (
                !player.isBot &&
                player.id !==
                socket.id
              );
            }
          );

        if (
          remainingHumans.length ===
          0
        ) {
          clearTimeout(
            room.timer
          );

          rooms.delete(
            room.id
          );

          return;
        }

        io.to(
          room.id
        ).emit(
          'errorMessage',
          'ერთ-ერთმა მოთამაშემ დატოვა მაგიდა.'
        );
      }
    );
  }
);

/* =========================================================
   FRONTEND
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

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Georgian:wght@400;500;600;700;800&display=swap');

* {
  box-sizing: border-box;
}

:root {
  --line: rgba(255,255,255,.11);
  --gold: #e9c66d;
  --gold2: #ffe79f;
  --green: #32d49a;
  --green2: #0eb980;
  --muted: #9cafaa;
  --felt: #0e6048;
  --felt2: #07372c;
}

html,
body {
  margin: 0;
  min-height: 100%;
  font-family:
    'Noto Sans Georgian',
    Inter,
    sans-serif;
  background: #050a08;
  color: #eef7f2;
}

button,
input,
select {
  font: inherit;
}

button {
  -webkit-tap-highlight-color:
    transparent;
}

body {
  background:
    radial-gradient(
      circle at 50% -10%,
      rgba(50,212,154,.17),
      transparent 36%
    ),
    radial-gradient(
      circle at 100% 20%,
      rgba(233,198,109,.12),
      transparent 28%
    ),
    linear-gradient(
      160deg,
      #030706,
      #091512 52%,
      #050b09
    );

  overflow-x:
    hidden;
}

.glass {
  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.075),
      rgba(255,255,255,.025)
    );

  border:
    1px solid var(--line);

  box-shadow:
    0 20px 60px
    rgba(0,0,0,.30);

  backdrop-filter:
    blur(18px);
}

/* =========================================================
   LOBBY
========================================================= */

#lobby {
  min-height: 100vh;
  padding: 24px;
  position: relative;
  overflow: hidden;
}

#lobby:before {
  content: '♠ ♥';
  position: absolute;
  left: -45px;
  top: 65px;
  font-size: 220px;
  opacity: .03;
  filter: blur(2px);
  transform: rotate(-15deg);
}

#lobby:after {
  content: '♦ ♣';
  position: absolute;
  right: -45px;
  bottom: 30px;
  font-size: 200px;
  opacity: .03;
  filter: blur(2px);
  transform: rotate(12deg);
}

.shell {
  width: min(1160px,100%);
  margin: auto;
  position: relative;
  z-index: 2;
}

.top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 22px;
}

.brand {
  font-weight: 800;
  font-size: 24px;
}

.brand span {
  color: var(--gold);
}

.testerHint {
  font-size: 11px;
  color: var(--muted);
}

.hero {
  display: grid;
  grid-template-columns:
    1.2fr .8fr;
  gap: 18px;
}

.heroCard,
.joinCard {
  padding: 28px;
  border-radius: 24px;
}

.heroCard {
  min-height: 335px;
  position: relative;
  overflow: hidden;
}

.heroCard:after {
  content: '♠  ♣  ♦  ♥';
  position: absolute;
  right: 30px;
  bottom: 25px;
  font-size: 64px;
  color:
    rgba(255,255,255,.055);
}

.eyebrow {
  display: inline-block;
  padding: 7px 11px;
  border-radius: 999px;
  border:
    1px solid
    rgba(50,212,154,.25);
  background:
    rgba(50,212,154,.08);
  color: #8cf2c7;
  font-size: 10px;
  font-weight: 800;
}

.heroCard h1 {
  font-size: 44px;
  line-height: 1.08;
  margin: 20px 0 12px;
}

.heroCard p {
  color: var(--muted);
  line-height: 1.7;
  font-size: 13px;
}

.field {
  margin: 12px 0;
}

.field label {
  display: block;
  margin-bottom: 7px;
  color: #bfd1c8;
  font-size: 11px;
  font-weight: 700;
}

.field input,
.field select {
  width: 100%;
  height: 45px;
  padding: 0 12px;
  color: #fff;
  border:
    1px solid var(--line);
  border-radius: 12px;
  background:
    rgba(0,0,0,.30);
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color:
    rgba(50,212,154,.65);

  box-shadow:
    0 0 0 4px
    rgba(50,212,154,.08);
}

.row2 {
  display: grid;
  grid-template-columns:
    1fr 1fr;
  gap: 10px;
}

.primary {
  width: 100%;
  height: 48px;
  border: 0;
  border-radius: 13px;
  background:
    linear-gradient(
      135deg,
      var(--green),
      var(--green2)
    );
  color: #032319;
  font-weight: 800;
  cursor: pointer;
  box-shadow:
    0 14px 30px
    rgba(14,185,128,.25);
}

.primary:disabled {
  opacity: .55;
  cursor: wait;
}

.wait {
  min-height: 22px;
  margin-top: 10px;
  color: var(--gold2);
  font-size: 11px;
}

.stakes {
  display: grid;
  grid-template-columns:
    repeat(5,1fr);
  gap: 10px;
  margin-top: 18px;
}

.stake {
  padding: 16px;
  border:
    1px solid var(--line);
  border-radius: 16px;
  background:
    rgba(255,255,255,.035);
  color: var(--muted);
  cursor: pointer;
  transition: .18s;
}

.stake:hover,
.stake.active {
  transform:
    translateY(-4px)
    scale(1.02);
  color: var(--gold2);
  border-color:
    rgba(233,198,109,.58);
  background:
    rgba(233,198,109,.09);
  box-shadow:
    0 12px 26px
    rgba(0,0,0,.28);
}

.stake b {
  display: block;
  font-size: 20px;
}

.stake span {
  font-size: 9px;
}

/* =========================================================
   GAME HEADER
========================================================= */

#game {
  display: none;
  min-height: 100vh;
  padding: 12px;
}

.gameShell {
  width: min(1540px,100%);
  margin: auto;
}

.gameTop {
  display: grid;
  grid-template-columns:
    1fr auto auto;
  gap: 10px;
  align-items: center;
}

.titleBox {
  padding: 13px 15px;
  border-radius: 15px;
}

.titleBox b {
  font-size: 17px;
}

.titleBox span {
  display: block;
  color: var(--muted);
  font-size: 10px;
}

.hud {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.hudBox {
  min-width: 74px;
  padding: 9px 10px;
  text-align: center;
  border-radius: 13px;
}

.hudBox small {
  display: block;
  color: var(--muted);
  font-size: 8px;
}

.hudBox b {
  font-size: 13px;
  color: var(--gold2);
}

.topBtn {
  height: 41px;
  padding: 0 12px;
  border:
    1px solid var(--line);
  border-radius: 11px;
  background:
    rgba(255,255,255,.05);
  color: #fff;
  cursor: pointer;
}

.status {
  min-height: 34px;
  display: grid;
  place-items: center;
  color: var(--gold2);
  font-weight: 800;
  font-size: 12px;
}

.layout {
  display: grid;
  grid-template-columns:
    minmax(0,1fr)
    290px;
  gap: 12px;
}

/* =========================================================
   TABLE
========================================================= */

.tableStage {
  height: 720px;
  position: relative;
  overflow: hidden;
  border-radius: 28px;
  border:
    1px solid var(--line);

  background:
    radial-gradient(
      circle at 50% 10%,
      rgba(255,255,255,.05),
      transparent 28%
    ),
    linear-gradient(
      145deg,
      #1a120e,
      #080a09
    );

  box-shadow:
    0 28px 85px
    rgba(0,0,0,.50);
}

.tableWood {
  position: absolute;
  inset:
    42px 62px 76px;

  border-radius:
    50% / 39%;

  background:
    linear-gradient(
      145deg,
      #9a6741,
      #593620 56%,
      #2d1a11
    );

  box-shadow:
    inset 0 0 0 15px
    rgba(44,23,13,.75),
    inset 0 0 65px
    rgba(0,0,0,.50),
    0 28px 45px
    rgba(0,0,0,.32);
}

.felt {
  position: absolute;
  inset:
    80px 105px 114px;

  border-radius:
    50% / 39%;

  background:
    radial-gradient(
      ellipse at 50% 44%,
      rgba(255,255,255,.035),
      transparent 22%
    ),
    repeating-radial-gradient(
      circle at 35% 35%,
      rgba(255,255,255,.018)
      0 1px,
      transparent 1px 4px
    ),
    radial-gradient(
      ellipse,
      var(--felt),
      var(--felt2) 75%
    );

  border:
    3px solid
    rgba(255,255,255,.07);

  box-shadow:
    inset 0 0 95px
    rgba(0,0,0,.52);
}

.felt:after {
  content:
    'WRITTEN BURA';

  position: absolute;
  left: 50%;
  top: 50%;

  transform:
    translate(-50%,-50%);

  font-weight: 800;
  letter-spacing: 8px;

  color:
    rgba(255,255,255,.045);

  white-space: nowrap;
}

/* =========================================================
   DECK / TRUMP
========================================================= */

.deckZone {
  position: absolute;
  left: 50%;
  top: 43%;

  transform:
    translate(-50%,-50%);

  display: flex;
  gap: 18px;

  z-index: 4;
}

.deckStack {
  width: 58px;
  height: 82px;

  border-radius: 7px;

  border:
    2px solid
    rgba(255,255,255,.78);

  background:
    repeating-linear-gradient(
      45deg,
      #213952 0 4px,
      #13243a 4px 8px
    );

  box-shadow:
    5px 5px 0
    rgba(255,255,255,.12),
    0 8px 20px
    rgba(0,0,0,.35);
}

.deckLabel {
  text-align: center;
  color: var(--muted);
  font-size: 9px;
  margin-top: 4px;
}

.trumpSlot {
  width: 58px;
  height: 82px;
}

/* =========================================================
   TABLE PLAYS
========================================================= */

.tableCards {
  position: absolute;
  left: 50%;
  top: 56%;

  transform:
    translate(-50%,-50%);

  z-index: 6;

  display: flex;
  justify-content: center;
  align-items: center;
  gap: 9px;

  max-width: 72%;
}

.playGroup {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.playName {
  padding: 3px 7px;
  border-radius: 999px;
  background:
    rgba(0,0,0,.42);
  font-size: 8px;
  margin-bottom: 4px;
}

.playGroup.winner .card {
  box-shadow:
    0 0 28px
    rgba(255,225,150,.95);

  border-color:
    var(--gold2);
}

/* =========================================================
   PLAYER
========================================================= */

.seat {
  position: absolute;

  transform:
    translate(-50%,-50%);

  width: 162px;

  text-align: center;

  z-index: 8;
}

.seatBox {
  position: relative;

  padding: 8px;

  border:
    1px solid var(--line);

  border-radius: 16px;

  background:
    rgba(5,12,10,.84);

  backdrop-filter:
    blur(10px);
}

.seat.current .seatBox {
  border-color:
    var(--gold2);

  box-shadow:
    0 0 0 2px
    rgba(233,198,109,.08),
    0 0 28px
    rgba(233,198,109,.32);

  animation:
    seatPulse
    1.5s
    ease-in-out
    infinite;
}

.avatarWrap {
  width: 58px;
  height: 58px;
  margin: auto;
  position: relative;
}

.avatar {
  position: absolute;
  inset: 4px;

  border-radius: 50%;

  cursor: pointer;

  background:
    radial-gradient(
      circle at 40% 30%,
      #d9bca5,
      #93644b 48%,
      #2d1c16 49%
    );

  border:
    3px solid
    rgba(233,198,109,.70);

  z-index: 2;
}

.frame-gold .avatar {
  border-color:
    #ffd86b;

  box-shadow:
    0 0 15px
    rgba(255,216,107,.45);
}

.frame-diamond .avatar {
  border-color:
    #aeeeff;

  box-shadow:
    0 0 18px
    rgba(174,238,255,.55);
}

.timerRing {
  position: absolute;
  inset: -2px;

  border-radius: 50%;

  background:
    conic-gradient(
      var(--gold)
      var(--turn,0%),
      rgba(255,255,255,.07)
      0
    );

  filter:
    drop-shadow(
      0 0 8px
      rgba(233,198,109,.38)
    );

  z-index: 1;
}

.seatName {
  margin-top: 5px;
  font-size: 10px;
  font-weight: 800;
}

.seatMeta {
  color: var(--muted);
  font-size: 8px;
}

.backs {
  display: flex;
  justify-content: center;
  margin-top: 5px;
}

.back {
  width: 17px;
  height: 25px;

  margin-left: -6px;

  border-radius: 3px;

  border:
    1px solid
    rgba(255,255,255,.55);

  background:
    repeating-linear-gradient(
      45deg,
      #263c55 0 3px,
      #14253a 3px 6px
    );
}

.back:first-child {
  margin-left: 0;
}

.reactionBubble {
  position: absolute;

  top: -32px;
  left: 50%;

  transform:
    translateX(-50%);

  padding: 5px 8px;

  border-radius: 9px;

  background: white;
  color: #111;

  font-size: 9px;

  white-space: nowrap;

  animation:
    bubble 2.5s forwards;

  z-index: 20;
}

.giftAnim {
  position: absolute;

  left: 50%;
  top: 10px;

  font-size: 34px;

  z-index: 30;

  pointer-events: none;

  animation:
    giftFly
    1.6s
    ease-out
    forwards;
}

/* =========================================================
   PLAYER HAND
========================================================= */

.handZone {
  position: absolute;
  left: 50%;
  bottom: 14px;

  transform:
    translateX(-50%);

  z-index: 12;

  width:
    min(900px,95%);

  text-align: center;
}

.hand {
  height: 140px;

  display: flex;

  justify-content: center;

  align-items: flex-end;
}

.hand .card {
  margin-left: -18px;

  position: relative;

  transform-origin:
    50% 116%;

  transition:
    transform .18s ease,
    box-shadow .18s ease,
    filter .18s ease;
}

.hand .card:first-child {
  margin-left: 0;
}

.hand .card:hover {
  transform:
    translateY(-18px)
    scale(1.045)
    !important;

  z-index: 50;
}

.hand .card.selected {
  transform:
    translateY(-28px)
    scale(1.06)
    !important;

  border:
    3px solid
    var(--gold2);

  box-shadow:
    0 0 0 3px
    rgba(255,231,159,.20),
    0 0 25px
    rgba(255,231,159,.58),
    0 16px 30px
    rgba(0,0,0,.40);

  z-index: 60;
}

.playBtn {
  min-width: 220px;
  height: 45px;

  border: 0;

  border-radius: 999px;

  background:
    linear-gradient(
      135deg,
      var(--green),
      var(--green2)
    );

  color: #032319;

  font-weight: 800;

  cursor: pointer;

  box-shadow:
    0 12px 28px
    rgba(14,185,128,.26);
}

.playBtn:disabled {
  background:
    #28332f;

  color:
    #75857f;

  box-shadow:
    none;

  cursor:
    not-allowed;
}

.selectedCount {
  margin-top: 4px;

  color: var(--muted);

  font-size: 10px;
}

/* =========================================================
   CARD
========================================================= */

.card {
  width: 70px;
  height: 102px;

  padding: 6px;

  display: flex;

  flex-direction: column;

  justify-content:
    space-between;

  border-radius: 10px;

  background: #fff;

  border:
    1px solid
    rgba(0,0,0,.18);

  box-shadow:
    0 8px 22px
    rgba(0,0,0,.36);

  font-weight: 900;

  user-select: none;

  cursor: pointer;
}

.cardTop,
.cardBottom {
  display: flex;
  gap: 3px;
  font-size: 13px;
}

.cardCenter {
  text-align: center;
  font-size: 34px;
  line-height: 1;
}

.cardBottom {
  transform:
    rotate(180deg);
}

.suit-spades {
  color: #070707;
}

.suit-clubs {
  color: #007956;

  background:
    linear-gradient(
      #fff,
      #f0fbf6
    );
}

.suit-diamonds {
  color: #082966;

  background:
    linear-gradient(
      #fff,
      #f1f5ff
    );
}

.suit-hearts {
  color: #74152d;

  background:
    linear-gradient(
      #fff,
      #fff1f4
    );
}

/* =========================================================
   SIDE PANELS
========================================================= */

.sidePanel {
  border-radius: 18px;
  margin-bottom: 10px;
  overflow: hidden;
}

.panelHead {
  width: 100%;

  display: flex;

  justify-content:
    space-between;

  align-items: center;

  border: 0;

  color: #fff;

  background:
    transparent;

  padding: 13px 14px;

  cursor: pointer;

  font-weight: 800;
}

.panelHead small {
  color: var(--muted);
}

.panelBody {
  padding:
    0 14px 14px;
}

.panelBody.collapsed {
  display: none;
}

.scoreRow {
  display: grid;

  grid-template-columns:
    34px 1fr 52px 54px;

  gap: 5px;

  align-items: center;

  padding: 9px 5px;

  border-top:
    1px solid var(--line);

  font-size: 9px;
}

.scoreRow.first {
  background:
    rgba(233,198,109,.07);

  border-radius: 9px;
}

.scoreRow .last {
  text-align: right;

  color: var(--muted);
}

.scoreRow .total {
  text-align: right;

  color: var(--gold2);

  font-weight: 800;

  font-size: 12px;
}

.quickGrid {
  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 6px;
}

.quickBtn {
  border:
    1px solid var(--line);

  background:
    rgba(255,255,255,.04);

  color: #fff;

  padding: 8px;

  border-radius: 9px;

  font-size: 9px;

  cursor: pointer;
}

.quickBtn:hover {
  border-color:
    rgba(50,212,154,.50);
}

.testerHand {
  padding: 8px;

  margin-top: 7px;

  border-radius: 9px;

  background:
    rgba(255,255,255,.04);

  font-size: 9px;
}

.mini {
  display: flex;

  gap: 4px;

  flex-wrap: wrap;

  margin-top: 5px;
}

.mini span {
  color: #111;

  background: #fff;

  padding: 3px 5px;

  border-radius: 5px;
}

/* =========================================================
   GIFTS MENU
========================================================= */

.giftMenu {
  display: none;

  position: fixed;

  z-index: 999;

  width: 175px;

  padding: 10px;

  border:
    1px solid var(--line);

  border-radius: 14px;

  background:
    rgba(7,14,12,.96);

  box-shadow:
    0 20px 50px
    rgba(0,0,0,.50);
}

.giftMenu.show {
  display: grid;

  grid-template-columns:
    1fr 1fr;

  gap: 6px;
}

.giftBtn {
  border:
    1px solid var(--line);

  background:
    rgba(255,255,255,.05);

  color: #fff;

  border-radius: 9px;

  padding: 9px;

  cursor: pointer;
}

.giftBtn:hover {
  background:
    rgba(233,198,109,.10);

  border-color:
    rgba(233,198,109,.50);
}

/* =========================================================
   ACHIEVEMENT
========================================================= */

.achievementToast {
  position: fixed;

  left: 50%;
  top: 72px;

  transform:
    translateX(-50%);

  z-index: 1000;

  min-width: 260px;

  text-align: center;

  padding: 13px 18px;

  border-radius: 14px;

  border:
    1px solid
    rgba(255,220,120,.55);

  background:
    rgba(20,17,8,.96);

  box-shadow:
    0 15px 45px
    rgba(0,0,0,.45),
    0 0 30px
    rgba(255,220,120,.18);

  animation:
    toastIn
    3.7s
    forwards;
}

/* =========================================================
   ANIMATIONS
========================================================= */

@keyframes seatPulse {
  0%,
  100% {
    filter:
      brightness(1);
  }

  50% {
    filter:
      brightness(1.18);
  }
}

@keyframes cardFly {
  from {
    opacity: 0;

    transform:
      translateY(65px)
      scale(.76);
  }

  to {
    opacity: 1;

    transform:
      translateY(0)
      scale(1);
  }
}

.playGroup .card {
  animation:
    cardFly
    .4s
    ease;
}

@keyframes bubble {
  0% {
    opacity: 0;

    transform:
      translate(-50%,8px);
  }

  15%,
  80% {
    opacity: 1;

    transform:
      translate(-50%,0);
  }

  100% {
    opacity: 0;

    transform:
      translate(-50%,-8px);
  }
}

@keyframes giftFly {
  0% {
    opacity: 0;

    transform:
      translate(-50%,20px)
      scale(.6)
      rotate(-15deg);
  }

  25% {
    opacity: 1;
  }

  100% {
    opacity: 0;

    transform:
      translate(-50%,-95px)
      scale(1.45)
      rotate(15deg);
  }
}

@keyframes toastIn {
  0% {
    opacity: 0;

    transform:
      translate(-50%,-15px)
      scale(.9);
  }

  12%,
  82% {
    opacity: 1;

    transform:
      translate(-50%,0)
      scale(1);
  }

  100% {
    opacity: 0;

    transform:
      translate(-50%,-12px)
      scale(.97);
  }
}

/* =========================================================
   MOBILE
========================================================= */

@media(max-width:1100px) {
  .layout {
    grid-template-columns:
      1fr;
  }

  .tableStage {
    height: 660px;
  }
}

@media(max-width:800px) {
  #lobby {
    padding: 14px;
  }

  .hero {
    grid-template-columns:
      1fr;
  }

  .heroCard h1 {
    font-size: 35px;
  }

  .gameTop {
    grid-template-columns:
      1fr;
  }

  .tableStage {
    height: 590px;
  }

  .tableWood {
    inset:
      38px 24px 70px;
  }

  .felt {
    inset:
      75px 53px 115px;
  }

  .seat {
    width: 120px;
  }

  .avatarWrap {
    width: 48px;
    height: 48px;
  }

  .card {
    width: 57px;
    height: 85px;
  }

  .cardCenter {
    font-size: 27px;
  }

  .tableCards {
    max-width: 80%;
  }

  .stakes {
    grid-template-columns:
      repeat(3,1fr);
  }
}

@media(max-width:520px) {
  .heroCard,
  .joinCard {
    padding: 19px;
  }

  .heroCard h1 {
    font-size: 29px;
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
    height: 540px;
  }

  .tableWood {
    inset:
      30px 7px 64px;
  }

  .felt {
    inset:
      70px 27px 118px;
  }

  .seat {
    width: 93px;
  }

  .avatarWrap {
    width: 42px;
    height: 42px;
  }

  .seatName {
    font-size: 8px;
  }

  .seatMeta {
    font-size: 6px;
  }

  .card {
    width: 49px;
    height: 73px;
    padding: 4px;
  }

  .cardTop,
  .cardBottom {
    font-size: 9px;
  }

  .cardCenter {
    font-size: 21px;
  }

  .hand {
    height: 100px;
  }

  .hand .card {
    margin-left: -15px;
  }

  .tableCards {
    gap: 4px;
    max-width: 88%;
  }

  .quickGrid {
    grid-template-columns:
      1fr;
  }
}

</style>

</head>

<body>

<!-- ======================================================
     LOBBY
======================================================= -->

<section id="lobby">

<div class="shell">

<div class="top">

<div class="brand">
WRITTEN <span>BURA</span>
</div>

<div class="testerHint">
TEST MODE:
<b>saba123</b>
</div>

</div>

<div class="hero">

<div class="heroCard glass">

<div class="eyebrow">
PREMIUM CARD ROOM
</div>

<h1>
წერითი ბურა
</h1>

<p>
1-დან 5 კარტამდე ერთმასტიანი სვლა,
4-კარტიანი კომბინაცია,
5-კარტიანი მალიუტკა,
20-წამიანი ტაიმერი,
Live Score, XP/Level, Achievements,
რეაქციები და საჩუქრები.
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
  id="joinButton"
  class="primary"
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
  data-stake="5"
>
<b>$5</b>
<span>CLASSIC</span>
</button>

<button
  class="stake"
  data-stake="10"
>
<b>$10</b>
<span>STANDARD</span>
</button>

<button
  class="stake"
  data-stake="25"
>
<b>$25</b>
<span>PREMIUM</span>
</button>

<button
  class="stake"
  data-stake="50"
>
<b>$50</b>
<span>VIP</span>
</button>

<button
  class="stake"
  data-stake="100"
>
<b>$100</b>
<span>ELITE</span>
</button>

</div>

</div>

</section>

<!-- ======================================================
     GAME
======================================================= -->

<section id="game">

<div class="gameShell">

<div class="gameTop">

<div class="titleBox glass">

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
  class="topBtn"
>
🔊 SFX
</button>

<button
  id="exitBtn"
  class="topBtn"
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

<div class="felt"></div>

<div class="deckZone">

<div>

<div class="deckStack"></div>

<div class="deckLabel">
DECK
<span id="centerDeck">36</span>
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

<div class="sidePanel glass">

<button
  class="panelHead"
  data-target="scoreBody"
>
<span>🏆 LIVE SCORE</span>
<small>▼</small>
</button>

<div
  id="scoreBody"
  class="panelBody"
>
<div id="score"></div>
</div>

</div>

<div class="sidePanel glass">

<button
  class="panelHead"
  data-target="quickBody"
>
<span>💬 რეაქციები</span>
<small>▼</small>
</button>

<div
  id="quickBody"
  class="panelBody"
>

<div class="quickGrid">

<button
  class="quickBtn"
  data-message="⚡ სწრაფად!"
>
⚡ სწრაფად!
</button>

<button
  class="quickBtn"
  data-message="⏳ მალდე!"
>
⏳ მალდე!
</button>

<button
  class="quickBtn"
  data-message="👍 კარგი იყო"
>
👍 კარგი იყო
</button>

<button
  class="quickBtn"
  data-message="🃏 ვაჰ, კოზირი!"
>
🃏 ვაჰ, კოზირი!
</button>

</div>

</div>

</div>

<div
  id="testerPanel"
  class="sidePanel glass"
>

<button
  class="panelHead"
  data-target="testerBody"
>
<span>🧪 TEST MODE</span>
<small>▼</small>
</button>

<div
  id="testerBody"
  class="panelBody"
>

<div id="testerGrid"></div>

</div>

</div>

</aside>

</div>

</div>

</section>

<!-- Gift menu -->

<div
  id="giftMenu"
  class="giftMenu"
>

<button
  class="giftBtn"
  data-gift="coffee"
>
☕ ყავა
</button>

<button
  class="giftBtn"
  data-gift="egg"
>
🥚 კვერცხი
</button>

<button
  class="giftBtn"
  data-gift="clap"
>
👏 ტაში
</button>

<button
  class="giftBtn"
  data-gift="heart"
>
❤️ გული
</button>

</div>

<script>

/* =========================================================
   GLOBAL
========================================================= */

var socket =
  io();

var current =
  null;

var selected =
  [];

var sfxEnabled =
  true;

var timerFrame =
  null;

var giftTargetId =
  null;

function q(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
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
  var map = {
    spades:
      '♠',

    clubs:
      '♣',

    diamonds:
      '♦',

    hearts:
      '♥'
  };

  return (
    map[suit] ||
    ''
  );
}

function trumpText(trump) {
  if (
    trump ===
    'no_trump'
  ) {
    return 'უკოზირო';
  }

  return suitSymbol(
    trump
  );
}

/* =========================================================
   SOCKET STATUS
========================================================= */

socket.on(
  'connect',
  function () {
    console.log(
      'Socket connected:',
      socket.id
    );

    q('joinButton').disabled =
      false;
  }
);

socket.on(
  'connect_error',
  function (error) {
    console.error(
      'Socket error:',
      error
    );

    q('wait').textContent =
      'სერვერთან კავშირი ვერ შედგა: ' +
      error.message;

    q('joinButton').disabled =
      false;
  }
);

/* =========================================================
   LOBBY EVENTS
========================================================= */

document
  .querySelectorAll(
    '.stake'
  )
  .forEach(
    function (button) {
      button.addEventListener(
        'click',
        function () {
          document
            .querySelectorAll(
              '.stake'
            )
            .forEach(
              function (item) {
                item
                  .classList
                  .remove(
                    'active'
                  );
              }
            );

          button
            .classList
            .add(
              'active'
            );

          q('stake').value =
            button.getAttribute(
              'data-stake'
            );
        }
      );
    }
  );

q('joinButton')
  .addEventListener(
    'click',
    joinGame
  );

q('playBtn')
  .addEventListener(
    'click',
    playSelected
  );

q('sfxBtn')
  .addEventListener(
    'click',
    toggleSfx
  );

q('exitBtn')
  .addEventListener(
    'click',
    function () {
      window.location.reload();
    }
  );

document
  .querySelectorAll(
    '.quickBtn'
  )
  .forEach(
    function (button) {
      button.addEventListener(
        'click',
        function () {
          socket.emit(
            'quickMessage',
            {
              text:
                button.getAttribute(
                  'data-message'
                )
            }
          );
        }
      );
    }
  );

/* =========================================================
   COLLAPSIBLE PANELS
========================================================= */

document
  .querySelectorAll(
    '.panelHead'
  )
  .forEach(
    function (button) {
      button.addEventListener(
        'click',
        function () {
          var targetId =
            button.getAttribute(
              'data-target'
            );

          var body =
            q(
              targetId
            );

          body
            .classList
            .toggle(
              'collapsed'
            );

          var icon =
            button.querySelector(
              'small'
            );

          icon.textContent =
            body
              .classList
              .contains(
                'collapsed'
              )
                ? '▶'
                : '▼';
        }
      );
    }
  );

/* =========================================================
   GIFTS
========================================================= */

document
  .querySelectorAll(
    '.giftBtn'
  )
  .forEach(
    function (button) {
      button.addEventListener(
        'click',
        function () {
          if (
            !giftTargetId
          ) {
            return;
          }

          socket.emit(
            'sendGift',
            {
              targetPlayerId:
                giftTargetId,

              type:
                button.getAttribute(
                  'data-gift'
                )
            }
          );

          closeGiftMenu();
        }
      );
    }
  );

document.addEventListener(
  'click',
  function (event) {
    if (
      !event.target.closest(
        '#giftMenu'
      )
      &&
      !event.target.closest(
        '.avatar'
      )
    ) {
      closeGiftMenu();
    }
  }
);

/* =========================================================
   JOIN
========================================================= */

function joinGame() {
  var name =
    q('playerName')
      .value
      .trim();

  if (
    !name
  ) {
    alert(
      'შეიყვანე მოთამაშის სახელი.'
    );

    return;
  }

  if (
    !socket.connected
  ) {
    q('wait').textContent =
      'სერვერთან დაკავშირებას ველოდებით...';

    return;
  }

  q('joinButton').disabled =
    true;

  q('wait').textContent =
    name.toLowerCase() ===
    'saba123'
      ? 'TEST მაგიდა მზადდება...'
      : 'ვეძებთ მოთამაშეებს...';

  socket.emit(
    'joinTable',
    {
      name:
        name,

      capacity:
        Number(
          q('capacity').value
        ),

      parties:
        Number(
          q('parties').value
        ),

      stake:
        Number(
          q('stake').value
        )
    }
  );
}

/* =========================================================
   SOCKET GAME EVENTS
========================================================= */

socket.on(
  'waitingForPlayers',
  function (data) {
    q('wait').textContent =
      'ველოდებით მოთამაშეებს: ' +
      data.current +
      ' / ' +
      data.max;

    q('joinButton').disabled =
      true;
  }
);

socket.on(
  'errorMessage',
  function (message) {
    console.warn(
      message
    );

    if (
      q('game').style.display ===
      'block'
    ) {
      q('status').textContent =
        message;
    } else {
      q('wait').textContent =
        message;

      q('joinButton').disabled =
        false;
    }
  }
);

socket.on(
  'gameStateUpdate',
  function (state) {
    current =
      state;

    selected =
      [];

    q('lobby').style.display =
      'none';

    q('game').style.display =
      'block';

    render(
      state
    );
  }
);

socket.on(
  'sfxEvent',
  function (event) {
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
  'quickMessage',
  function (message) {
    showReaction(
      message
    );
  }
);

socket.on(
  'giftEvent',
  function (event) {
    showGift(
      event
    );
  }
);

socket.on(
  'achievement',
  function (achievement) {
    showAchievement(
      achievement
    );
  }
);

socket.on(
  'gameWinner',
  function (winner) {
    showAchievement({
      playerName:
        winner.playerName,

      title:
        'თამაშის გამარჯვებული 🏆'
    });
  }
);

/* =========================================================
   CARD UI
========================================================= */

function createCardElement(card) {
  var element =
    document.createElement(
      'div'
    );

  element.className =
    'card suit-' +
    card.suit;

  var symbol =
    suitSymbol(
      card.suit
    );

  element.innerHTML =
    '<div class="cardTop">' +
      '<span>' +
        escapeHtml(
          card.rank
        ) +
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
        escapeHtml(
          card.rank
        ) +
      '</span>' +
      '<span>' +
        symbol +
      '</span>' +
    '</div>';

  return element;
}

/* =========================================================
   MAIN RENDER
========================================================= */

function render(state) {
  q('tableSub').textContent =
    state.capacity +
    ' players · $' +
    state.stake;

  q('hudParty').textContent =
    state.partyIndex +
    ' / ' +
    state.parties;

  q('hudHand').textContent =
    state.handIndex +
    ' / ' +
    state.totalHands;

  q('hudTrump').textContent =
    trumpText(
      state.trump
    );

  q('hudDeck').textContent =
    state.deckCount;

  q('centerDeck').textContent =
    state.deckCount;

  q('hudStake').textContent =
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

  renderTester(
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
  var slot =
    q('trumpSlot');

  slot.innerHTML =
    '';

  if (
    trump ===
    'no_trump'
  ) {
    var card =
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
      '26px';

    card.textContent =
      'Ø';

    slot.appendChild(
      card
    );

    return;
  }

  slot.appendChild(
    createCardElement({
      rank:
        'K',

      suit:
        trump
    })
  );
}

/* =========================================================
   PLAYER POSITION
========================================================= */

function seatPosition(
  index,
  count,
  myId,
  players
) {
  var myIndex =
    players.findIndex(
      function (player) {
        return (
          player.id ===
          myId
        );
      }
    );

  if (
    myIndex < 0
  ) {
    myIndex =
      0;
  }

  var relative =
    (
      index -
      myIndex +
      count
    ) %
    count;

  var positions3 = [
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

  var positions4 = [
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
      top: 16
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
  )[
    relative
  ];
}

/* =========================================================
   PLAYERS
========================================================= */

function renderPlayers(state) {
  var root =
    q('players');

  root.innerHTML =
    '';

  state.players.forEach(
    function (
      player,
      index
    ) {
      var pos =
        seatPosition(
          index,
          state.players.length,
          state.viewingPlayerId,
          state.players
        );

      var seat =
        document.createElement(
          'div'
        );

      seat.className =
        'seat ' +
        (
          player.isCurrent
            ? 'current '
            : ''
        ) +
        'frame-' +
        player.frame;

      seat.dataset.playerId =
        player.id;

      seat.style.left =
        pos.left +
        '%';

      seat.style.top =
        pos.top +
        '%';

      var backs =
        '';

      if (
        player.id !==
        state.viewingPlayerId
      ) {
        for (
          var i = 0;
          i <
          player.cardCount;
          i++
        ) {
          backs +=
            '<div class="back"></div>';
        }
      }

      seat.innerHTML =
        '<div class="seatBox">' +

          '<div class="avatarWrap">' +
            '<div class="timerRing"></div>' +
            '<div class="avatar"></div>' +
          '</div>' +

          '<div class="seatName">' +
            escapeHtml(
              player.name
            ) +
            (
              player.isBot
                ? ' 🤖'
                : ''
            ) +
          '</div>' +

          '<div class="seatMeta">' +
            'Lv.' +
            player.level +
            ' · XP ' +
            player.xp +
            ' · W ' +
            player.wins +
          '</div>' +

          '<div class="seatMeta">' +
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

      var avatar =
        seat.querySelector(
          '.avatar'
        );

      avatar.addEventListener(
        'click',
        function (event) {
          event.stopPropagation();

          /*
            საკუთარ თავზე საჩუქარი არა.
          */

          if (
            player.id ===
            state.viewingPlayerId
          ) {
            return;
          }

          openGiftMenu(
            player.id,
            event.clientX,
            event.clientY
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
  var root =
    q('tableCards');

  root.innerHTML =
    '';

  state.table.forEach(
    function (play) {
      var group =
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

      var name =
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
        function (card) {
          group.appendChild(
            createCardElement(
              card
            )
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
   MY HAND
========================================================= */

function renderHand(state) {
  var root =
    q('myCards');

  root.innerHTML =
    '';

  var cards =
    state.playersCards[
      state.viewingPlayerId
    ] ||
    [];

  var middle =
    (
      cards.length -
      1
    ) /
    2;

  cards.forEach(
    function (
      card,
      index
    ) {
      var element =
        createCardElement(
          card
        );

      var delta =
        index -
        middle;

      element.style.transform =
        'rotate(' +
        (
          delta * 3.6
        ) +
        'deg) translateY(' +
        (
          Math.abs(
            delta
          ) * 1.7
        ) +
        'px)';

      element.addEventListener(
        'click',
        function () {
          toggleCard(
            index,
            element
          );
        }
      );

      root.appendChild(
        element
      );
    }
  );

  updateSelectedCount();

  updatePlayButton();
}

/* =========================================================
   SELECTION
========================================================= */

function toggleCard(
  index,
  element
) {
  var existing =
    selected.indexOf(
      index
    );

  if (
    existing >= 0
  ) {
    selected.splice(
      existing,
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

  updateSelectedCount();

  updatePlayButton();
}

function selectedCards() {
  if (
    !current
  ) {
    return [];
  }

  var hand =
    current.playersCards[
      current.viewingPlayerId
    ] ||
    [];

  return selected
    .map(
      function (index) {
        return hand[index];
      }
    )
    .filter(
      Boolean
    );
}

function sameSuitClient(cards) {
  if (
    !cards.length
  ) {
    return false;
  }

  return cards.every(
    function (card) {
      return (
        card.suit ===
        cards[0].suit
      );
    }
  );
}

/* =========================================================
   CLIENT VALIDATION
========================================================= */

function selectionValidClient() {
  if (
    !current ||
    !selected.length
  ) {
    return false;
  }

  var hand =
    current.playersCards[
      current.viewingPlayerId
    ] ||
    [];

  var cards =
    selectedCards();

  if (
    cards.length < 1 ||
    cards.length > 5
  ) {
    return false;
  }

  var oneSuit =
    sameSuitClient(
      cards
    );

  /*
    პირველი სვლა.
  */

  if (
    current.table.length === 0
  ) {
    return oneSuit;
  }

  /*
    მალიუტკაზე მთელი ხელი.
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
    ჩვეულებრივი პასუხი.
  */

  if (
    cards.length !==
    current.leadCount
  ) {
    return false;
  }

  var canSameSuit =
    [
      'spades',
      'clubs',
      'diamonds',
      'hearts'
    ].some(
      function (suit) {
        return (
          hand.filter(
            function (card) {
              return (
                card.suit ===
                suit
              );
            }
          ).length >=
          current.leadCount
        );
      }
    );

  if (
    canSameSuit
  ) {
    return oneSuit;
  }

  return true;
}

/* =========================================================
   BUTTON TEXT
========================================================= */

function updateSelectedCount() {
  var count =
    selected.length;

  q('selectedCount').textContent =
    'არჩეული: ' +
    count +
    ' / 5';

  var button =
    q('playBtn');

  if (
    count === 5 &&
    sameSuitClient(
      selectedCards()
    )
  ) {
    button.textContent =
      'ჩადი მალიუტკა!';
  } else if (
    count > 0
  ) {
    button.textContent =
      'ჩადი ' +
      count +
      ' კარტი';
  } else {
    button.textContent =
      'სვლის გაკეთება';
  }
}

function updatePlayButton() {
  var button =
    q('playBtn');

  if (
    !current
  ) {
    button.disabled =
      true;

    return;
  }

  var active =
    current.players[
      current.currentTurnIndex
    ];

  button.disabled =
    !active
    ||
    active.id !==
      current.viewingPlayerId
    ||
    current.processing
    ||
    current.gameOver
    ||
    !selectionValidClient();
}

/* =========================================================
   PLAY
========================================================= */

function playSelected() {
  if (
    !selectionValidClient()
  ) {
    alert(
      'სვლა არასწორია. აირჩიე ერთი მასტის 1-5 კარტი; პასუხზე რაოდენობა უნდა ემთხვეოდეს, მალიუტკაზე კი მთელი ხელი უნდა ჩამოხვიდე.'
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
  var element =
    q('status');

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
      '✨ კარტები ითვლება...';

    return;
  }

  var player =
    state.players[
      state.currentTurnIndex
    ];

  if (
    !player
  ) {
    return;
  }

  if (
    player.id ===
    state.viewingPlayerId
  ) {
    if (
      state.leadWasMaliutka &&
      state.table.length
    ) {
      element.textContent =
        '🔥 მალიუტკა! ჩადი მთელი ხელი';
    } else {
      element.textContent =
        '🎯 შენი სვლაა';
    }
  } else if (
    player.isBot
  ) {
    element.textContent =
      '🤖 ' +
      player.name +
      ' თამაშობს...';
  } else {
    element.textContent =
      player.name +
      '-ის სვლაა';
  }
}

/* =========================================================
   SCORE
========================================================= */

function renderScore(state) {
  var root =
    q('score');

  var last =
    state.lastHandScores ||
    {};

  var players =
    state.players
      .slice()
      .sort(
        function (a, b) {
          return (
            (
              b.totalPoints ||
              0
            )
            -
            (
              a.totalPoints ||
              0
            )
          );
        }
      );

  root.innerHTML =
    '';

  players.forEach(
    function (
      player,
      index
    ) {
      var place =
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

      var lastScore =
        typeof last[
          player.id
        ] ===
        'number'
          ? last[
            player.id
          ]
          : '-';

      var row =
        document.createElement(
          'div'
        );

      row.className =
        'scoreRow' +
        (
          index === 0
            ? ' first'
            : ''
        );

      row.innerHTML =
        '<div>' +
          place +
        '</div>' +

        '<div>' +
          escapeHtml(
            player.name
          ) +
        '</div>' +

        '<div class="last">' +
          lastScore +
        '</div>' +

        '<div class="total">' +
          player.totalPoints +
        '</div>';

      root.appendChild(
        row
      );
    }
  );
}

/* =========================================================
   TEST MODE
========================================================= */

function renderTester(state) {
  var panel =
    q('testerPanel');

  var grid =
    q('testerGrid');

  if (
    !state.revealAll
  ) {
    panel.style.display =
      'none';

    grid.innerHTML =
      '';

    return;
  }

  panel.style.display =
    'block';

  grid.innerHTML =
    '';

  state.players.forEach(
    function (player) {
      var cards =
        state.playersCards[
          player.id
        ] ||
        [];

      var block =
        document.createElement(
          'div'
        );

      block.className =
        'testerHand';

      var html =
        '<b>' +
        escapeHtml(
          player.name
        ) +
        '</b>' +
        '<div class="mini">';

      cards.forEach(
        function (card) {
          html +=
            '<span>' +
              escapeHtml(
                card.rank
              ) +
              suitSymbol(
                card.suit
              ) +
            '</span>';
        }
      );

      html +=
        '</div>';

      block.innerHTML =
        html;

      grid.appendChild(
        block
      );
    }
  );
}

/* =========================================================
   TIMER
========================================================= */

function startTimerLoop() {
  if (
    timerFrame
  ) {
    cancelAnimationFrame(
      timerFrame
    );
  }

  function tick() {
    if (
      !current
    ) {
      return;
    }

    var remaining =
      Math.max(
        0,
        current.turnEndsAt -
        Date.now()
      );

    var percent =
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
        function (seat) {
          var ring =
            seat.querySelector(
              '.timerRing'
            );

          if (
            !ring
          ) {
            return;
          }

          ring.style.setProperty(
            '--turn',
            seat
              .classList
              .contains(
                'current'
              )
                ? percent + '%'
                : '0%'
          );
        }
      );

    timerFrame =
      requestAnimationFrame(
        tick
      );
  }

  tick();
}

/* =========================================================
   QUICK REACTION
========================================================= */

function showReaction(message) {
  if (
    !message
  ) {
    return;
  }

  var seatBox =
    null;

  document
    .querySelectorAll(
      '.seat'
    )
    .forEach(
      function (seat) {
        if (
          seat.dataset.playerId ===
          message.playerId
        ) {
          seatBox =
            seat.querySelector(
              '.seatBox'
            );
        }
      }
    );

  if (
    !seatBox
  ) {
    return;
  }

  seatBox
    .querySelectorAll(
      '.reactionBubble'
    )
    .forEach(
      function (item) {
        item.remove();
      }
    );

  var bubble =
    document.createElement(
      'div'
    );

  bubble.className =
    'reactionBubble';

  bubble.textContent =
    message.text;

  seatBox.appendChild(
    bubble
  );

  setTimeout(
    function () {
      bubble.remove();
    },
    2500
  );
}

/* =========================================================
   GIFTS
========================================================= */

function openGiftMenu(
  playerId,
  x,
  y
) {
  giftTargetId =
    playerId;

  var menu =
    q('giftMenu');

  menu.style.left =
    Math.min(
      x,
      window.innerWidth - 190
    ) +
    'px';

  menu.style.top =
    Math.min(
      y,
      window.innerHeight - 145
    ) +
    'px';

  menu.classList.add(
    'show'
  );
}

function closeGiftMenu() {
  giftTargetId =
    null;

  q('giftMenu')
    .classList
    .remove(
      'show'
    );
}

function giftEmoji(type) {
  var gifts = {
    coffee:
      '☕',

    egg:
      '🥚',

    clap:
      '👏',

    heart:
      '❤️'
  };

  return (
    gifts[type] ||
    '✨'
  );
}

function showGift(event) {
  if (
    !event
  ) {
    return;
  }

  var seatBox =
    null;

  document
    .querySelectorAll(
      '.seat'
    )
    .forEach(
      function (seat) {
        if (
          seat.dataset.playerId ===
          event.targetPlayerId
        ) {
          seatBox =
            seat.querySelector(
              '.seatBox'
            );
        }
      }
    );

  if (
    !seatBox
  ) {
    return;
  }

  var gift =
    document.createElement(
      'div'
    );

  gift.className =
    'giftAnim';

  gift.textContent =
    giftEmoji(
      event.type
    );

  seatBox.appendChild(
    gift
  );

  playSfx(
    'gift'
  );

  setTimeout(
    function () {
      gift.remove();
    },
    1700
  );
}

/* =========================================================
   ACHIEVEMENT
========================================================= */

function showAchievement(data) {
  if (
    !data
  ) {
    return;
  }

  var toast =
    document.createElement(
      'div'
    );

  toast.className =
    'achievementToast';

  toast.innerHTML =
    '🏅 <b>' +
    escapeHtml(
      data.playerName
    ) +
    '</b><br>' +
    escapeHtml(
      data.title
    );

  document.body.appendChild(
    toast
  );

  playSfx(
    'achievement'
  );

  setTimeout(
    function () {
      toast.remove();
    },
    3700
  );
}

/* =========================================================
   SFX
========================================================= */

function toggleSfx() {
  sfxEnabled =
    !sfxEnabled;

  q('sfxBtn').textContent =
    sfxEnabled
      ? '🔊 SFX'
      : '🔇 SFX';
}

function playSfx(type) {
  if (
    !sfxEnabled
  ) {
    return;
  }

  try {
    var AudioContextClass =
      window.AudioContext ||
      window.webkitAudioContext;

    if (
      !AudioContextClass
    ) {
      return;
    }

    var context =
      new AudioContextClass();

    var oscillator =
      context.createOscillator();

    var gain =
      context.createGain();

    oscillator.connect(
      gain
    );

    gain.connect(
      context.destination
    );

    var frequency =
      440;

    var duration =
      .05;

    if (
      type ===
      'select'
    ) {
      frequency =
        650;

      duration =
        .035;
    } else if (
      type ===
      'deal'
    ) {
      frequency =
        720;

      duration =
        .05;
    } else if (
      type ===
      'play'
    ) {
      frequency =
        500;

      duration =
        .06;
    } else if (
      type ===
      'cut'
    ) {
      frequency =
        300;

      duration =
        .09;
    } else if (
      type ===
      'take'
    ) {
      frequency =
        380;

      duration =
        .07;
    } else if (
      type ===
      'gift'
    ) {
      frequency =
        560;

      duration =
        .08;
    } else if (
      type ===
      'achievement'
    ) {
      frequency =
        840;

      duration =
        .14;
    } else if (
      type ===
      'win'
    ) {
      frequency =
        920;

      duration =
        .20;
    }

    oscillator.frequency.value =
      frequency;

    gain.gain.setValueAtTime(
      .03,
      context.currentTime
    );

    gain.gain
      .exponentialRampToValueAtTime(
        .001,
        context.currentTime +
        duration
      );

    oscillator.start();

    oscillator.stop(
      context.currentTime +
      duration
    );
  } catch (error) {
    console.log(
      'SFX unavailable'
    );
  }
}

</script>

</body>

</html>
`;

/* =========================================================
   ROUTES
========================================================= */

app.get(
  '/',
  function (
    req,
    res
  ) {
    res
      .type('html')
      .send(PAGE);
  }
);

app.get(
  '/health',
  function (
    req,
    res
  ) {
    res.json({
      ok: true,

      cards:
        createDeck().length,

      tester:
        TESTER_NAME,

      turnSeconds:
        TURN_SECONDS
    });
  }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
  PORT,
  function () {
    console.log(
      'WRITTEN BURA running on port',
      PORT
    );

    console.log(
      'Deck:',
      createDeck().length
    );

    console.log(
      'Tester:',
      TESTER_NAME
    );
  }
);
