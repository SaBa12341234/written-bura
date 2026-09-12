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

const CARD_VALUES = {
  '6': 0,
  '7': 0,
  '8': 0,
  '9': 0,
  J: 2,
  Q: 3,
  K: 4,
  '10': 10,
  A: 11
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
   HELPERS
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
    Math.floor(
      Math.random() * 1000000
    )
  );
}

function rankIndex(card) {
  return RANKS.indexOf(
    card.rank
  );
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
   ROOM
========================================================= */

function createRoom(
  capacity,
  parties,
  stake
) {
  const room = {
    id: makeId('room'),
    capacity,
    parties,
    stake,
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
  const deck = createDeck();

  const hands = {};
  const taken = {};
  const totals = {};

  for (const player of room.players) {
    hands[player.id] =
      deck.splice(0, 5);

    taken[player.id] = [];

    totals[player.id] =
      previous
        ? (
          previous.totals[
            player.id
          ] || 0
        )
        : 0;
  }

  const handIndex =
    previous
      ? previous.handIndex + 1
      : 1;

  const leader =
    previous &&
    Number.isInteger(
      previous.nextLeaderIndex
    )
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
      leader,

    nextLeaderIndex:
      leader,

    leadCount:
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

    turnEndsAt:
      Date.now() +
      TURN_SECONDS * 1000
  };
}

/* =========================================================
   CARD COMPARISON
========================================================= */

function cardBeats(
  lead,
  challenge,
  trump
) {
  const leadTrump =
    isTrump(
      lead,
      trump
    );

  const challengeTrump =
    isTrump(
      challenge,
      trump
    );

  if (
    challengeTrump &&
    !leadTrump
  ) {
    return true;
  }

  if (
    leadTrump &&
    !challengeTrump
  ) {
    return false;
  }

  if (
    lead.suit !==
    challenge.suit
  ) {
    return false;
  }

  return (
    rankIndex(
      challenge
    )
    >
    rankIndex(
      lead
    )
  );
}

function playBeats(
  leadPlay,
  challengePlay,
  trump
) {
  if (
    leadPlay.cards.length !==
    challengePlay.cards.length
  ) {
    return false;
  }

  const leadCards =
    leadPlay.cards
      .slice()
      .sort(
        function(a, b) {
          return (
            rankIndex(b) -
            rankIndex(a)
          );
        }
      );

  const challengeCards =
    challengePlay.cards
      .slice()
      .sort(
        function(a, b) {
          return (
            rankIndex(b) -
            rankIndex(a)
          );
        }
      );

  for (
    let i = 0;
    i < leadCards.length;
    i++
  ) {
    if (
      !cardBeats(
        leadCards[i],
        challengeCards[i],
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
   SAME SUIT
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

  for (const suit of SUITS) {
    let total = 0;

    for (const card of hand) {
      if (
        card.suit === suit
      ) {
        total++;
      }
    }

    if (
      total >= count
    ) {
      return true;
    }
  }

  return false;
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

  for (const suit of SUITS) {
    const indexes = [];

    for (
      let i = 0;
      i < hand.length;
      i++
    ) {
      if (
        hand[i].suit === suit
      ) {
        indexes.push(i);
      }

      if (
        indexes.length === count
      ) {
        return indexes;
      }
    }
  }

  const fallback = [];

  for (
    let i = 0;
    i < count &&
    i < hand.length;
    i++
  ) {
    fallback.push(i);
  }

  return fallback;
}

/* =========================================================
   VALIDATE PLAY
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
    indexes.length > 3
  ) {
    return {
      ok: false,
      message:
        'ერთ სვლაზე მაქსიმუმ 3 კარტის არჩევა შეგიძლია.'
    };
  }

  const cards =
    indexes.map(
      function(index) {
        return hand[index];
      }
    );

  if (
    cards.some(
      function(card) {
        return !card;
      }
    )
  ) {
    return {
      ok: false,
      message:
        'არასწორი კარტი.'
    };
  }

  const sameSuit =
    cards.every(
      function(card) {
        return (
          card.suit ===
          cards[0].suit
        );
      }
    );

  /*
    პირველი ჩამოსვლა:
    1-3 კარტი და ყველა ერთი მასტის.
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
          'არჩეული კარტები ერთი მასტის უნდა იყოს.'
      };
    }

    return {
      ok: true,
      cards
    };
  }

  /*
    საპასუხო სვლა:
    რაოდენობა უნდა ემთხვეოდეს.
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
        'უნდა ჩამოხვიდე ზუსტად ' +
        required +
        ' კარტი.'
    };
  }

  /*
    თუ მოთამაშეს აქვს იგივე რაოდენობის
    ერთი მასტის კარტები, ისინიც ერთი
    მასტის უნდა აირჩიოს.
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
        'არჩეული კარტები ერთი მასტის უნდა იყოს.'
    };
  }

  return {
    ok: true,
    cards
  };
}

/* =========================================================
   CLIENT STATE
========================================================= */

function clientState(
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

  const winner =
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

    table:
      game.table.map(
        function(play, index) {
          return {
            playerId:
              play.playerId,

            playerName:
              play.playerName,

            cards:
              play.cards,

            isWinning:
              index === winner
          };
        }
      ),

    players:
      room.players.map(
        function(player, index) {
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
              (
                game.taken[
                  player.id
                ] ||
                []
              ).reduce(
                function(sum, card) {
                  return (
                    sum +
                    card.value
                  );
                },
                0
              ),

            totalPoints:
              game.totals[
                player.id
              ] ||
              0,

            isCurrent:
              index ===
              game.currentTurnIndex
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

function setTurn(
  room,
  index
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
    index;

  room.game.turnEndsAt =
    Date.now() +
    TURN_SECONDS * 1000;

  room.timer =
    setTimeout(
      function() {
        autoPlayCurrent(
          room
        );
      },
      TURN_SECONDS *
      1000 +
      100
    );
}

/* =========================================================
   REFILL
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

        dealt = true;
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
   FINISH HAND
========================================================= */

function finishHand(room) {
  const game =
    room.game;

  const scores = {};

  let lowestRaw =
    Infinity;

  let nextLeader =
    0;

  room.players.forEach(
    function(player, index) {
      const raw =
        (
          game.taken[
            player.id
          ] ||
          []
        ).reduce(
          function(sum, card) {
            return (
              sum +
              card.value
            );
          },
          0
        );

      const score =
        raw === 0
          ? -120
          : raw;

      scores[player.id] =
        score;

      game.totals[player.id] =
        (
          game.totals[
            player.id
          ] ||
          0
        ) +
        score;

      if (
        raw <
        lowestRaw
      ) {
        lowestRaw =
          raw;

        nextLeader =
          index;
      }
    }
  );

  game.lastHandScores =
    scores;

  game.history.push({
    hand:
      game.handIndex,

    scores:
      Object.assign(
        {},
        scores
      )
  });

  if (
    game.handIndex >=
    room.parties * 5
  ) {
    game.gameOver =
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
          'win'
      }
    );

    return;
  }

  game.nextLeaderIndex =
    nextLeader;

  room.game =
    startHand(
      room,
      game
    );

  room.game.lastHandScores =
    scores;

  setTurn(
    room,
    room.game.currentTurnIndex
  );

  broadcast(
    room
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

  const winIndex =
    winningPlayIndex(
      game
    );

  const winnerPlay =
    game.table[
      winIndex
    ];

  if (
    !winnerPlay
  ) {
    return;
  }

  const winnerIndex =
    room.players.findIndex(
      function(player) {
        return (
          player.id ===
          winnerPlay.playerId
        );
      }
    );

  const allCards = [];

  for (
    const play of
    game.table
  ) {
    for (
      const card of
      play.cards
    ) {
      allCards.push(card);
    }
  }

  game.taken[
    winnerPlay.playerId
  ].push(
    ...allCards
  );

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
        'cut'
    }
  );

  setTimeout(
    function() {
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

      game.table = [];

      game.leadCount =
        null;

      refill(
        room,
        winnerIndex
      );

      game.processing =
        false;

      const allEmpty =
        room.players.every(
          function(player) {
            return (
              (
                game.hands[
                  player.id
                ] ||
                []
              ).length ===
              0
            );
          }
        );

      if (
        allEmpty
      ) {
        finishHand(
          room
        );

        return;
      }

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
    850
  );
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
        'სვლა ამჟამად შეუძლებელია.'
    };
  }

  const hand =
    game.hands[
      player.id
    ] ||
    [];

  const validation =
    validateSelection(
      game,
      hand,
      indexes
    );

  if (
    !validation.ok
  ) {
    return validation;
  }

  if (
    game.table.length === 0
  ) {
    game.leadCount =
      validation.cards.length;
  }

  game.hands[
    player.id
  ] =
    hand.filter(
      function(card, index) {
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
      validation.cards
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
        game.currentTurnIndex +
        1
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

  if (
    game.table.length === 0
  ) {
    return [0];
  }

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
      room.game
        .currentTurnIndex
    ];

  if (
    !player ||
    !player.isBot
  ) {
    return;
  }

  setTimeout(
    function() {
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
  ) {
    return;
  }

  const game =
    room.game;

  if (
    game.processing ||
    game.gameOver
  ) {
    return;
  }

  const currentPlayer =
    room.players[
      game.currentTurnIndex
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
   AUTO PLAY
========================================================= */

function autoPlayCurrent(room) {
  if (
    !rooms.has(
      room.id
    )
    ||
    !room.game
  ) {
    return;
  }

  const game =
    room.game;

  if (
    game.processing ||
    game.gameOver
  ) {
    return;
  }

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

  let count = 1;

  if (
    game.table.length
  ) {
    count =
      Math.min(
        game.leadCount || 1,
        hand.length
      );
  }

  const indexes =
    firstSameSuitGroup(
      hand,
      count
    );

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
  function(socket) {

    socket.on(
      'joinTable',
      function(data) {
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
            'შეიყვანე სახელი.'
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
          Number(
            data.capacity
          );

        if (
          !CAPACITIES.includes(
            capacity
          )
        ) {
          capacity = 3;
        }

        let parties =
          Number(
            data.parties
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
              4,
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
          isTesterName(
            name
          );

        let room =
          Array.from(
            rooms.values()
          ).find(
            function(item) {
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

          name,

          isBot:
            false,

          isTester:
            tester,

          balance:
            START_BALANCE
        });

        /*
          TEST MODE
        */

        if (
          tester
        ) {
          let number = 1;

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
                number,

              isBot:
                true,

              isTester:
                false,

              balance:
                START_BALANCE
            });

            number++;
          }
        }

        /*
          START
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
        } else {
          io.to(
            room.id
          ).emit(
            'waitingForPlayers',
            {
              current:
                room.players.length,

              max:
                room.capacity
            }
          );
        }
      }
    );

    /* =====================================================
       PLAY
    ===================================================== */

    socket.on(
      'playCards',
      function(data) {
        const room =
          socket.roomId
            ? rooms.get(
              socket.roomId
            )
            : null;

        if (
          !room ||
          !room.game
        ) {
          return;
        }

        const game =
          room.game;

        if (
          game.processing ||
          game.gameOver
        ) {
          return;
        }

        const player =
          room.players[
            game.currentTurnIndex
          ];

        if (
          !player ||
          player.id !==
          socket.id
        ) {
          socket.emit(
            'errorMessage',
            'ახლა შენი სვლა არ არის.'
          );

          return;
        }

        const hand =
          game.hands[
            socket.id
          ] ||
          [];

        let indexes =
          Array.isArray(
            data &&
            data.cardIndices
          )
            ? data.cardIndices
            : [];

        indexes =
          Array.from(
            new Set(
              indexes
            )
          )
            .filter(
              function(index) {
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
              function(a, b) {
                return a - b;
              }
            );

        const result =
          applyPlay(
            room,
            player,
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
      function(data) {
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
            function(item) {
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
          '👍 კარგი იყო',
          '⚡ სწრაფად',
          '😂 ჰაჰა',
          '🔥 მაგარია',
          '👏 ბრავო',
          '🤝 წარმატებები'
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

        io.to(
          room.id
        ).emit(
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

    /* =====================================================
       DISCONNECT
    ===================================================== */

    socket.on(
      'disconnect',
      function() {
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

        const humans =
          room.players.filter(
            function(player) {
              return (
                !player.isBot &&
                player.id !==
                socket.id
              );
            }
          );

        if (
          humans.length === 0
        ) {
          clearTimeout(
            room.timer
          );

          rooms.delete(
            room.id
          );
        }
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
  --bg: #06100d;
  --glass: rgba(10, 24, 20, .78);
  --line: rgba(255,255,255,.11);
  --green: #34d399;
  --green2: #10b981;
  --gold: #e9c46a;
  --gold2: #ffe29a;
  --text: #f4fbf7;
  --muted: #9db1a8;
  --felt: #0d5b42;
  --felt2: #08382b;
}

html,
body {
  margin: 0;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family:
    'Noto Sans Georgian',
    Inter,
    sans-serif;
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
      rgba(52,211,153,.16),
      transparent 36%
    ),
    radial-gradient(
      circle at 100% 20%,
      rgba(233,196,106,.11),
      transparent 28%
    ),
    linear-gradient(
      160deg,
      #030706,
      #091512 50%,
      #06100d
    );
}

.glass {
  background:
    linear-gradient(
      145deg,
      rgba(255,255,255,.065),
      rgba(255,255,255,.02)
    );
  border:
    1px solid var(--line);
  box-shadow:
    0 20px 60px
    rgba(0,0,0,.28);
  backdrop-filter:
    blur(18px);
}

/* =========================
   LOBBY
========================= */

#lobby {
  min-height: 100vh;
  padding: 24px;
  position: relative;
  overflow: hidden;
}

#lobby:before {
  content: "♠   ♥";
  position: absolute;
  left: -40px;
  top: 80px;
  font-size: 200px;
  opacity: .035;
  transform: rotate(-18deg);
}

#lobby:after {
  content: "♦   ♣";
  position: absolute;
  right: -30px;
  bottom: 20px;
  font-size: 180px;
  opacity: .035;
  transform: rotate(14deg);
}

.shell {
  width: min(1160px, 100%);
  margin: auto;
  position: relative;
  z-index: 2;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 22px;
}

.brand {
  font-size: 24px;
  font-weight: 800;
}

.brand span {
  color: var(--gold);
}

.testHint {
  color: var(--muted);
  font-size: 11px;
}

.hero {
  display: grid;
  grid-template-columns: 1.2fr .8fr;
  gap: 18px;
}

.heroCard,
.joinCard {
  border-radius: 24px;
  padding: 28px;
}

.heroCard {
  min-height: 340px;
  position: relative;
  overflow: hidden;
}

.heroCard:after {
  content: "♠  ♣  ♦  ♥";
  position: absolute;
  right: 30px;
  bottom: 25px;
  font-size: 65px;
  color: rgba(255,255,255,.055);
}

.eyebrow {
  display: inline-block;
  border:
    1px solid
    rgba(52,211,153,.25);
  color: #8af0c6;
  background:
    rgba(52,211,153,.08);
  padding: 7px 11px;
  border-radius: 999px;
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
  max-width: 650px;
}

.joinCard h2 {
  margin-top: 0;
}

.field {
  margin: 12px 0;
}

.field label {
  display: block;
  margin-bottom: 7px;
  color: #bed0c7;
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
    1px solid
    var(--line);
  border-radius: 12px;
  background:
    rgba(0,0,0,.28);
  outline: none;
}

.field input:focus,
.field select:focus {
  border-color:
    rgba(52,211,153,.65);
  box-shadow:
    0 0 0 4px
    rgba(52,211,153,.08);
}

.row2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
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
    rgba(16,185,129,.25);
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
    1px solid
    var(--line);
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
    translateY(-4px);
  color: var(--gold2);
  border-color:
    rgba(233,196,106,.55);
  background:
    rgba(233,196,106,.09);
}

.stake b {
  display: block;
  font-size: 20px;
}

.stake span {
  font-size: 9px;
}

/* =========================
   GAME
========================= */

#game {
  display: none;
  min-height: 100vh;
  padding: 14px;
}

.gameShell {
  width: min(1500px, 100%);
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
  margin-top: 2px;
  font-size: 10px;
  color: var(--muted);
}

.hud {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.hudBox {
  min-width: 76px;
  text-align: center;
  padding: 9px 10px;
  border-radius: 13px;
}

.hudBox small {
  display: block;
  color: var(--muted);
  font-size: 8px;
}

.hudBox b {
  color: var(--gold2);
  font-size: 13px;
}

.sfxBtn,
.exitBtn {
  height: 41px;
  border-radius: 11px;
  border:
    1px solid
    var(--line);
  color: #fff;
  background:
    rgba(255,255,255,.05);
  cursor: pointer;
}

.status {
  height: 32px;
  display: grid;
  place-items: center;
  color: var(--gold2);
  font-weight: 800;
  font-size: 12px;
}

.layout {
  display: grid;
  grid-template-columns:
    minmax(0,1fr) 300px;
  gap: 13px;
}

.tableStage {
  height: 700px;
  position: relative;
  overflow: hidden;
  border-radius: 26px;
  border:
    1px solid
    var(--line);
  background:
    radial-gradient(
      circle at 50% 10%,
      rgba(255,255,255,.05),
      transparent 30%
    ),
    linear-gradient(
      145deg,
      #18110d,
      #080a09
    );
  box-shadow:
    0 25px 80px
    rgba(0,0,0,.45);
}

.tableWood {
  position: absolute;
  inset: 45px 70px 80px;
  border-radius: 50% / 39%;
  background:
    linear-gradient(
      145deg,
      #95613c,
      #56331f 55%,
      #2d1a11
    );
  box-shadow:
    inset 0 0 0 14px
    rgba(44,23,13,.75),
    inset 0 0 60px
    rgba(0,0,0,.45);
}

.felt {
  position: absolute;
  inset: 82px 108px 118px;
  border-radius: 50% / 39%;
  background:
    radial-gradient(
      ellipse,
      var(--felt),
      var(--felt2) 74%
    );
  border:
    3px solid
    rgba(255,255,255,.07);
  box-shadow:
    inset 0 0 60px
    rgba(0,0,0,.4);
}

.felt:after {
  content: "WRITTEN BURA";
  position: absolute;
  left: 50%;
  top: 50%;
  transform:
    translate(-50%,-50%);
  letter-spacing: 8px;
  font-weight: 800;
  color:
    rgba(255,255,255,.045);
  white-space: nowrap;
}

.deckZone {
  position: absolute;
  left: 50%;
  top: 44%;
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
    rgba(255,255,255,.8);
  background:
    repeating-linear-gradient(
      45deg,
      #203650 0 4px,
      #132238 4px 8px
    );
  box-shadow:
    5px 5px 0
    rgba(255,255,255,.13);
}

.deckLabel {
  margin-top: 4px;
  text-align: center;
  font-size: 9px;
  color: var(--muted);
}

.trumpSlot {
  width: 58px;
  height: 82px;
}

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
  max-width: 65%;
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
    0 0 26px
    rgba(255,220,130,.9);
  border-color: var(--gold2);
}

/* =========================
   PLAYERS
========================= */

.seat {
  position: absolute;
  transform:
    translate(-50%,-50%);
  width: 158px;
  text-align: center;
  z-index: 8;
}

.seatBox {
  position: relative;
  padding: 8px;
  border:
    1px solid
    var(--line);
  border-radius: 16px;
  background:
    rgba(6,13,11,.82);
  backdrop-filter:
    blur(10px);
}

.seat.current .seatBox {
  border-color:
    var(--gold2);
  box-shadow:
    0 0 25px
    rgba(233,196,106,.25);
}

.avatar {
  width: 54px;
  height: 54px;
  border-radius: 50%;
  margin: auto;
  position: relative;
  cursor: pointer;
  background:
    radial-gradient(
      circle at 40% 30%,
      #d8bca6,
      #94664d 48%,
      #2c1c16 49%
    );
  border:
    3px solid
    rgba(233,196,106,.65);
}

.timerRing {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  z-index: -1;
  background:
    conic-gradient(
      var(--gold)
      var(--turn,0%),
      rgba(255,255,255,.08) 0
    );
}

.seatName {
  margin-top: 6px;
  font-size: 10px;
  font-weight: 800;
}

.seatInfo {
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
      #263b54 0 3px,
      #14243a 3px 6px
    );
}

.back:first-child {
  margin-left: 0;
}

.reactionBubble {
  position: absolute;
  top: -30px;
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
}

/* =========================
   HAND
========================= */

.handZone {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform:
    translateX(-50%);
  z-index: 12;
  width: min(830px,94%);
  text-align: center;
}

.hand {
  height: 132px;
  display: flex;
  justify-content: center;
  align-items: flex-end;
}

.hand .card {
  margin-left: -18px;
  position: relative;
  transform-origin: 50% 115%;
  transition:
    transform .17s ease,
    box-shadow .17s ease;
}

.hand .card:first-child {
  margin-left: 0;
}

.hand .card:hover {
  transform:
    translateY(-17px)
    scale(1.04) !important;
  z-index: 50;
}

.hand .card.selected {
  transform:
    translateY(-26px)
    scale(1.06) !important;
  border:
    3px solid
    var(--green);
  box-shadow:
    0 0 0 3px
    rgba(52,211,153,.2),
    0 14px 30px
    rgba(0,0,0,.4);
  z-index: 60;
}

.playBtn {
  min-width: 200px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  color: #032319;
  background:
    linear-gradient(
      135deg,
      var(--green),
      var(--green2)
    );
  font-weight: 800;
  cursor: pointer;
}

.playBtn:disabled {
  background: #27322f;
  color: #72847d;
  cursor: not-allowed;
}

.selectedCount {
  margin-top: 4px;
  color: var(--muted);
  font-size: 10px;
}

/* =========================
   CARDS
========================= */

.card {
  width: 70px;
  height: 102px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  border-radius: 10px;
  background: #fff;
  border:
    1px solid
    rgba(0,0,0,.17);
  box-shadow:
    0 8px 22px
    rgba(0,0,0,.35);
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
  color: #080808;
}

.suit-clubs {
  color: #007b58;
  background:
    linear-gradient(
      #fff,
      #f0fbf6
    );
}

.suit-diamonds {
  color: #082a69;
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

/* =========================
   SIDE PANEL
========================= */

.scorePanel,
.quickPanel,
.testerPanel {
  padding: 14px;
  border-radius: 18px;
}

.quickPanel,
.testerPanel {
  margin-top: 12px;
}

.scoreHead {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.scoreHead b {
  font-size: 14px;
}

.scoreHead span {
  color: var(--muted);
  font-size: 8px;
}

.scoreRow {
  display: grid;
  grid-template-columns:
    35px 1fr 55px 55px;
  gap: 5px;
  align-items: center;
  padding: 9px 5px;
  border-top:
    1px solid
    var(--line);
  font-size: 9px;
}

.scoreRow.first {
  background:
    rgba(233,196,106,.06);
  border-radius: 10px;
}

.scoreRow .total {
  text-align: right;
  color: var(--gold2);
  font-weight: 800;
  font-size: 12px;
}

.scoreRow .last {
  text-align: right;
  color: var(--muted);
}

.quickGrid {
  display: grid;
  grid-template-columns:
    1fr 1fr;
  gap: 6px;
  margin-top: 8px;
}

.quickBtn {
  border:
    1px solid
    var(--line);
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
    rgba(52,211,153,.5);
}

.testerPanel {
  display: none;
}

.testerPanel.show {
  display: block;
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

/* =========================
   ANIMATION
========================= */

@keyframes cardFly {
  from {
    opacity: 0;
    transform:
      translateY(70px)
      scale(.75);
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
    cardFly .4s ease;
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

/* =========================
   MOBILE
========================= */

@media(max-width:1100px) {
  .layout {
    grid-template-columns: 1fr;
  }

  .tableStage {
    height: 650px;
  }
}

@media(max-width:800px) {
  .hero {
    grid-template-columns: 1fr;
  }

  .heroCard h1 {
    font-size: 34px;
  }

  .gameTop {
    grid-template-columns: 1fr;
  }

  .tableStage {
    height: 590px;
  }

  .tableWood {
    inset:
      40px 25px 70px;
  }

  .felt {
    inset:
      78px 55px 115px;
  }

  .seat {
    width: 116px;
  }

  .avatar {
    width: 44px;
    height: 44px;
  }

  .card {
    width: 58px;
    height: 86px;
  }

  .cardCenter {
    font-size: 27px;
  }

  .stakes {
    grid-template-columns:
      repeat(3,1fr);
  }
}

@media(max-width:520px) {
  #lobby {
    padding: 12px;
  }

  .heroCard,
  .joinCard {
    padding: 19px;
  }

  .heroCard h1 {
    font-size: 29px;
  }

  .row2 {
    grid-template-columns: 1fr;
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

  .avatar {
    width: 38px;
    height: 38px;
  }

  .seatName {
    font-size: 8px;
  }

  .seatInfo {
    font-size: 6px;
  }

  .card {
    width: 50px;
    height: 74px;
    padding: 4px;
  }

  .cardCenter {
    font-size: 21px;
  }

  .cardTop,
  .cardBottom {
    font-size: 9px;
  }

  .hand {
    height: 98px;
  }

  .hand .card {
    margin-left: -16px;
  }

  .tableCards {
    max-width: 78%;
    gap: 4px;
  }

  .quickGrid {
    grid-template-columns: 1fr;
  }
}

</style>

</head>

<body>

<section id="lobby">

<div class="shell">

<div class="top">

<div class="brand">
WRITTEN <span>BURA</span>
</div>

<div class="testHint">
TEST MODE: <b>saba123</b>
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
1, 2 ან 3 ერთი მასტის კარტის ერთდროულად ჩამოსვლა,
20-წამიანი სვლის ტაიმერი, Live Score,
რეაქციები და ავტომატური ბოტები TEST MODE-ში.
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
  id="stake"
  type="hidden"
  value="5"
>

<button
  class="primary"
  id="joinButton"
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
  class="sfxBtn"
>
🔊 SFX
</button>

<button
  id="exitBtn"
  class="exitBtn"
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
>
სვლის გაკეთება
</button>

<div
  id="selectedCount"
  class="selectedCount"
>
არჩეული: 0 / 3
</div>

</div>

</div>

</div>

<aside>

<div class="scorePanel glass">

<div class="scoreHead">

<b>
🏆 LIVE SCORE
</b>

<span>
LAST / TOTAL
</span>

</div>

<div id="score"></div>

</div>

<div class="quickPanel glass">

<b>
💬 სწრაფი რეაქციები
</b>

<div class="quickGrid">

<button
  class="quickBtn"
  data-message="👍 კარგი იყო"
>
👍 კარგი იყო
</button>

<button
  class="quickBtn"
  data-message="⚡ სწრაფად"
>
⚡ სწრაფად
</button>

<button
  class="quickBtn"
  data-message="😂 ჰაჰა"
>
😂 ჰაჰა
</button>

<button
  class="quickBtn"
  data-message="🔥 მაგარია"
>
🔥 მაგარია
</button>

<button
  class="quickBtn"
  data-message="👏 ბრავო"
>
👏 ბრავო
</button>

<button
  class="quickBtn"
  data-message="🤝 წარმატებები"
>
🤝 წარმატებები
</button>

</div>

</div>

<div
  id="testerPanel"
  class="testerPanel glass"
>

<b>
🧪 TEST MODE
</b>

<div id="testerGrid"></div>

</div>

</aside>

</div>

</div>

</section>

<script>

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

/* =========================================================
   SOCKET STATUS
========================================================= */

socket.on(
  'connect',
  function() {
    console.log(
      'Socket connected:',
      socket.id
    );

    var wait =
      document.getElementById(
        'wait'
      );

    if (
      wait &&
      wait.textContent.indexOf(
        'კავშირი'
      ) !== -1
    ) {
      wait.textContent =
        '';
    }
  }
);

socket.on(
  'connect_error',
  function(error) {
    console.error(
      error
    );

    document.getElementById(
      'wait'
    ).textContent =
      'სერვერთან კავშირი ვერ შედგა: ' +
      error.message;
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
    function(button) {
      button.addEventListener(
        'click',
        function() {
          document
            .querySelectorAll(
              '.stake'
            )
            .forEach(
              function(item) {
                item.classList.remove(
                  'active'
                );
              }
            );

          button.classList.add(
            'active'
          );

          document.getElementById(
            'stake'
          ).value =
            button.getAttribute(
              'data-stake'
            );
        }
      );
    }
  );

document.getElementById(
  'joinButton'
).addEventListener(
  'click',
  joinGame
);

document.getElementById(
  'playBtn'
).addEventListener(
  'click',
  playSelected
);

document.getElementById(
  'sfxBtn'
).addEventListener(
  'click',
  toggleSfx
);

document.getElementById(
  'exitBtn'
).addEventListener(
  'click',
  function() {
    location.reload();
  }
);

document
  .querySelectorAll(
    '.quickBtn'
  )
  .forEach(
    function(button) {
      button.addEventListener(
        'click',
        function() {
          sendQuick(
            button.getAttribute(
              'data-message'
            )
          );
        }
      );
    }
  );

/* =========================================================
   JOIN
========================================================= */

function joinGame() {
  var name =
    document.getElementById(
      'playerName'
    ).value.trim();

  if (
    !name
  ) {
    alert(
      'შეიყვანე მოთამაშის სახელი.'
    );

    return;
  }

  var capacity =
    Number(
      document.getElementById(
        'capacity'
      ).value
    );

  var parties =
    Number(
      document.getElementById(
        'parties'
      ).value
    );

  var stake =
    Number(
      document.getElementById(
        'stake'
      ).value
    );

  document.getElementById(
    'wait'
  ).textContent =
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
        capacity,

      parties:
        parties,

      stake:
        stake
    }
  );
}

/* =========================================================
   SERVER EVENTS
========================================================= */

socket.on(
  'waitingForPlayers',
  function(data) {
    document.getElementById(
      'wait'
    ).textContent =
      'ველოდებით მოთამაშეებს: ' +
      data.current +
      ' / ' +
      data.max;
  }
);

socket.on(
  'errorMessage',
  function(message) {
    alert(
      message
    );

    var status =
      document.getElementById(
        'status'
      );

    if (
      status
    ) {
      status.textContent =
        message;
    }
  }
);

socket.on(
  'gameStateUpdate',
  function(state) {
    current =
      state;

    selected =
      [];

    document.getElementById(
      'lobby'
    ).style.display =
      'none';

    document.getElementById(
      'game'
    ).style.display =
      'block';

    render(
      state
    );
  }
);

socket.on(
  'sfxEvent',
  function(event) {
    if (
      event
    ) {
      playSfx(
        event.type
      );
    }
  }
);

socket.on(
  'quickMessage',
  function(message) {
    showReaction(
      message
    );
  }
);

/* =========================================================
   UI HELPERS
========================================================= */

function suitSymbol(suit) {
  var symbols = {
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
    symbols[suit] ||
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

/* =========================================================
   CARD
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
   RENDER
========================================================= */

function render(state) {
  document.getElementById(
    'tableSub'
  ).textContent =
    state.capacity +
    ' players · $' +
    state.stake;

  document.getElementById(
    'hudParty'
  ).textContent =
    state.partyIndex +
    ' / ' +
    state.parties;

  document.getElementById(
    'hudHand'
  ).textContent =
    state.handIndex +
    ' / ' +
    state.totalHands;

  document.getElementById(
    'hudTrump'
  ).textContent =
    trumpText(
      state.trump
    );

  document.getElementById(
    'hudDeck'
  ).textContent =
    state.deckCount;

  document.getElementById(
    'centerDeck'
  ).textContent =
    state.deckCount;

  document.getElementById(
    'hudStake'
  ).textContent =
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
    document.getElementById(
      'trumpSlot'
    );

  slot.innerHTML =
    '';

  if (
    trump ===
    'no_trump'
  ) {
    var empty =
      document.createElement(
        'div'
      );

    empty.className =
      'card';

    empty.style.display =
      'grid';

    empty.style.placeItems =
      'center';

    empty.style.color =
      '#222';

    empty.style.fontSize =
      '28px';

    empty.textContent =
      'Ø';

    slot.appendChild(
      empty
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
   SEAT POSITION
========================================================= */

function seatPosition(
  index,
  count,
  myId,
  players
) {
  var myIndex =
    players.findIndex(
      function(player) {
        return (
          player.id ===
          myId
        );
      }
    );

  if (
    myIndex < 0
  ) {
    myIndex = 0;
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
    document.getElementById(
      'players'
    );

  root.innerHTML =
    '';

  state.players.forEach(
    function(player, index) {
      var position =
        seatPosition(
          index,
          state.players.length,
          state.viewingPlayerId,
          state.players
        );

      var element =
        document.createElement(
          'div'
        );

      element.className =
        'seat' +
        (
          player.isCurrent
            ? ' current'
            : ''
        );

      element.dataset.playerId =
        player.id;

      element.style.left =
        position.left +
        '%';

      element.style.top =
        position.top +
        '%';

      var backs =
        '';

      if (
        player.id !==
        state.viewingPlayerId
      ) {
        for (
          var i = 0;
          i < player.cardCount;
          i++
        ) {
          backs +=
            '<div class="back"></div>';
        }
      }

      element.innerHTML =
        '<div class="seatBox">' +

          '<div class="avatar">' +
            '<div class="timerRing"></div>' +
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

      var avatar =
        element.querySelector(
          '.avatar'
        );

      avatar.addEventListener(
        'click',
        function() {
          sendQuick(
            '👍 კარგი იყო'
          );
        }
      );

      root.appendChild(
        element
      );
    }
  );
}

/* =========================================================
   TABLE CARDS
========================================================= */

function renderTable(state) {
  var root =
    document.getElementById(
      'tableCards'
    );

  root.innerHTML =
    '';

  state.table.forEach(
    function(play) {
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
        function(card) {
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
   HAND
========================================================= */

function renderHand(state) {
  var root =
    document.getElementById(
      'myCards'
    );

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
    function(card, index) {
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
          delta *
          3.5
        ) +
        'deg) translateY(' +
        (
          Math.abs(
            delta
          ) *
          1.6
        ) +
        'px)';

      element.addEventListener(
        'click',
        function() {
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
   SELECT
========================================================= */

function toggleCard(
  index,
  element
) {
  var found =
    selected.indexOf(
      index
    );

  if (
    found !== -1
  ) {
    selected.splice(
      found,
      1
    );

    element.classList.remove(
      'selected'
    );
  } else {
    if (
      selected.length >= 3
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

function updateSelectedCount() {
  document.getElementById(
    'selectedCount'
  ).textContent =
    'არჩეული: ' +
    selected.length +
    ' / 3';
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
    selected
      .map(
        function(index) {
          return hand[index];
        }
      )
      .filter(
        function(card) {
          return !!card;
        }
      );

  if (
    cards.length < 1 ||
    cards.length > 3
  ) {
    return false;
  }

  var sameSuit =
    cards.every(
      function(card) {
        return (
          card.suit ===
          cards[0].suit
        );
      }
    );

  if (
    current.table.length === 0
  ) {
    return sameSuit;
  }

  var required =
    current.table[0]
      .cards.length;

  if (
    cards.length !==
    required
  ) {
    return false;
  }

  var suits = [
    'spades',
    'clubs',
    'diamonds',
    'hearts'
  ];

  var hasGroup =
    suits.some(
      function(suit) {
        return (
          hand.filter(
            function(card) {
              return (
                card.suit ===
                suit
              );
            }
          ).length >=
          required
        );
      }
    );

  if (
    hasGroup
  ) {
    return sameSuit;
  }

  return true;
}

/* =========================================================
   PLAY
========================================================= */

function updatePlayButton() {
  var button =
    document.getElementById(
      'playBtn'
    );

  if (
    !current
  ) {
    button.disabled =
      true;

    return;
  }

  var currentPlayer =
    current.players[
      current.currentTurnIndex
    ];

  button.disabled =
    !currentPlayer
    ||
    currentPlayer.id !==
    current.viewingPlayerId
    ||
    current.processing
    ||
    current.gameOver
    ||
    !selectionValidClient();
}

function playSelected() {
  if (
    !selectionValidClient()
  ) {
    alert(
      'აირჩიე 1-3 ერთი მასტის კარტი. საპასუხო სვლაზე რაოდენობა უნდა ემთხვეოდეს პირველ ჩამოსვლას.'
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

  selected = [];

  updateSelectedCount();
}

/* =========================================================
   STATUS
========================================================= */

function updateStatus(state) {
  var status =
    document.getElementById(
      'status'
    );

  if (
    state.gameOver
  ) {
    status.textContent =
      '🏆 თამაში დასრულებულია';

    return;
  }

  if (
    state.processing
  ) {
    status.textContent =
      '✨ ხელი ითვლება...';

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
    status.textContent =
      '🎯 შენი სვლაა';
  } else if (
    player.isBot
  ) {
    status.textContent =
      '🤖 ' +
      player.name +
      ' თამაშობს...';
  } else {
    status.textContent =
      player.name +
      '-ის სვლაა';
  }
}

/* =========================================================
   SCORE
========================================================= */

function renderScore(state) {
  var root =
    document.getElementById(
      'score'
    );

  var last =
    state.lastHandScores ||
    {};

  var players =
    state.players
      .slice()
      .sort(
        function(a, b) {
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
    function(player, index) {
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
          (
            player.id ===
            state.viewingPlayerId
              ? ' · YOU'
              : ''
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
   TESTER
========================================================= */

function renderTester(state) {
  var panel =
    document.getElementById(
      'testerPanel'
    );

  var grid =
    document.getElementById(
      'testerGrid'
    );

  if (
    !state.revealAll
  ) {
    panel.classList.remove(
      'show'
    );

    grid.innerHTML =
      '';

    return;
  }

  panel.classList.add(
    'show'
  );

  grid.innerHTML =
    '';

  state.players.forEach(
    function(player) {
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
        function(card) {
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

  function update() {
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
        function(seat) {
          var ring =
            seat.querySelector(
              '.timerRing'
            );

          if (
            !ring
          ) {
            return;
          }

          if (
            seat.classList.contains(
              'current'
            )
          ) {
            ring.style.setProperty(
              '--turn',
              percent +
              '%'
            );
          } else {
            ring.style.setProperty(
              '--turn',
              '0%'
            );
          }
        }
      );

    timerFrame =
      requestAnimationFrame(
        update
      );
  }

  update();
}

/* =========================================================
   QUICK CHAT
========================================================= */

function sendQuick(text) {
  socket.emit(
    'quickMessage',
    {
      text:
        text
    }
  );
}

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
      function(seat) {
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
      function(item) {
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
    function() {
      bubble.remove();
    },
    2500
  );
}

/* =========================================================
   SFX
========================================================= */

function toggleSfx() {
  sfxEnabled =
    !sfxEnabled;

  document.getElementById(
    'sfxBtn'
  ).textContent =
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
    }

    if (
      type ===
      'deal'
    ) {
      frequency =
        720;

      duration =
        .05;
    }

    if (
      type ===
      'play'
    ) {
      frequency =
        500;

      duration =
        .06;
    }

    if (
      type ===
      'cut'
    ) {
      frequency =
        300;

      duration =
        .09;
    }

    if (
      type ===
      'win'
    ) {
      frequency =
        820;

      duration =
        .18;
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
  } catch (
    error
  ) {
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
  function(req, res) {
    res
      .type(
        'html'
      )
      .send(
        PAGE
      );
  }
);

app.get(
  '/health',
  function(req, res) {
    res.json({
      ok:
        true,

      cards:
        createDeck().length,

      tester:
        TESTER_NAME,

      timer:
        TURN_SECONDS
    });
  }
);

/* =========================================================
   START
========================================================= */

server.listen(
  PORT,
  function() {
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
