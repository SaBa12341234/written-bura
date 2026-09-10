const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 10000;

const TESTER_NAME = 'saba123';
const START_BALANCE = 1000;

const ALLOWED_STAKES = [
    5,
    10,
    25,
    50,
    100
];

const ALLOWED_CAPACITIES = [
    3,
    4
];

const MAX_PARTIES = 4;

/* =========================================================
   CARD CONFIG
========================================================= */

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

/* =========================================================
   ROOMS
========================================================= */

const rooms =
    new Map();

/* =========================================================
   HELPERS
========================================================= */

function cleanName(
    value
) {

    return String(
        value || ''
    )
        .trim()
        .slice(
            0,
            20
        );
}

function isTester(
    name
) {

    return (
        cleanName(
            name
        ).toLowerCase()
        ===
        TESTER_NAME
    );
}

function makeId(
    prefix
) {

    return (
        prefix
        +
        '_'
        +
        Date.now()
        +
        '_'
        +
        Math.floor(
            Math.random() *
            1000000
        )
    );
}

/* =========================================================
   DECK
========================================================= */

function createDeck() {

    const deck =
        [];

    for (
        const suit of
        SUITS
    ) {

        for (
            const rank of
            RANKS
        ) {

            deck.push({

                suit,

                rank,

                value:
                    CARD_VALUES[
                        rank
                    ]
            });
        }
    }

    /*
        Shuffle
    */

    for (
        let i =
            deck.length -
            1;

        i >
        0;

        i--
    ) {

        const j =
            Math.floor(
                Math.random() *
                (
                    i +
                    1
                )
            );

        [
            deck[i],
            deck[j]
        ] =
        [
            deck[j],
            deck[i]
        ];
    }

    return deck;
}

/* =========================================================
   CREATE ROOM
========================================================= */

function createRoom(
    capacity,
    parties,
    stake
) {

    const id =
        makeId(
            'room'
        );

    const room = {

        id,

        capacity,

        parties,

        stake,

        players:
            [],

        game:
            null
    };

    rooms.set(
        id,
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

    const hands =
        {};

    const taken =
        {};

    const totals =
        {};

    for (
        const player of
        room.players
    ) {

        hands[
            player.id
        ] =
            deck.splice(
                0,
                5
            );

        taken[
            player.id
        ] =
            [];

        totals[
            player.id
        ] =
            previous
                ?
                (
                    previous
                        .totals[
                            player.id
                        ]
                    ||
                    0
                )
                :
                0;
    }

    const handIndex =
        previous
            ?
            previous
                .handIndex +
            1
            :
            1;

    const leaderIndex =
        previous
        &&
        Number.isInteger(
            previous
                .nextLeaderIndex
        )
            ?
            previous
                .nextLeaderIndex
            :
            0;

    return {

        deck,

        hands,

        taken,

        totals,

        table:
            [],

        handIndex,

        partyIndex:
            Math.ceil(
                handIndex /
                5
            ),

        trump:
            TRUMPS[
                (
                    handIndex -
                    1
                )
                %
                TRUMPS.length
            ],

        currentTurnIndex:
            leaderIndex,

        nextLeaderIndex:
            leaderIndex,

        leadCount:
            null,

        processing:
            false,

        gameOver:
            false,

        lastHandScores:
            previous
                ?
                (
                    previous
                        .lastHandScores
                    ||
                    {}
                )
                :
                {},

        history:
            previous
                ?
                previous
                    .history
                :
                []
    };
}

/* =========================================================
   CARD RULES
========================================================= */

function rankIndex(
    card
) {

    return RANKS.indexOf(
        card.rank
    );
}

function isTrump(
    card,
    trump
) {

    return (
        trump !==
        'no_trump'
        &&
        card.suit ===
        trump
    );
}

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
        challengeTrump
        &&
        !leadTrump
    ) {

        return true;
    }

    if (
        !challengeTrump
        &&
        leadTrump
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

/* =========================================================
   MALIUTKA
========================================================= */

function isMaliutka(
    cards
) {

    return (
        cards.length ===
        5
        &&
        cards.every(
            card =>
                card.suit ===
                cards[0].suit
        )
    );
}

/* =========================================================
   PLAY COMPARISON
========================================================= */

function playBeats(
    leadPlay,
    challengePlay,
    trump
) {

    if (
        isMaliutka(
            challengePlay.cards
        )
        &&
        leadPlay.cards.length <
        5
    ) {

        return true;
    }

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
                (
                    a,
                    b
                ) =>
                    rankIndex(
                        b
                    )
                    -
                    rankIndex(
                        a
                    )
            );

    const challengeCards =
        challengePlay.cards
            .slice()
            .sort(
                (
                    a,
                    b
                ) =>
                    rankIndex(
                        b
                    )
                    -
                    rankIndex(
                        a
                    )
            );

    for (
        let i =
            0;

        i <
        leadCards.length;

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

/* =========================================================
   WINNER
========================================================= */

function winningPlayIndex(
    game
) {

    if (
        !game.table.length
    ) {

        return -1;
    }

    let winner =
        0;

    for (
        let i =
            1;

        i <
        game.table.length;

        i++
    ) {

        if (
            playBeats(
                game.table[
                    winner
                ],
                game.table[
                    i
                ],
                game.trump
            )
        ) {

            winner =
                i;
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
    revealAll
) {

    const game =
        room.game;

    if (
        !game
    ) {

        return null;
    }

    const winnerIndex =
        winningPlayIndex(
            game
        );

    const visible =
        {};

    /*
        TESTER ხედავს
        ყველა მოთამაშის კარტს
    */

    if (
        revealAll
    ) {

        for (
            const player of
            room.players
        ) {

            visible[
                player.id
            ] =
                game.hands[
                    player.id
                ]
                ||
                [];
        }

    } else if (
        viewerId
        &&
        game.hands[
            viewerId
        ]
    ) {

        visible[
            viewerId
        ] =
            game.hands[
                viewerId
            ];
    }

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
            room.parties *
            5,

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

        lastHandScores:
            game.lastHandScores,

        playersCards:
            visible,

        table:
            game.table.map(
                (
                    item,
                    index
                ) => ({

                    ...item,

                    isWinning:
                        index ===
                        winnerIndex
                })
            ),

        players:
            room.players.map(
                (
                    player,
                    index
                ) => ({

                    id:
                        player.id,

                    name:
                        player.name,

                    isBot:
                        player.isBot,

                    isTester:
                        player.isTester,

                    balance:
                        player.balance,

                    cardCount:
                        (
                            game.hands[
                                player.id
                            ]
                            ||
                            []
                        ).length,

                    handPoints:
                        (
                            game.taken[
                                player.id
                            ]
                            ||
                            []
                        )
                        .reduce(
                            (
                                sum,
                                card
                            ) =>
                                sum +
                                card.value,
                            0
                        ),

                    totalPoints:
                        game.totals[
                            player.id
                        ]
                        ||
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

function broadcast(
    room
) {

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

        let dealt =
            false;

        for (
            let step =
                0;

            step <
            room.players.length;

            step++
        ) {

            const player =
                room.players[
                    (
                        winnerIndex +
                        step
                    )
                    %
                    room.players.length
                ];

            const hand =
                game.hands[
                    player.id
                ];

            if (
                hand.length <
                5
                &&
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
   FINISH HAND
========================================================= */

function finishHand(
    room
) {

    const game =
        room.game;

    const scores =
        {};

    let minRaw =
        Infinity;

    let minIndex =
        0;

    room.players.forEach(
        (
            player,
            index
        ) => {

            const raw =
                (
                    game.taken[
                        player.id
                    ]
                    ||
                    []
                )
                .reduce(
                    (
                        sum,
                        card
                    ) =>
                        sum +
                        card.value,
                    0
                );

            /*
                მიმდინარე სატესტო წესი:
                0 ქულა = -120
            */

            const score =
                raw ===
                0
                    ?
                    -120
                    :
                    raw;

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
                    ]
                    ||
                    0
                )
                +
                score;

            if (
                raw <
                minRaw
            ) {

                minRaw =
                    raw;

                minIndex =
                    index;
            }
        }
    );

    game.lastHandScores =
        {
            ...scores
        };

    game.history.push({

        hand:
            game.handIndex,

        scores:
            {
                ...scores
            },

        totals:
            {
                ...game.totals
            }
    });

    /*
        თამაში დასრულდა
    */

    if (
        game.handIndex >=
        room.parties *
        5
    ) {

        game.gameOver =
            true;

        broadcast(
            room
        );

        return;
    }

    /*
        შემდეგი ხელის ლიდერი
    */

    game.nextLeaderIndex =
        (
            minIndex +
            1
        )
        %
        room.players.length;

    room.game =
        startHand(
            room,
            game
        );

    room.game
        .lastHandScores =
        {
            ...scores
        };

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

function completeTrick(
    room
) {

    const game =
        room.game;

    const winnerPlayIndex =
        winningPlayIndex(
            game
        );

    const winnerPlay =
        game.table[
            winnerPlayIndex
        ];

    if (
        !winnerPlay
    ) {

        return;
    }

    const allCards =
        game.table.flatMap(
            item =>
                item.cards
        );

    game.taken[
        winnerPlay.playerId
    ].push(
        ...allCards
    );

    const winnerIndex =
        room.players
            .findIndex(
                player =>
                    player.id ===
                    winnerPlay.playerId
            );

    game.currentTurnIndex =
        winnerIndex;

    game.processing =
        true;

    broadcast(
        room
    );

    setTimeout(
        () => {

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
                            ]
                            ||
                            []
                        ).length ===
                        0
                );

            if (
                allEmpty
            ) {

                finishHand(
                    room
                );

            } else {

                broadcast(
                    room
                );

                scheduleBot(
                    room
                );
            }

        },
        900
    );
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
        ]
        ||
        [];

    if (
        !hand.length
    ) {

        return [];
    }

    if (
        !game.table.length
    ) {

        return [
            0
        ];
    }

    const required =
        Math.min(
            game.leadCount ||
            1,
            hand.length
        );

    return Array.from(
        {
            length:
                required
        },
        (
            _,
            index
        ) =>
            index
    );
}

function scheduleBot(
    room
) {

    if (
        !room
        ||
        !room.game
        ||
        room.game.processing
        ||
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
        !player
        ||
        !player.isBot
    ) {

        return;
    }

    setTimeout(
        () => {

            botTurn(
                room,
                player
            );

        },
        550
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
        game.processing
        ||
        game.gameOver
    ) {

        return;
    }

    const active =
        room.players[
            game.currentTurnIndex
        ];

    if (
        !active
        ||
        active.id !==
        bot.id
        ||
        !active.isBot
    ) {

        return;
    }

    const hand =
        game.hands[
            bot.id
        ]
        ||
        [];

    const indexes =
        botChoice(
            room,
            bot
        );

    const cards =
        indexes
            .map(
                index =>
                    hand[
                        index
                    ]
            )
            .filter(
                Boolean
            );

    if (
        !cards.length
    ) {

        return;
    }

    if (
        !game.table.length
    ) {

        game.leadCount =
            cards.length;
    }

    game.hands[
        bot.id
    ] =
        hand.filter(
            (
                _,
                index
            ) =>
                !indexes.includes(
                    index
                )
        );

    game.table.push({

        playerId:
            bot.id,

        playerName:
            bot.name,

        cards
    });

    if (
        game.table.length ===
        room.players.length
    ) {

        completeTrick(
            room
        );

    } else {

        game.currentTurnIndex =
            (
                game.currentTurnIndex +
                1
            )
            %
            room.players.length;

        broadcast(
            room
        );

        scheduleBot(
            room
        );
    }
}

/* =========================================================
   SOCKET
========================================================= */

io.on(
    'connection',
    socket => {

        /* =================================================
           JOIN TABLE
        ================================================= */

        socket.on(
            'joinTable',
            data => {

                const name =
                    cleanName(
                        data &&
                        data.name
                    );

                if (
                    !name
                ) {

                    return socket.emit(
                        'errorMessage',
                        'შეიყვანე მოთამაშის სახელი.'
                    );
                }

                if (
                    socket.roomId
                ) {

                    return socket.emit(
                        'errorMessage',
                        'უკვე მაგიდაზე ხარ.'
                    );
                }

                /*
                    CAPACITY
                */

                let capacity =
                    parseInt(
                        data.capacity,
                        10
                    );

                if (
                    !ALLOWED_CAPACITIES
                        .includes(
                            capacity
                        )
                ) {

                    capacity =
                        3;
                }

                /*
                    PARTIES
                */

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

                /*
                    STAKE
                */

                let stake =
                    Number(
                        data.stake
                    );

                if (
                    !ALLOWED_STAKES
                        .includes(
                            stake
                        )
                ) {

                    stake =
                        5;
                }

                const tester =
                    isTester(
                        name
                    );

                /*
                    Find open room
                */

                let room =
                    Array.from(
                        rooms.values()
                    )
                    .find(
                        item =>
                            !item.game
                            &&
                            item.capacity ===
                            capacity
                            &&
                            item.parties ===
                            parties
                            &&
                            item.stake ===
                            stake
                            &&
                            item.players.length <
                            item.capacity
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
                    =================================================
                    TEST MODE
                    saba123 -> BOT FILL
                    =================================================
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

                        const botId =
                            makeId(
                                'bot'
                            );

                        room.players.push({

                            id:
                                botId,

                            name:
                                'BOT ' +
                                botNumber,

                            isBot:
                                true,

                            isTester:
                                false,

                            balance:
                                START_BALANCE
                        });

                        botNumber++;
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

                    broadcast(
                        room
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

        /* =================================================
           PLAY CARDS
        ================================================= */

        socket.on(
            'playCards',
            data => {

                const room =
                    socket.roomId
                        ?
                        rooms.get(
                            socket.roomId
                        )
                        :
                        null;

                if (
                    !room
                    ||
                    !room.game
                ) {

                    return;
                }

                const game =
                    room.game;

                if (
                    game.processing
                    ||
                    game.gameOver
                ) {

                    return;
                }

                const active =
                    room.players[
                        game.currentTurnIndex
                    ];

                if (
                    !active
                    ||
                    active.id !==
                    socket.id
                ) {

                    return socket.emit(
                        'errorMessage',
                        'ახლა შენი სვლა არ არის.'
                    );
                }

                const hand =
                    game.hands[
                        socket.id
                    ]
                    ||
                    [];

                let indexes =
                    Array.isArray(
                        data &&
                        data.cardIndices
                    )
                        ?
                        data
                            .cardIndices
                            .slice()
                        :
                        [];

                indexes =
                    [
                        ...new Set(
                            indexes
                        )
                    ]
                    .filter(
                        index =>
                            Number.isInteger(
                                index
                            )
                            &&
                            index >=
                            0
                            &&
                            index <
                            hand.length
                    );

                if (
                    !indexes.length
                ) {

                    return socket.emit(
                        'errorMessage',
                        'აირჩიე კარტი.'
                    );
                }

                const cards =
                    indexes.map(
                        index =>
                            hand[
                                index
                            ]
                    );

                /*
                    პირველი ჩამოსვლა:
                    ერთი ცვეტის კარტები
                */

                if (
                    !game.table.length
                ) {

                    const sameSuit =
                        cards.every(
                            card =>
                                card.suit ===
                                cards[
                                    0
                                ].suit
                        );

                    if (
                        !sameSuit
                    ) {

                        return socket.emit(
                            'errorMessage',
                            'პირველი ჩამოსვლა ერთი ცვეტის კარტებით უნდა იყოს.'
                        );
                    }

                    game.leadCount =
                        cards.length;

                } else {

                    const required =
                        Math.min(
                            game.leadCount ||
                            1,
                            hand.length
                        );

                    if (
                        !isMaliutka(
                            cards
                        )
                        &&
                        cards.length !==
                        required
                    ) {

                        return socket.emit(
                            'errorMessage',
                            'უნდა ჩამოხვიდე ' +
                            required +
                            ' კარტი ან მალიუტკა.'
                        );
                    }
                }

                /*
                    REMOVE CARDS
                */

                game.hands[
                    socket.id
                ] =
                    hand.filter(
                        (
                            _,
                            index
                        ) =>
                            !indexes.includes(
                                index
                            )
                    );

                /*
                    TABLE PLAY
                */

                game.table.push({

                    playerId:
                        socket.id,

                    playerName:
                        active.name,

                    cards
                });

                /*
                    TRICK COMPLETE
                */

                if (
                    game.table.length ===
                    room.players.length
                ) {

                    completeTrick(
                        room
                    );

                } else {

                    game.currentTurnIndex =
                        (
                            game.currentTurnIndex +
                            1
                        )
                        %
                        room.players.length;

                    broadcast(
                        room
                    );

                    scheduleBot(
                        room
                    );
                }
            }
        );

        /* =================================================
           DISCONNECT
        ================================================= */

        socket.on(
            'disconnect',
            () => {

                const room =
                    socket.roomId
                        ?
                        rooms.get(
                            socket.roomId
                        )
                        :
                        null;

                if (
                    !room
                ) {

                    return;
                }

                room.players =
                    room.players.filter(
                        player =>
                            player.id !==
                            socket.id
                    );

                const humans =
                    room.players.filter(
                        player =>
                            !player.isBot
                    );

                if (
                    humans.length ===
                    0
                ) {

                    rooms.delete(
                        room.id
                    );

                } else {

                    io.to(
                        room.id
                    ).emit(
                        'errorMessage',
                        'ერთ-ერთმა მოთამაშემ დატოვა მაგიდა.'
                    );
                }
            }
        );
    }
);

/* =========================================================
   FRONTEND
========================================================= */

const PAGE =
String.raw`
<!doctype html>

<html lang="ka">

<head>

<meta charset="utf-8">

<meta
    name="viewport"
    content="width=device-width,initial-scale=1"
>

<title>
    Written Bura
</title>

<script src="/socket.io/socket.io.js"></script>

<style>

* {
    box-sizing:
        border-box;
}

body {

    margin:
        0;

    font-family:
        Arial,
        sans-serif;

    background:
        #0d0a08;

    color:
        #f3eadc;

    min-height:
        100vh;
}

button,
input,
select {

    font:
        inherit;
}

.hidden {

    display:
        none !important;
}

:root {

    --gold:
        #d6ad62;

    --dark:
        #15100c;

    --panel:
        #21150f;

    --wine:
        #3a1412;

    --green:
        #2f694f;

    --muted:
        #b7a995;
}

/* =========================================================
   LOBBY
========================================================= */

#lobby {

    min-height:
        100vh;

    background:

        radial-gradient(
            circle at 50% 15%,
            rgba(115,53,28,.28),
            transparent 36%
        ),

        linear-gradient(
            135deg,
            #0b0806,
            #22120c 55%,
            #090705
        );
}

.lobby-shell {

    width:
        min(1160px,95vw);

    margin:
        auto;

    padding:
        22px;
}

.lobby-head {

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;

    gap:
        16px;

    margin-bottom:
        18px;
}

.logo {

    font-family:
        Georgia,
        serif;

    font-size:
        29px;

    color:
        var(--gold);

    font-weight:
        700;
}

.tester-note {

    font-size:
        12px;

    color:
        #cab88f;
}

.hero {

    display:
        grid;

    grid-template-columns:
        1.25fr .75fr;

    gap:
        18px;
}

.hero-main,
.join-panel {

    border:
        1px solid
        rgba(214,173,98,.38);

    border-radius:
        18px;

    background:
        linear-gradient(
            145deg,
            rgba(64,31,20,.95),
            rgba(22,15,11,.96)
        );

    box-shadow:
        0 25px 60px
        rgba(0,0,0,.36);
}

.hero-main {

    padding:
        34px;

    min-height:
        330px;

    position:
        relative;

    overflow:
        hidden;
}

.hero-main:after {

    content:
        "♠  ♣  ♦  ♥";

    position:
        absolute;

    right:
        28px;

    bottom:
        30px;

    font-size:
        64px;

    color:
        rgba(255,255,255,.07);

    transform:
        rotate(-8deg);
}

.hero-main h1 {

    font-family:
        Georgia,
        serif;

    font-size:
        48px;

    margin:
        0 0 12px;

    color:
        #eed3a0;
}

.hero-main p {

    max-width:
        560px;

    line-height:
        1.7;

    color:
        #c9b9a4;
}

.join-panel {

    padding:
        22px;
}

.join-panel h2 {

    margin-top:
        0;

    color:
        #eed3a0;
}

.field {

    margin:
        12px 0;
}

.field label {

    display:
        block;

    font-size:
        11px;

    color:
        #bcae99;

    margin-bottom:
        6px;
}

.field input,
.field select {

    width:
        100%;

    height:
        42px;

    border-radius:
        8px;

    border:
        1px solid
        #5e4637;

    background:
        #120e0b;

    color:
        white;

    padding:
        0 12px;
}

.join-grid {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        10px;
}

.gold-btn {

    width:
        100%;

    height:
        44px;

    border:
        0;

    border-radius:
        9px;

    background:
        linear-gradient(
            #f0cf8d,
            #b9863f
        );

    color:
        #2a180d;

    font-weight:
        800;

    cursor:
        pointer;
}

.gold-btn:hover {

    filter:
        brightness(1.06);
}

.wait {

    min-height:
        22px;

    margin-top:
        10px;

    color:
        #edc982;

    font-size:
        12px;
}

/* =========================================================
   STAKES
========================================================= */

.table-list {

    margin-top:
        22px;

    display:
        grid;

    grid-template-columns:
        repeat(5,1fr);

    gap:
        10px;
}

.stake-card {

    padding:
        15px;

    border:
        1px solid
        rgba(214,173,98,.25);

    border-radius:
        12px;

    background:
        #1a120e;

    text-align:
        center;

    cursor:
        pointer;
}

.stake-card.active {

    border-color:
        var(--gold);

    box-shadow:
        0 0 18px
        rgba(214,173,98,.18);
}

.stake-card b {

    display:
        block;

    color:
        #efd28e;

    font-size:
        22px;
}

.stake-card span {

    font-size:
        11px;

    color:
        #aa9986;
}

/* =========================================================
   GAME
========================================================= */

#game {

    display:
        none;

    min-height:
        100vh;

    background:
        radial-gradient(
            circle at 50% 40%,
            #3d2b1e 0,
            #1d130e 42%,
            #0b0907 100%
        );

    padding:
        10px;
}

.game-shell {

    width:
        min(1180px,98vw);

    margin:
        auto;
}

/* =========================================================
   HUD
========================================================= */

.hud {

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;

    gap:
        12px;

    flex-wrap:
        wrap;

    margin-bottom:
        10px;
}

.hud-title {

    font-family:
        Georgia,
        serif;

    font-size:
        24px;

    color:
        #f0d49b;
}

.hud-stats {

    display:
        flex;

    gap:
        8px;

    flex-wrap:
        wrap;
}

.hud-card {

    min-width:
        92px;

    background:
        rgba(40,26,19,.92);

    border:
        1px solid
        rgba(214,173,98,.35);

    border-radius:
        12px;

    padding:
        8px 12px;

    text-align:
        center;
}

.hud-card small {

    display:
        block;

    color:
        #a9957e;
}

.hud-card b {

    font-size:
        15px;

    color:
        #f0cf8d;
}

.status {

    text-align:
        center;

    color:
        #f0cf8d;

    font-weight:
        800;

    min-height:
        28px;
}

/* =========================================================
   TABLE
========================================================= */

.table-wrap {

    position:
        relative;

    height:
        600px;

    border-radius:
        34px;

    overflow:
        hidden;

    background:
        linear-gradient(
            145deg,
            #2a190f,
            #120d09
        );

    box-shadow:
        0 30px 90px
        rgba(0,0,0,.58);
}

.table-wrap:before {

    content:
        "";

    position:
        absolute;

    inset:
        35px 55px;

    border-radius:
        80px;

    background:
        linear-gradient(
            145deg,
            #8a5a37,
            #5a351f
        );

    clip-path:
        polygon(
            14% 0,
            86% 0,
            100% 28%,
            92% 82%,
            72% 100%,
            28% 100%,
            8% 82%,
            0 28%
        );

    box-shadow:

        inset 0 0 0 10px
        rgba(40,22,12,.5),

        inset 0 0 70px
        rgba(0,0,0,.45);
}

.table-felt {

    position:
        absolute;

    inset:
        105px 170px 150px;

    border-radius:
        34px;

    background:
        radial-gradient(
            circle,
            #456c4f,
            #294936 68%,
            #20382a
        );

    border:
        8px solid
        #4a2a18;

    box-shadow:
        inset 0 0 45px
        rgba(0,0,0,.35);
}

/* =========================================================
   DECK / TRUMP
========================================================= */

.deck-zone {

    position:
        absolute;

    left:
        50%;

    top:
        42%;

    transform:
        translate(-50%,-50%);

    display:
        flex;

    gap:
        24px;

    align-items:
        center;

    z-index:
        3;
}

.deck-stack {

    width:
        58px;

    height:
        82px;

    border-radius:
        6px;

    background:
        repeating-linear-gradient(
            45deg,
            #23334e 0 4px,
            #15223a 4px 8px
        );

    border:
        3px solid
        #d9d1c6;

    box-shadow:
        5px 5px 0
        #746d65;
}

.deck-label {

    text-align:
        center;

    font-size:
        10px;

    color:
        #f0e4d0;
}

.trump-preview {

    width:
        58px;

    height:
        82px;
}

/* =========================================================
   PLAYERS
========================================================= */

.seat {

    position:
        absolute;

    transform:
        translate(-50%,-50%);

    width:
        150px;

    text-align:
        center;

    z-index:
        5;
}

.seat-box {

    background:
        rgba(20,14,10,.78);

    border:
        1px solid
        rgba(214,173,98,.35);

    border-radius:
        14px;

    padding:
        7px;
}

.seat.current
.seat-box {

    border-color:
        #ffd77e;

    box-shadow:
        0 0 22px
        rgba(255,215,126,.35);
}

.avatar {

    width:
        48px;

    height:
        48px;

    border-radius:
        50%;

    margin:
        auto;

    background:
        radial-gradient(
            circle at 45% 35%,
            #ddc0a8,
            #8d5b3c 48%,
            #332116 49%
        );

    border:
        3px solid
        var(--gold);

    box-shadow:
        0 4px 13px
        rgba(0,0,0,.4);
}

.seat-name {

    font-weight:
        800;

    font-size:
        11px;

    margin-top:
        4px;
}

.seat-info {

    font-size:
        9px;

    color:
        #d2bf9e;
}

.backs {

    display:
        flex;

    justify-content:
        center;

    margin-top:
        4px;
}

.back {

    width:
        16px;

    height:
        24px;

    margin-left:
        -5px;

    border-radius:
        3px;

    background:
        repeating-linear-gradient(
            45deg,
            #263950 0 3px,
            #142031 3px 6px
        );

    border:
        1px solid
        #e4d8c3;
}

.back:first-child {

    margin-left:
        0;
}

/* =========================================================
   TABLE CARDS
========================================================= */

#table-cards {

    position:
        absolute;

    left:
        50%;

    top:
        53%;

    transform:
        translate(-50%,-50%);

    z-index:
        6;

    display:
        flex;

    gap:
        10px;

    max-width:
        56%;

    align-items:
        center;
}

.play-group {

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;
}

.play-name {

    font-size:
        8px;

    background:
        rgba(10,7,5,.72);

    padding:
        3px 6px;

    border-radius:
        12px;

    margin-bottom:
        3px;
}

.play-group.winner
.card {

    box-shadow:
        0 0 24px
        #ffd66c;

    border:
        2px solid
        #ffd66c;
}

/* =========================================================
   HAND
========================================================= */

.hand-zone {

    position:
        absolute;

    left:
        50%;

    bottom:
        18px;

    transform:
        translateX(-50%);

    z-index:
        8;

    width:
        min(720px,90%);

    text-align:
        center;
}

.hand {

    display:
        flex;

    justify-content:
        center;

    gap:
        6px;

    align-items:
        flex-end;

    min-height:
        104px;
}

/* =========================================================
   CARDS
========================================================= */

.card {

    width:
        66px;

    height:
        96px;

    border-radius:
        8px;

    padding:
        5px;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        space-between;

    font-weight:
        900;

    box-shadow:
        0 6px 15px
        rgba(0,0,0,.45);

    user-select:
        none;

    background:
        #fff;
}

.card-center {

    text-align:
        center;

    font-size:
        31px;
}

.card-bottom {

    transform:
        rotate(180deg);
}

/* ♠ BLACK */

.suit-spades {

    color:
        #080808;

    border:
        1px solid
        #222;
}

/* ♣ EMERALD */

.suit-clubs {

    color:
        #007b59;

    border:
        1px solid
        #29866f;

    background:
        #f6fffb;
}

/* ♦ NAVY */

.suit-diamonds {

    color:
        #071f52;

    border:
        1px solid
        #425d90;

    background:
        #f7f9ff;
}

/* ♥ BURGUNDY */

.suit-hearts {

    color:
        #711429;

    border:
        1px solid
        #8a4a58;

    background:
        #fff8fa;
}

.hand
.card {

    cursor:
        pointer;

    transition:
        .16s;
}

.hand
.card:hover {

    transform:
        translateY(-8px);
}

.hand
.card.selected {

    transform:
        translateY(-17px);

    box-shadow:
        0 0 26px
        #6ee7ff;

    border:
        3px solid
        #6ee7ff;
}

/* =========================================================
   PLAY BUTTON
========================================================= */

.play-btn {

    margin-top:
        8px;

    padding:
        10px 28px;

    border:
        0;

    border-radius:
        24px;

    background:
        linear-gradient(
            #7edc78,
            #2d8f46
        );

    color:
        white;

    font-weight:
        900;

    box-shadow:
        0 7px 20px
        rgba(42,143,72,.34);
}

.play-btn:disabled {

    background:
        #46413d;

    color:
        #8e8780;

    box-shadow:
        none;
}

/* =========================================================
   SCORE
========================================================= */

.score-panel {

    margin-top:
        12px;

    border:
        1px solid
        rgba(214,173,98,.28);

    border-radius:
        12px;

    background:
        rgba(24,15,11,.88);

    overflow:
        hidden;
}

.score-title {

    padding:
        10px 12px;

    color:
        #efcf8b;

    font-weight:
        900;
}

.score-row {

    display:
        grid;

    grid-template-columns:
        70px
        1.4fr
        1fr
        1fr;

    align-items:
        center;

    border-top:
        1px solid
        rgba(255,255,255,.06);

    font-size:
        11px;
}

.score-row > div {

    padding:
        8px;

    text-align:
        center;
}

/* =========================================================
   TEST MODE
========================================================= */

.tester-panel {

    margin-top:
        10px;

    border:
        1px solid
        rgba(123,206,255,.35);

    background:
        rgba(30,73,100,.18);

    border-radius:
        10px;

    padding:
        10px;

    display:
        none;
}

.tester-panel.show {

    display:
        block;
}

.tester-grid {

    display:
        grid;

    grid-template-columns:
        repeat(4,1fr);

    gap:
        8px;
}

.tester-hand {

    background:
        rgba(0,0,0,.24);

    border-radius:
        8px;

    padding:
        8px;
}

.tester-hand b {

    font-size:
        10px;
}

.mini {

    display:
        flex;

    gap:
        4px;

    flex-wrap:
        wrap;

    margin-top:
        5px;
}

.mini span {

    background:
        #f3eee8;

    color:
        #1a1511;

    border-radius:
        4px;

    padding:
        2px 5px;

    font-size:
        10px;
}

/* =========================================================
   MOBILE
========================================================= */

@media(
    max-width:900px
) {

    .hero {

        grid-template-columns:
            1fr;
    }

    .table-list {

        grid-template-columns:
            repeat(3,1fr);
    }

    .table-wrap {

        height:
            540px;
    }

    .table-felt {

        inset:
            100px 90px 145px;
    }

    .tester-grid {

        grid-template-columns:
            1fr 1fr;
    }
}

@media(
    max-width:600px
) {

    .lobby-head {

        align-items:
            flex-start;

        flex-direction:
            column;
    }

    .hero-main h1 {

        font-size:
            34px;
    }

    .table-list {

        grid-template-columns:
            1fr 1fr;
    }

    .table-wrap {

        height:
            500px;
    }

    .table-felt {

        inset:
            100px 45px 150px;
    }

    .seat {

        width:
            105px;
    }

    .avatar {

        width:
            38px;

        height:
            38px;
    }

    .card {

        width:
            48px;

        height:
            70px;
    }

    .card-center {

        font-size:
            20px;
    }

    .tester-grid {

        grid-template-columns:
            1fr;
    }

    .score-row {

        grid-template-columns:
            45px
            1.2fr
            .8fr
            .8fr;
    }
}

</style>

</head>

<body>

<!-- ======================================================
     LOBBY
======================================================= -->

<section id="lobby">

    <div class="lobby-shell">

        <div class="lobby-head">

            <div class="logo">
                WRITTEN BURA
            </div>

            <div class="tester-note">

                TEST MODE:

                <b>
                    saba123
                </b>

                — რეგისტრაცია/პაროლი არ სჭირდება

            </div>

        </div>

        <div class="hero">

            <div class="hero-main">

                <h1>

                    კლასიკური ბურა

                    <br>

                    ახალ ვიზუალში

                </h1>

                <p>

                    რეგისტრაცია დროებით არ არის სავალდებულო.

                    ჩაწერე სახელი, აირჩიე 3 ან 4 მოთამაშე,
                    1-4 პარტია და ფსონი.

                    ჩვეულებრივი მოთამაშე დაელოდება სხვებს,
                    ხოლო

                    <b>
                        saba123
                    </b>

                    ტესტ-რეჟიმში ბოტებით შეავსებს მაგიდას
                    და თამაში მაშინვე დაიწყება.

                </p>

            </div>

            <div class="join-panel">

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

                <div class="join-grid">

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
                            პარტია
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
                    class="gold-btn"
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

        <!-- STAKES -->

        <div class="table-list">

            <div
                class="stake-card active"
                onclick="chooseStake(5,this)"
            >

                <b>
                    $5
                </b>

                <span>
                    CLASSIC
                </span>

            </div>

            <div
                class="stake-card"
                onclick="chooseStake(10,this)"
            >

                <b>
                    $10
                </b>

                <span>
                    STANDARD
                </span>

            </div>

            <div
                class="stake-card"
                onclick="chooseStake(25,this)"
            >

                <b>
                    $25
                </b>

                <span>
                    PREMIUM
                </span>

            </div>

            <div
                class="stake-card"
                onclick="chooseStake(50,this)"
            >

                <b>
                    $50
                </b>

                <span>
                    VIP
                </span>

            </div>

            <div
                class="stake-card"
                onclick="chooseStake(100,this)"
            >

                <b>
                    $100
                </b>

                <span>
                    ELITE
                </span>

            </div>

        </div>

    </div>

</section>

<!-- ======================================================
     GAME
======================================================= -->

<section id="game">

    <div class="game-shell">

        <!-- HUD -->

        <div class="hud">

            <div class="hud-title">
                წერითი ბურა
            </div>

            <div class="hud-stats">

                <div class="hud-card">

                    <small>
                        ონლაინ მაგიდა
                    </small>

                    <b id="hudPlayers">
                        -
                    </b>

                </div>

                <div class="hud-card">

                    <small>
                        პარტია
                    </small>

                    <b id="hudParty">
                        -
                    </b>

                </div>

                <div class="hud-card">

                    <small>
                        ხელი
                    </small>

                    <b id="hudHand">
                        -
                    </b>

                </div>

                <div class="hud-card">

                    <small>
                        კოზირი
                    </small>

                    <b id="hudTrump">
                        -
                    </b>

                </div>

                <div class="hud-card">

                    <small>
                        დასტა
                    </small>

                    <b id="hudDeck">
                        -
                    </b>

                </div>

                <div class="hud-card">

                    <small>
                        ფსონი
                    </small>

                    <b id="hudStake">
                        -
                    </b>

                </div>

            </div>

            <button
                class="gold-btn"
                style="
                    width:auto;
                    padding:0 18px;
                "
                onclick="location.reload()"
            >
                გასვლა
            </button>

        </div>

        <div
            id="status"
            class="status"
        ></div>

        <!-- TESTER PANEL -->

        <div
            id="testerPanel"
            class="tester-panel"
        >

            <b>
                🧪 TEST MODE — ყველა მოთამაშის კარტი
            </b>

            <div
                id="testerGrid"
                class="tester-grid"
            ></div>

        </div>

        <!-- GAME TABLE -->

        <div class="table-wrap">

            <div class="table-felt"></div>

            <div class="deck-zone">

                <div>

                    <div class="deck-stack"></div>

                    <div class="deck-label">

                        Deck:

                        <span id="centerDeck">
                            36
                        </span>

                    </div>

                </div>

                <div>

                    <div
                        id="trumpPreview"
                        class="trump-preview"
                    ></div>

                    <div class="deck-label">
                        კოზირი
                    </div>

                </div>

            </div>

            <div id="players"></div>

            <div id="table-cards"></div>

            <div class="hand-zone">

                <div
                    id="my-cards"
                    class="hand"
                ></div>

                <button
                    id="playBtn"
                    class="play-btn"
                    disabled
                    onclick="playSelected()"
                >
                    სვლის გაკეთება
                </button>

            </div>

        </div>

        <!-- SCORE -->

        <div class="score-panel">

            <div class="score-title">
                🏆 LIVE SCORE
            </div>

            <div id="score"></div>

        </div>

    </div>

</section>

<script>

/* =========================================================
   CLIENT
========================================================= */

const socket =
    io();

let current =
    null;

let selected =
    [];

/* =========================================================
   STAKE
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
            '.stake-card'
        )
        .forEach(
            function(
                item
            ) {

                item
                    .classList
                    .remove(
                        'active'
                    );
            }
        );

    element
        .classList
        .add(
            'active'
        );
}

/* =========================================================
   JOIN
========================================================= */

function joinGame() {

    const name =
        document
            .getElementById(
                'playerName'
            )
            .value
            .trim();

    if (
        !name
    ) {

        alert(
            'შეიყვანე მოთამაშის სახელი'
        );

        return;
    }

    document
        .getElementById(
            'wait'
        )
        .textContent =
            name.toLowerCase() ===
            'saba123'
                ?
                'TEST მაგიდა მზადდება...'
                :
                'ვეძებთ მოთამაშეებს...';

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
                )
        }
    );
}

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
    'waitingForPlayers',
    function(
        data
    ) {

        document
            .getElementById(
                'wait'
            )
            .textContent =
                'ველოდებით მოთამაშეებს: '
                +
                data.current
                +
                ' / '
                +
                data.max;
    }
);

socket.on(
    'errorMessage',
    function(
        message
    ) {

        alert(
            message
        );

        const status =
            document
                .getElementById(
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
    function(
        state
    ) {

        current =
            state;

        selected =
            [];

        document
            .getElementById(
                'lobby'
            )
            .style
            .display =
                'none';

        document
            .getElementById(
                'game'
            )
            .style
            .display =
                'block';

        render(
            state
        );
    }
);

/* =========================================================
   HELPERS
========================================================= */

function suitSymbol(
    suit
) {

    return {

        spades:
            '♠',

        clubs:
            '♣',

        diamonds:
            '♦',

        hearts:
            '♥'

    }[
        suit
    ] ||
    '';
}

function trumpText(
    trump
) {

    return (
        trump ===
        'no_trump'
            ?
            'უკოზირო'
            :
            suitSymbol(
                trump
            )
    );
}

function escapeHtml(
    value
) {

    return String(
        value == null
            ?
            ''
            :
            value
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

function createCard(
    card
) {

    const element =
        document
            .createElement(
                'div'
            );

    element.className =
        'card suit-'
        +
        card.suit;

    const symbol =
        suitSymbol(
            card.suit
        );

    element.innerHTML =
        '<div>'
        +
        escapeHtml(
            card.rank
        )
        +
        ' '
        +
        symbol
        +
        '</div>'
        +
        '<div class="card-center">'
        +
        symbol
        +
        '</div>'
        +
        '<div class="card-bottom">'
        +
        escapeHtml(
            card.rank
        )
        +
        ' '
        +
        symbol
        +
        '</div>';

    return element;
}

/* =========================================================
   RENDER
========================================================= */

function render(
    state
) {

    document
        .getElementById(
            'hudPlayers'
        )
        .textContent =
            state.capacity
            +
            ' players';

    document
        .getElementById(
            'hudParty'
        )
        .textContent =
            state.partyIndex
            +
            ' / '
            +
            state.parties;

    document
        .getElementById(
            'hudHand'
        )
        .textContent =
            state.handIndex
            +
            ' / '
            +
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
            '$'
            +
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
}

/* =========================================================
   TRUMP PREVIEW
========================================================= */

function renderTrump(
    trump
) {

    const box =
        document
            .getElementById(
                'trumpPreview'
            );

    box.innerHTML =
        '';

    if (
        trump ===
        'no_trump'
    ) {

        box.innerHTML =
            '<div class="card" '
            +
            'style="color:#333;display:grid;place-items:center">'
            +
            'Ø'
            +
            '</div>';

        return;
    }

    box.appendChild(
        createCard({

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

    let myIndex =
        players.findIndex(
            function(
                player
            ) {

                return (
                    player.id ===
                    myId
                );
            }
        );

    if (
        myIndex <
        0
    ) {

        myIndex =
            0;
    }

    const relative =
        (
            index -
            myIndex +
            count
        )
        %
        count;

    const positions3 = [

        {
            l:
                50,

            t:
                84
        },

        {
            l:
                18,

            t:
                28
        },

        {
            l:
                82,

            t:
                28
        }
    ];

    const positions4 = [

        {
            l:
                50,

            t:
                84
        },

        {
            l:
                14,

            t:
                50
        },

        {
            l:
                50,

            t:
                16
        },

        {
            l:
                86,

            t:
                50
        }
    ];

    return (
        count ===
        4
            ?
            positions4
            :
            positions3
    )[
        relative
    ];
}

/* =========================================================
   PLAYERS
========================================================= */

function renderPlayers(
    state
) {

    const root =
        document
            .getElementById(
                'players'
            );

    root.innerHTML =
        '';

    state.players
        .forEach(
            function(
                player,
                index
            ) {

                const position =
                    seatPosition(
                        index,
                        state.players.length,
                        state.viewingPlayerId,
                        state.players
                    );

                const element =
                    document
                        .createElement(
                            'div'
                        );

                element.className =
                    'seat'
                    +
                    (
                        player.isCurrent
                            ?
                            ' current'
                            :
                            ''
                    );

                element.style.left =
                    position.l
                    +
                    '%';

                element.style.top =
                    position.t
                    +
                    '%';

                let backs =
                    '';

                if (
                    player.id !==
                    state.viewingPlayerId
                ) {

                    for (
                        let i =
                            0;

                        i <
                        player.cardCount;

                        i++
                    ) {

                        backs +=
                            '<div class="back"></div>';
                    }
                }

                element.innerHTML =
                    '<div class="seat-box">'
                    +
                    '<div class="avatar"></div>'
                    +
                    '<div class="seat-name">'
                    +
                    escapeHtml(
                        player.name
                    )
                    +
                    (
                        player.isBot
                            ?
                            ' 🤖'
                            :
                            ''
                    )
                    +
                    '</div>'
                    +
                    '<div class="seat-info">'
                    +
                    '💰 '
                    +
                    player.balance
                    +
                    ' · hand '
                    +
                    player.handPoints
                    +
                    ' · total '
                    +
                    player.totalPoints
                    +
                    '</div>'
                    +
                    '<div class="backs">'
                    +
                    backs
                    +
                    '</div>'
                    +
                    '</div>';

                root.appendChild(
                    element
                );
            }
        );
}

/* =========================================================
   TABLE CARDS
========================================================= */

function renderTable(
    state
) {

    const root =
        document
            .getElementById(
                'table-cards'
            );

    root.innerHTML =
        '';

    state.table
        .forEach(
            function(
                play
            ) {

                const group =
                    document
                        .createElement(
                            'div'
                        );

                group.className =
                    'play-group'
                    +
                    (
                        play.isWinning
                            ?
                            ' winner'
                            :
                            ''
                    );

                const name =
                    document
                        .createElement(
                            'div'
                        );

                name.className =
                    'play-name';

                name.textContent =
                    play.playerName;

                group.appendChild(
                    name
                );

                play.cards
                    .forEach(
                        function(
                            card
                        ) {

                            group.appendChild(
                                createCard(
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

function renderHand(
    state
) {

    const root =
        document
            .getElementById(
                'my-cards'
            );

    root.innerHTML =
        '';

    const cards =
        state.playersCards[
            state.viewingPlayerId
        ]
        ||
        [];

    cards.forEach(
        function(
            card,
            index
        ) {

            const element =
                createCard(
                    card
                );

            element.onclick =
                function() {

                    toggleCard(
                        index,
                        element
                    );
                };

            root.appendChild(
                element
            );
        }
    );

    updatePlayButton(
        state
    );
}

/* =========================================================
   SELECT CARD
========================================================= */

function toggleCard(
    index,
    element
) {

    const found =
        selected.indexOf(
            index
        );

    if (
        found >=
        0
    ) {

        selected.splice(
            found,
            1
        );

        element
            .classList
            .remove(
                'selected'
            );

    } else {

        selected.push(
            index
        );

        element
            .classList
            .add(
                'selected'
            );
    }

    updatePlayButton(
        current
    );
}

/* =========================================================
   PLAY BUTTON
========================================================= */

function updatePlayButton(
    state
) {

    const button =
        document
            .getElementById(
                'playBtn'
            );

    const active =
        state
            ?
            state.players[
                state.currentTurnIndex
            ]
            :
            null;

    button.disabled =
        !state
        ||
        !active
        ||
        active.id !==
        state.viewingPlayerId
        ||
        selected.length ===
        0
        ||
        state.processing
        ||
        state.gameOver;
}

function playSelected() {

    if (
        !selected.length
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

    selected =
        [];
}

/* =========================================================
   STATUS
========================================================= */

function updateStatus(
    state
) {

    const status =
        document
            .getElementById(
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
            '✨ კარტები ითვლება...';

        return;
    }

    const player =
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
            '🤖 '
            +
            player.name
            +
            ' თამაშობს...';

    } else {

        status.textContent =
            player.name
            +
            '-ის სვლაა';
    }
}

/* =========================================================
   SCORE
========================================================= */

function renderScore(
    state
) {

    const root =
        document
            .getElementById(
                'score'
            );

    const last =
        state.lastHandScores
        ||
        {};

    const players =
        state.players
            .slice()
            .sort(
                function(
                    a,
                    b
                ) {

                    return (
                        (
                            b.totalPoints
                            ||
                            0
                        )
                        -
                        (
                            a.totalPoints
                            ||
                            0
                        )
                    );
                }
            );

    let html =
        '<div class="score-row">'
        +
        '<div>#</div>'
        +
        '<div>მოთამაშე</div>'
        +
        '<div>ბოლო ხელი</div>'
        +
        '<div>საერთო</div>'
        +
        '</div>';

    players.forEach(
        function(
            player,
            index
        ) {

            let place =
                '#'
                +
                (
                    index +
                    1
                );

            if (
                index ===
                0
            ) {

                place =
                    '🥇';

            } else if (
                index ===
                1
            ) {

                place =
                    '🥈';

            } else if (
                index ===
                2
            ) {

                place =
                    '🥉';
            }

            const lastHand =
                typeof last[
                    player.id
                ] ===
                'number'
                    ?
                    last[
                        player.id
                    ]
                    :
                    '-';

            html +=
                '<div class="score-row">'
                +
                '<div>'
                +
                place
                +
                '</div>'
                +
                '<div>'
                +
                escapeHtml(
                    player.name
                )
                +
                (
                    player.id ===
                    state.viewingPlayerId
                        ?
                        ' · YOU'
                        :
                        ''
                )
                +
                '</div>'
                +
                '<div>'
                +
                lastHand
                +
                '</div>'
                +
                '<div><b>'
                +
                player.totalPoints
                +
                '</b></div>'
                +
                '</div>';
        }
    );

    root.innerHTML =
        html;
}

/* =========================================================
   TESTER VIEW
========================================================= */

function renderTester(
    state
) {

    const panel =
        document
            .getElementById(
                'testerPanel'
            );

    const grid =
        document
            .getElementById(
                'testerGrid'
            );

    if (
        !state.revealAll
    ) {

        panel
            .classList
            .remove(
                'show'
            );

        grid.innerHTML =
            '';

        return;
    }

    panel
        .classList
        .add(
            'show'
        );

    let html =
        '';

    state.players.forEach(
        function(
            player
        ) {

            const cards =
                state.playersCards[
                    player.id
                ]
                ||
                [];

            html +=
                '<div class="tester-hand">'
                +
                '<b>'
                +
                escapeHtml(
                    player.name
                )
                +
                '</b>'
                +
                '<div class="mini">';

            cards.forEach(
                function(
                    card
                ) {

                    html +=
                        '<span>'
                        +
                        escapeHtml(
                            card.rank
                        )
                        +
                        suitSymbol(
                            card.suit
                        )
                        +
                        '</span>';
                }
            );

            html +=
                '</div>'
                +
                '</div>';
        }
    );

    grid.innerHTML =
        html;
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
    (
        req,
        res
    ) => {

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
    (
        req,
        res
    ) => {

        res.json({

            ok:
                true,

            cards:
                36,

            tester:
                TESTER_NAME
        });
    }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    () => {

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
