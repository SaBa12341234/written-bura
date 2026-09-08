const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: '*'
    }
});

const PORT = process.env.PORT || 10000;

const TESTER_USERNAME = 'saba123';
const STARTING_BALANCE = 1000;

const USERS_FILE = path.join(
    __dirname,
    'users.json'
);

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

app.use(express.json());

/* =========================================================
   USERS
========================================================= */

let users = [];

try {

    if (
        fs.existsSync(
            USERS_FILE
        )
    ) {

        const parsed =
            JSON.parse(
                fs.readFileSync(
                    USERS_FILE,
                    'utf8'
                )
            );

        users =
            Array.isArray(parsed)
                ?
                parsed
                :
                [];
    }

} catch (err) {

    console.error(
        'users.json read error:',
        err
    );

    users = [];
}

let usersChanged =
    false;

for (
    const user of users
) {

    if (
        typeof user.balance !==
        'number'
        ||
        !Number.isFinite(
            user.balance
        )
    ) {

        user.balance =
            STARTING_BALANCE;

        usersChanged =
            true;
    }
}

if (
    usersChanged
) {

    saveUsers();
}

function saveUsers() {

    try {

        fs.writeFileSync(
            USERS_FILE,
            JSON.stringify(
                users,
                null,
                2
            )
        );

    } catch (err) {

        console.error(
            'users.json save error:',
            err
        );
    }
}

/* =========================================================
   SESSIONS
========================================================= */

const sessions =
    new Map();

const testerSessions =
    new Set();

function normalizeUsername(
    value
) {

    return String(
        value || ''
    ).trim();
}

function normalizeEmail(
    value
) {

    return String(
        value || ''
    )
        .trim()
        .toLowerCase();
}

function isTesterUsername(
    value
) {

    return (
        normalizeUsername(
            value
        ).toLowerCase()
        ===
        TESTER_USERNAME
            .toLowerCase()
    );
}

function hashPassword(
    password,
    salt
) {

    return crypto
        .scryptSync(
            String(
                password
            ),
            salt,
            64
        )
        .toString(
            'hex'
        );
}

function createToken() {

    return crypto
        .randomBytes(
            32
        )
        .toString(
            'hex'
        );
}

function getUserByToken(
    token
) {

    if (
        !token
    ) {

        return null;
    }

    /*
        TEST USER
    */

    if (
        testerSessions.has(
            token
        )
    ) {

        return {

            id:
                'tester_saba123',

            username:
                TESTER_USERNAME,

            balance:
                STARTING_BALANCE,

            isTester:
                true
        };
    }

    const userId =
        sessions.get(
            token
        );

    if (
        !userId
    ) {

        return null;
    }

    const user =
        users.find(
            item =>
                item.id ===
                userId
        );

    if (
        !user
    ) {

        return null;
    }

    return {

        ...user,

        isTester:
            false
    };
}

/* =========================================================
   REGISTER
========================================================= */

app.post(
    '/api/register',
    (
        req,
        res
    ) => {

        const username =
            normalizeUsername(
                req.body.username
            );

        const email =
            normalizeEmail(
                req.body.email
            );

        const password =
            String(
                req.body.password ||
                ''
            );

        /*
            saba123 დაცულია
        */

        if (
            isTesterUsername(
                username
            )
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'saba123 დაცულია სატესტო რეჟიმისთვის.'
                });
        }

        if (
            username.length <
            3
            ||
            username.length >
            20
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'Username უნდა იყოს 3-20 სიმბოლო.'
                });
        }

        if (
            !/^[a-zA-Z0-9_\u10A0-\u10FF]+$/u
                .test(
                    username
                )
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'Username-ში გამოიყენე ასოები, ციფრები ან _.'
                });
        }

        if (
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
                .test(
                    email
                )
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'შეიყვანე სწორი Email.'
                });
        }

        if (
            password.length <
            6
        ) {

            return res
                .status(400)
                .json({

                    ok:
                        false,

                    message:
                        'პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს.'
                });
        }

        const usernameExists =
            users.some(
                user =>
                    user.username
                        .toLowerCase()
                    ===
                    username
                        .toLowerCase()
            );

        if (
            usernameExists
        ) {

            return res
                .status(409)
                .json({

                    ok:
                        false,

                    message:
                        'ეს Username უკვე დაკავებულია.'
                });
        }

        const emailExists =
            users.some(
                user =>
                    user.email ===
                    email
            );

        if (
            emailExists
        ) {

            return res
                .status(409)
                .json({

                    ok:
                        false,

                    message:
                        'ეს Email უკვე რეგისტრირებულია.'
                });
        }

        const salt =
            crypto
                .randomBytes(
                    16
                )
                .toString(
                    'hex'
                );

        const user = {

            id:
                'user_' +
                Date.now() +
                '_' +
                Math.floor(
                    Math.random() *
                    100000
                ),

            username,

            email,

            salt,

            passwordHash:
                hashPassword(
                    password,
                    salt
                ),

            balance:
                STARTING_BALANCE,

            createdAt:
                new Date()
                    .toISOString()
        };

        users.push(
            user
        );

        saveUsers();

        const token =
            createToken();

        sessions.set(
            token,
            user.id
        );

        return res.json({

            ok:
                true,

            token,

            username:
                user.username,

            balance:
                user.balance,

            isTester:
                false
        });
    }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
    '/api/login',
    (
        req,
        res
    ) => {

        const username =
            normalizeUsername(
                req.body.username
            );

        const password =
            String(
                req.body.password ||
                ''
            );

        /*
            =================================================
            TEST MODE
            saba123-ს პაროლი არ სჭირდება
            =================================================
        */

        if (
            isTesterUsername(
                username
            )
        ) {

            const token =
                createToken();

            testerSessions.add(
                token
            );

            return res.json({

                ok:
                    true,

                token,

                username:
                    TESTER_USERNAME,

                balance:
                    STARTING_BALANCE,

                isTester:
                    true
            });
        }

        const user =
            users.find(
                item =>
                    item.username
                        .toLowerCase()
                    ===
                    username
                        .toLowerCase()
            );

        if (
            !user
        ) {

            return res
                .status(401)
                .json({

                    ok:
                        false,

                    message:
                        'Username ან პაროლი არასწორია.'
                });
        }

        const passwordHash =
            hashPassword(
                password,
                user.salt
            );

        if (
            passwordHash !==
            user.passwordHash
        ) {

            return res
                .status(401)
                .json({

                    ok:
                        false,

                    message:
                        'Username ან პაროლი არასწორია.'
                });
        }

        const token =
            createToken();

        sessions.set(
            token,
            user.id
        );

        return res.json({

            ok:
                true,

            token,

            username:
                user.username,

            balance:
                user.balance,

            isTester:
                false
        });
    }
);

/* =========================================================
   HEALTH
========================================================= */

app.get(
    '/health',
    (
        req,
        res
    ) => {

        res.json({

            ok:
                true,

            service:
                'bura-vip-club',

            deck:
                36
        });
    }
);

/* =========================================================
   GAME CONFIG

   36 CARDS:
   6 7 8 9 J Q K 10 A
========================================================= */

const CARD_VALUES = {

    '6':
        0,

    '7':
        0,

    '8':
        0,

    '9':
        0,

    J:
        2,

    Q:
        3,

    K:
        4,

    '10':
        10,

    A:
        11
};

const RANKS_ORDER = [

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

    'hearts',

    'diamonds'
];

const TRUMP_ROTATION = [

    'spades',

    'clubs',

    'hearts',

    'diamonds',

    'no_trump'
];

const rooms =
    {};

/* =========================================================
   DECK
========================================================= */

function createDeck() {

    const deck =
        [];

    for (
        const suit of SUITS
    ) {

        for (
            const rank of
            RANKS_ORDER
        ) {

            deck.push({

                id:
                    crypto
                        .randomUUID(),

                rank,

                suit,

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
            deck.length - 1;

        i >
        0;

        i--
    ) {

        const j =
            Math.floor(
                Math.random() *
                (
                    i + 1
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
   ROOM
========================================================= */

function createRoom(
    roomId,
    maxPlayers,
    targetParties,
    stake
) {

    return {

        id:
            roomId,

        maxPlayers,

        targetParties,

        stake,

        players:
            [],

        gameState:
            null
    };
}

/* =========================================================
   NEW HAND
========================================================= */

function startNewHand(
    room,
    previousGame = null
) {

    const deck =
        createDeck();

    const playersCards =
        {};

    const takenCards =
        {};

    const totalScores =
        {};

    for (
        const player of
        room.players
    ) {

        playersCards[
            player.id
        ] =
            deck.splice(
                0,
                5
            );

        takenCards[
            player.id
        ] =
            [];

        totalScores[
            player.id
        ] =
            previousGame
                ?
                (
                    previousGame
                        .totalScores[
                            player.id
                        ] ||
                    0
                )
                :
                0;
    }

    const handIndex =
        previousGame
            ?
            previousGame
                .handIndex +
            1
            :
            1;

    const startLeaderIndex =
        previousGame
        &&
        Number.isInteger(
            previousGame
                .nextRoundLeaderIndex
        )
            ?
            previousGame
                .nextRoundLeaderIndex
            :
            0;

    return {

        deck,

        playersCards,

        takenCards,

        totalScores,

        currentTurnIndex:
            startLeaderIndex,

        table:
            [],

        trump:
            TRUMP_ROTATION[
                (
                    handIndex -
                    1
                )
                %
                TRUMP_ROTATION
                    .length
            ],

        /*
            5 ხელი = 1 პარტია
        */

        partyNum:
            Math.ceil(
                handIndex /
                5
            ),

        handIndex,

        roundHistory:
            previousGame
                ?
                previousGame
                    .roundHistory
                :
                [],

        lastHandScores:
            previousGame
                ?
                (
                    previousGame
                        .lastHandScores ||
                    {}
                )
                :
                {},

        nextRoundLeaderIndex:
            startLeaderIndex,

        leadCardCount:
            null,

        isProcessing:
            false,

        gameOver:
            false
    };
}

/* =========================================================
   CARD COMPARISON
========================================================= */

function cardBeatsCard(
    leadCard,
    challengeCard,
    trump
) {

    const challengeTrump =
        trump !==
        'no_trump'
        &&
        challengeCard.suit ===
        trump;

    const leadTrump =
        trump !==
        'no_trump'
        &&
        leadCard.suit ===
        trump;

    /*
        კოზირი სცემს უკოზიროს
    */

    if (
        challengeTrump &&
        !leadTrump
    ) {

        return true;
    }

    if (
        !challengeTrump &&
        leadTrump
    ) {

        return false;
    }

    /*
        თუ ერთი ცვეტი არაა,
        ვერ სცემს
    */

    if (
        challengeCard.suit !==
        leadCard.suit
    ) {

        return false;
    }

    /*
        6 < 7 < ... < A
    */

    return (
        RANKS_ORDER.indexOf(
            challengeCard.rank
        )
        >
        RANKS_ORDER.indexOf(
            leadCard.rank
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

function beatsPlay(
    leadPlay,
    challengePlay,
    trump
) {

    const leadCards =
        leadPlay.cards;

    const challengeCards =
        challengePlay.cards;

    /*
        მალიუტკა
    */

    if (
        isMaliutka(
            challengeCards
        )
        &&
        leadCards.length <
        5
    ) {

        return true;
    }

    if (
        leadCards.length !==
        challengeCards.length
    ) {

        return false;
    }

    const leadSorted =
        [
            ...leadCards
        ].sort(
            (
                a,
                b
            ) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    const challengeSorted =
        [
            ...challengeCards
        ].sort(
            (
                a,
                b
            ) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    for (
        let i =
            0;

        i <
        leadSorted.length;

        i++
    ) {

        if (
            !cardBeatsCard(
                leadSorted[i],
                challengeSorted[i],
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

function getWinningPlayIndex(
    table,
    trump
) {

    if (
        !table.length
    ) {

        return -1;
    }

    let winner =
        0;

    for (
        let i =
            1;

        i <
        table.length;

        i++
    ) {

        if (
            beatsPlay(
                table[
                    winner
                ],
                table[i],
                trump
            )
        ) {

            winner =
                i;
        }
    }

    return winner;
}

/* =========================================================
   CLIENT GAME STATE
========================================================= */

function getClientGameState(
    room,
    forPlayerId
) {

    const gs =
        room.gameState;

    if (
        !gs
    ) {

        return null;
    }

    const currentWinningIndex =
        getWinningPlayIndex(
            gs.table,
            gs.trump
        );

    const players =
        room.players.map(
            (
                player,
                index
            ) => {

                const taken =
                    gs.takenCards[
                        player.id
                    ] ||
                    [];

                return {

                    id:
                        player.id,

                    name:
                        player.name,

                    balance:
                        player.balance,

                    isBot:
                        !!player.isBot,

                    isTester:
                        !!player.isTester,

                    cardCount:
                        (
                            gs.playersCards[
                                player.id
                            ] ||
                            []
                        ).length,

                    takenCount:
                        taken.length,

                    handPoints:
                        taken.reduce(
                            (
                                sum,
                                card
                            ) =>
                                sum +
                                card.value,
                            0
                        ),

                    totalPoints:
                        gs.totalScores[
                            player.id
                        ] ||
                        0,

                    isCurrent:
                        index ===
                        gs.currentTurnIndex
                };
            }
        );

    const visibleCards =
        {};

    /*
        მოთამაშე ხედავს
        მხოლოდ საკუთარ კარტებს
    */

    if (
        forPlayerId
        &&
        gs.playersCards[
            forPlayerId
        ]
    ) {

        visibleCards[
            forPlayerId
        ] =
            gs.playersCards[
                forPlayerId
            ];
    }

    return {

        table:
            gs.table.map(
                (
                    play,
                    index
                ) => ({

                    ...play,

                    isWinning:
                        index ===
                        currentWinningIndex
                })
            ),

        trump:
            gs.trump,

        partyNum:
            gs.partyNum,

        targetParties:
            room.targetParties,

        handIndex:
            gs.handIndex,

        totalHands:
            room.targetParties *
            5,

        stake:
            room.stake,

        players,

        playersCards:
            visibleCards,

        viewingPlayerId:
            forPlayerId,

        currentTurnIndex:
            gs.currentTurnIndex,

        isProcessing:
            gs.isProcessing,

        deckCount:
            gs.deck.length,

        roundHistory:
            gs.roundHistory,

        lastHandScores:
            gs.lastHandScores ||
            {},

        gameOver:
            gs.gameOver
    };
}

/* =========================================================
   BROADCAST
========================================================= */

function broadcastGameState(
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
            getClientGameState(
                room,
                player.id
            )
        );
    }
}

/* =========================================================
   REFILL CARDS
========================================================= */

function refillHands(
    room,
    winnerIndex
) {

    const gs =
        room.gameState;

    while (
        gs.deck.length >
        0
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
                    room.players
                        .length
                ];

            const hand =
                gs.playersCards[
                    player.id
                ];

            if (
                hand.length <
                5
                &&
                gs.deck.length >
                0
            ) {

                hand.push(
                    gs.deck.pop()
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
   FINISH HAND / SCORE
========================================================= */

function finishHand(
    room
) {

    const gs =
        room.gameState;

    const handScores =
        {};

    let minRaw =
        Infinity;

    let minPlayerIndex =
        0;

    /*
        ქულა საერთო რეიტინგში
        ემატება მხოლოდ სრული ხელის
        დასრულების შემდეგ.
    */

    room.players.forEach(
        (
            player,
            index
        ) => {

            const rawPoints =
                (
                    gs.takenCards[
                        player.id
                    ] ||
                    []
                ).reduce(
                    (
                        sum,
                        card
                    ) =>
                        sum +
                        card.value,
                    0
                );

            /*
                0 ქულა = -120
            */

            const finalPoints =
                rawPoints ===
                0
                    ?
                    -120
                    :
                    rawPoints;

            handScores[
                player.id
            ] =
                finalPoints;

            gs.totalScores[
                player.id
            ] =
                (
                    gs.totalScores[
                        player.id
                    ] ||
                    0
                )
                +
                finalPoints;

            if (
                rawPoints <
                minRaw
            ) {

                minRaw =
                    rawPoints;

                minPlayerIndex =
                    index;
            }
        }
    );

    gs.lastHandScores =
        {
            ...handScores
        };

    gs.roundHistory.push({

        handIndex:
            gs.handIndex,

        trump:
            gs.trump,

        scores:
            {
                ...handScores
            },

        totals:
            {
                ...gs.totalScores
            }
    });

    /*
        Game finished?
    */

    if (
        gs.handIndex >=
        room.targetParties *
        5
    ) {

        gs.gameOver =
            true;

        broadcastGameState(
            room
        );

        return;
    }

    /*
        შემდეგი ხელის ლიდერი
    */

    gs.nextRoundLeaderIndex =
        (
            minPlayerIndex +
            1
        )
        %
        room.players.length;

    room.gameState =
        startNewHand(
            room,
            gs
        );

    room.gameState
        .lastHandScores =
        {
            ...handScores
        };

    broadcastGameState(
        room
    );

    scheduleBotTurn(
        room
    );
}

/* =========================================================
   COMPLETE TRICK
========================================================= */

function completeTrick(
    room
) {

    const gs =
        room.gameState;

    const winningIndex =
        getWinningPlayIndex(
            gs.table,
            gs.trump
        );

    const winningPlay =
        gs.table[
            winningIndex
        ];

    if (
        !winningPlay
    ) {

        return;
    }

    const allCards =
        gs.table.flatMap(
            play =>
                play.cards
        );

    gs.takenCards[
        winningPlay.playerId
    ].push(
        ...allCards
    );

    const winnerIndex =
        room.players
            .findIndex(
                player =>
                    player.id ===
                    winningPlay.playerId
            );

    gs.currentTurnIndex =
        winnerIndex;

    gs.isProcessing =
        true;

    broadcastGameState(
        room
    );

    setTimeout(
        () => {

            /*
                თუ ოთახი უკვე წაიშალა
            */

            if (
                !rooms[
                    room.id
                ]
                ||
                room.gameState !==
                gs
            ) {

                return;
            }

            gs.table =
                [];

            gs.leadCardCount =
                null;

            refillHands(
                room,
                winnerIndex
            );

            gs.isProcessing =
                false;

            const allHandsEmpty =
                room.players
                    .every(
                        player =>
                            (
                                gs.playersCards[
                                    player.id
                                ] ||
                                []
                            ).length ===
                            0
                    );

            if (
                allHandsEmpty
            ) {

                finishHand(
                    room
                );

            } else {

                broadcastGameState(
                    room
                );

                scheduleBotTurn(
                    room
                );
            }

        },
        1250
    );
}

/* =========================================================
   BOT
========================================================= */

function chooseBotIndices(
    room,
    bot
) {

    const gs =
        room.gameState;

    const cards =
        gs.playersCards[
            bot.id
        ] ||
        [];

    if (
        !cards.length
    ) {

        return [];
    }

    /*
        თუ ბოტი პირველი ჩამოდის,
        ერთ შემთხვევით კარტს ჩამოვა.
    */

    if (
        gs.table.length ===
        0
    ) {

        return [
            Math.floor(
                Math.random() *
                cards.length
            )
        ];
    }

    const required =
        Math.min(
            gs.leadCardCount ||
            1,
            cards.length
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

function scheduleBotTurn(
    room
) {

    if (
        !room
        ||
        !room.gameState
    ) {

        return;
    }

    const gs =
        room.gameState;

    if (
        gs.gameOver
        ||
        gs.isProcessing
    ) {

        return;
    }

    const activePlayer =
        room.players[
            gs.currentTurnIndex
        ];

    if (
        !activePlayer
        ||
        !activePlayer.isBot
    ) {

        return;
    }

    setTimeout(
        () => {

            playBotTurn(
                room,
                activePlayer
            );

        },
        650
    );
}

function playBotTurn(
    room,
    bot
) {

    if (
        !rooms[
            room.id
        ]
        ||
        !room.gameState
    ) {

        return;
    }

    const gs =
        room.gameState;

    if (
        gs.gameOver
        ||
        gs.isProcessing
    ) {

        return;
    }

    const activePlayer =
        room.players[
            gs.currentTurnIndex
        ];

    if (
        !activePlayer
        ||
        activePlayer.id !==
        bot.id
        ||
        !activePlayer.isBot
    ) {

        return;
    }

    const hand =
        gs.playersCards[
            bot.id
        ] ||
        [];

    const indices =
        chooseBotIndices(
            room,
            bot
        );

    const cards =
        indices
            .map(
                index =>
                    hand[index]
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
        gs.table.length ===
        0
    ) {

        gs.leadCardCount =
            cards.length;
    }

    gs.playersCards[
        bot.id
    ] =
        hand.filter(
            (
                _,
                index
            ) =>
                !indices.includes(
                    index
                )
        );

    gs.table.push({

        playerId:
            bot.id,

        playerName:
            bot.name,

        cards
    });

    if (
        gs.table.length <
        room.players.length
    ) {

        gs.currentTurnIndex =
            (
                gs.currentTurnIndex +
                1
            )
            %
            room.players.length;

        broadcastGameState(
            room
        );

        scheduleBotTurn(
            room
        );

    } else {

        completeTrick(
            room
        );
    }
}

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    'connection',
    socket => {

        console.log(
            'connected:',
            socket.id
        );

        /* =================================================
           JOIN TABLE
        ================================================= */

        socket.on(
            'joinTable',
            (
                data = {}
            ) => {

                const user =
                    getUserByToken(
                        data.token
                    );

                if (
                    !user
                ) {

                    socket.emit(
                        'errorMessage',
                        'სესია აღარ არის აქტიური. თავიდან შედი ანგარიშზე.'
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

                /*
                    მხოლოდ 3 ან 4
                */

                let capacity =
                    Number.parseInt(
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
                    1-4 პარტია
                */

                let parties =
                    Number.parseInt(
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
                            4,
                            parties
                        )
                    );

                /*
                    allowed stakes
                */

                let stake =
                    Number.parseFloat(
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

                /*
                    Tester-ს თანხა
                    არ აკლდება
                */

                if (
                    !user.isTester
                    &&
                    user.balance <
                    stake
                ) {

                    socket.emit(
                        'errorMessage',
                        'არ გაქვს საკმარისი ბალანსი.'
                    );

                    return;
                }

                /*
                    მოძებნე შესაბამისი
                    waiting room
                */

                let room =
                    Object.values(
                        rooms
                    ).find(
                        item =>
                            !item.gameState
                            &&
                            item.maxPlayers ===
                            capacity
                            &&
                            item.targetParties ===
                            parties
                            &&
                            item.stake ===
                            stake
                            &&
                            item.players.length <
                            item.maxPlayers
                    );

                /*
                    თუ არაა,
                    შექმენი ახალი.
                */

                if (
                    !room
                ) {

                    const roomId =
                        'room_' +
                        Date.now() +
                        '_' +
                        Math.floor(
                            Math.random() *
                            100000
                        );

                    room =
                        createRoom(
                            roomId,
                            capacity,
                            parties,
                            stake
                        );

                    rooms[
                        roomId
                    ] =
                        room;
                }

                if (
                    !user.isTester
                    &&
                    room.players.some(
                        player =>
                            player.userId ===
                            user.id
                    )
                ) {

                    socket.emit(
                        'errorMessage',
                        'ეს მომხმარებელი უკვე ამ მაგიდაზეა.'
                    );

                    return;
                }

                let playerBalance =
                    user.isTester
                        ?
                        STARTING_BALANCE
                        :
                        user.balance;

                if (
                    !user.isTester
                ) {

                    const realUser =
                        users.find(
                            item =>
                                item.id ===
                                user.id
                        );

                    if (
                        !realUser
                    ) {

                        socket.emit(
                            'errorMessage',
                            'მომხმარებელი ვერ მოიძებნა.'
                        );

                        return;
                    }

                    realUser.balance -=
                        stake;

                    playerBalance =
                        realUser.balance;

                    saveUsers();
                }

                socket.roomId =
                    room.id;

                socket.userId =
                    user.id;

                socket.isTester =
                    !!user.isTester;

                socket.join(
                    room.id
                );

                room.players.push({

                    id:
                        socket.id,

                    userId:
                        user.id,

                    name:
                        user.username,

                    balance:
                        playerBalance,

                    isBot:
                        false,

                    isTester:
                        !!user.isTester
                });

                /*
                    =================================================
                    TEST MODE
                    saba123-ის შესვლისთანავე
                    ცარიელი ადგილები ივსება
                    BOT-ებით.
                    =================================================
                */

                if (
                    user.isTester
                ) {

                    let botNumber =
                        1;

                    while (
                        room.players.length <
                        room.maxPlayers
                    ) {

                        const botId =
                            'bot_' +
                            Date.now() +
                            '_' +
                            botNumber +
                            '_' +
                            Math.floor(
                                Math.random() *
                                10000
                            );

                        room.players.push({

                            id:
                                botId,

                            userId:
                                botId,

                            name:
                                'BOT ' +
                                botNumber,

                            balance:
                                STARTING_BALANCE,

                            isBot:
                                true,

                            isTester:
                                false
                        });

                        botNumber++;
                    }
                }

                /*
                    START GAME
                */

                if (
                    room.players.length ===
                    room.maxPlayers
                ) {

                    room.gameState =
                        startNewHand(
                            room
                        );

                    /*
                        პირადი state,
                        ამიტომ საკუთარი კარტები
                        გამოჩნდება.
                    */

                    broadcastGameState(
                        room
                    );

                    scheduleBotTurn(
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
                                room.maxPlayers,

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
            (
                data = {}
            ) => {

                const room =
                    socket.roomId
                        ?
                        rooms[
                            socket.roomId
                        ]
                        :
                        null;

                if (
                    !room
                    ||
                    !room.gameState
                ) {

                    return;
                }

                const gs =
                    room.gameState;

                if (
                    gs.isProcessing
                    ||
                    gs.gameOver
                ) {

                    return;
                }

                const activePlayer =
                    room.players[
                        gs.currentTurnIndex
                    ];

                if (
                    !activePlayer
                    ||
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
                    gs.playersCards[
                        socket.id
                    ] ||
                    [];

                let indices =
                    Array.isArray(
                        data.cardIndices
                    )
                        ?
                        data.cardIndices
                        :
                        [];

                /*
                    remove duplicates
                */

                indices =
                    [
                        ...new Set(
                            indices
                        )
                    ].filter(
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
                    !indices.length
                ) {

                    socket.emit(
                        'errorMessage',
                        'აირჩიე მინიმუმ ერთი კარტი.'
                    );

                    return;
                }

                const cards =
                    indices.map(
                        index =>
                            hand[
                                index
                            ]
                    );

                /*
                    თუ პირველი ჩამოდის,
                    ყველა კარტი ერთი ცვეტის
                    უნდა იყოს.
                */

                if (
                    gs.table.length ===
                    0
                ) {

                    const sameSuit =
                        cards.every(
                            card =>
                                card.suit ===
                                cards[0].suit
                        );

                    if (
                        !sameSuit
                    ) {

                        socket.emit(
                            'errorMessage',
                            'პირველი ჩამოსვლა ერთი ცვეტის კარტებით უნდა იყოს.'
                        );

                        return;
                    }

                    gs.leadCardCount =
                        cards.length;

                } else {

                    const required =
                        Math.min(
                            gs.leadCardCount ||
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

                        socket.emit(
                            'errorMessage',
                            'უნდა ჩამოხვიდე ' +
                            required +
                            ' კარტი ან მალიუტკა.'
                        );

                        return;
                    }
                }

                /*
                    Remove cards
                */

                gs.playersCards[
                    socket.id
                ] =
                    hand.filter(
                        (
                            _,
                            index
                        ) =>
                            !indices.includes(
                                index
                            )
                    );

                gs.table.push({

                    playerId:
                        socket.id,

                    playerName:
                        activePlayer.name,

                    cards
                });

                /*
                    NEXT PLAYER
                */

                if (
                    gs.table.length <
                    room.players.length
                ) {

                    gs.currentTurnIndex =
                        (
                            gs.currentTurnIndex +
                            1
                        )
                        %
                        room.players.length;

                    broadcastGameState(
                        room
                    );

                    scheduleBotTurn(
                        room
                    );

                } else {

                    completeTrick(
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
                        rooms[
                            socket.roomId
                        ]
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

                io.to(
                    room.id
                ).emit(
                    'playerLeft',
                    {

                        name:
                            socket.userId ||
                            'player'
                    }
                );

                const humansLeft =
                    room.players.filter(
                        player =>
                            !player.isBot
                    ).length;

                if (
                    humansLeft ===
                    0
                ) {

                    delete rooms[
                        room.id
                    ];
                }
            }
        );
    }
);

/* =========================================================
   FRONTEND HTML
========================================================= */

const PAGE =
String.raw`
<!DOCTYPE html>

<html lang="ka">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
>

<title>
    BURA VIP CLUB
</title>

<script src="/socket.io/socket.io.js"></script>

<style>

* {
    box-sizing:
        border-box;
}

:root {

    --gold:
        #f6c94a;

    --gold2:
        #ff9800;

    --muted:
        #8e98a8;

    --line:
        rgba(255,255,255,.08);
}

html,
body {

    margin:
        0;

    min-height:
        100%;

    font-family:
        Inter,
        Segoe UI,
        Arial,
        sans-serif;

    background:
        #06080c;

    color:
        white;
}

body {

    min-height:
        100vh;

    background:

        radial-gradient(
            circle at 50% 0,
            rgba(246,201,74,.12),
            transparent 27%
        ),

        radial-gradient(
            circle at 5% 90%,
            rgba(16,118,69,.14),
            transparent 35%
        ),

        #06080c;
}

button,
input,
select {

    font:
        inherit;
}

button {

    cursor:
        pointer;
}

.hidden {

    display:
        none !important;
}

/* =========================================================
   NAVBAR
========================================================= */

.navbar {

    height:
        72px;

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    padding:
        0 26px;

    position:
        sticky;

    top:
        0;

    z-index:
        50;

    background:
        rgba(6,8,12,.93);

    backdrop-filter:
        blur(18px);

    border-bottom:
        1px solid
        var(--line);
}

.logo {

    font-size:
        21px;

    font-weight:
        950;

    letter-spacing:
        .7px;

    color:
        var(--gold);
}

.logo span {

    color:
        white;
}

.nav-user {

    display:
        flex;

    align-items:
        center;

    gap:
        10px;

    text-align:
        right;
}

.nav-name {

    font-size:
        12px;

    font-weight:
        900;
}

.nav-balance {

    font-size:
        10px;

    color:
        var(--muted);

    margin-top:
        2px;
}

.avatar {

    width:
        38px;

    height:
        38px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    color:
        var(--gold);

    font-weight:
        950;

    background:
        linear-gradient(
            145deg,
            #3c4552,
            #171c23
        );

    border:
        1px solid
        rgba(246,201,74,.32);
}

/* =========================================================
   LOBBY
========================================================= */

.lobby-container {

    width:
        min(1180px,100%);

    margin:
        auto;

    padding:
        38px 20px 70px;
}

.hero {

    text-align:
        center;

    margin-bottom:
        30px;
}

.hero-tag {

    display:
        inline-flex;

    align-items:
        center;

    gap:
        7px;

    padding:
        7px 12px;

    border-radius:
        30px;

    color:
        var(--gold);

    font-size:
        10px;

    font-weight:
        900;

    letter-spacing:
        1.3px;

    border:
        1px solid
        rgba(246,201,74,.18);

    background:
        rgba(246,201,74,.05);

    margin-bottom:
        12px;
}

.hero h1 {

    margin:
        0;

    font-size:
        clamp(
            31px,
            6vw,
            52px
        );

    font-weight:
        950;

    background:
        linear-gradient(
            135deg,
            #fff8c9,
            #f6c94a,
            #ff9700
        );

    -webkit-background-clip:
        text;

    color:
        transparent;
}

.hero p {

    max-width:
        560px;

    margin:
        10px auto 0;

    color:
        var(--muted);

    font-size:
        13px;

    line-height:
        1.6;
}

.main-grid {

    display:
        grid;

    grid-template-columns:
        .9fr 1.1fr;

    gap:
        22px;
}

.panel {

    border:
        1px solid
        var(--line);

    border-radius:
        20px;

    padding:
        24px;

    background:

        radial-gradient(
            circle at 50% 0,
            rgba(255,255,255,.025),
            transparent 38%
        ),

        linear-gradient(
            145deg,
            #141922,
            #0b0e13
        );

    box-shadow:
        0 30px 80px
        rgba(0,0,0,.28);
}

/* =========================================================
   AUTH
========================================================= */

.auth-header {

    display:
        flex;

    align-items:
        center;

    gap:
        12px;

    margin-bottom:
        16px;
}

.auth-crown {

    width:
        48px;

    height:
        48px;

    border-radius:
        14px;

    display:
        grid;

    place-items:
        center;

    color:
        #171005;

    font-size:
        24px;

    background:
        linear-gradient(
            145deg,
            #ffe76a,
            #ff9c00
        );

    box-shadow:
        0 10px 30px
        rgba(255,156,0,.18);
}

.auth-header h2 {

    margin:
        0;

    font-size:
        18px;
}

.auth-header p {

    margin:
        3px 0 0;

    color:
        var(--muted);

    font-size:
        10px;
}

.bonus-banner {

    display:
        flex;

    align-items:
        center;

    gap:
        11px;

    padding:
        12px;

    border-radius:
        12px;

    margin-bottom:
        16px;

    border:
        1px solid
        rgba(246,201,74,.14);

    background:
        linear-gradient(
            135deg,
            rgba(246,201,74,.09),
            rgba(246,201,74,.025)
        );
}

.bonus-icon {

    width:
        37px;

    height:
        37px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    color:
        var(--gold);

    background:
        rgba(246,201,74,.1);

    border:
        1px solid
        rgba(246,201,74,.17);
}

.bonus-banner strong {

    display:
        block;

    font-size:
        11px;
}

.bonus-banner span {

    display:
        block;

    margin-top:
        2px;

    color:
        var(--muted);

    font-size:
        9px;
}

.auth-tabs {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    padding:
        4px;

    border-radius:
        11px;

    background:
        #080b0f;

    border:
        1px solid
        rgba(255,255,255,.05);

    margin-bottom:
        17px;
}

.auth-tab {

    height:
        39px;

    border:
        0;

    border-radius:
        8px;

    background:
        transparent;

    color:
        #818b9b;

    font-size:
        11px;

    font-weight:
        900;
}

.auth-tab.active {

    color:
        #151005;

    background:
        linear-gradient(
            135deg,
            #ffe35d,
            #ff9a00
        );
}

/* =========================================================
   FIELDS
========================================================= */

.field {

    margin:
        13px 0;
}

.field label {

    display:
        block;

    margin-bottom:
        6px;

    color:
        #9ca5b3;

    font-size:
        9px;

    font-weight:
        900;

    letter-spacing:
        .6px;

    text-transform:
        uppercase;
}

.field input,
.field select {

    width:
        100%;

    height:
        45px;

    padding:
        0 13px;

    color:
        white;

    border:
        1px solid
        #2b323e;

    border-radius:
        10px;

    background:
        #080b10;

    outline:
        none;
}

.field input:focus,
.field select:focus {

    border-color:
        rgba(246,201,74,.65);

    box-shadow:
        0 0 0 3px
        rgba(246,201,74,.07);
}

.tester-hint {

    margin:
        10px 0 13px;

    padding:
        10px 11px;

    border-radius:
        10px;

    border:
        1px solid
        rgba(165,98,216,.18);

    background:
        rgba(144,76,194,.06);

    color:
        #a991bb;

    font-size:
        9px;

    line-height:
        1.5;
}

.tester-hint b {

    color:
        #dfc5f2;
}

.gold-btn {

    width:
        100%;

    height:
        47px;

    border:
        0;

    border-radius:
        11px;

    color:
        #171005;

    font-weight:
        950;

    font-size:
        12px;

    background:
        linear-gradient(
            135deg,
            #ffe35d,
            #ff9700
        );

    box-shadow:
        0 13px 30px
        rgba(255,151,0,.15);

    transition:
        .16s;
}

.gold-btn:hover {

    transform:
        translateY(-2px);

    box-shadow:
        0 17px 35px
        rgba(255,151,0,.24);
}

.message {

    min-height:
        21px;

    margin-top:
        10px;

    text-align:
        center;

    color:
        var(--gold);

    font-size:
        10px;

    font-weight:
        800;
}

.message.error {

    color:
        #ff6674;
}

.logged-card {

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    padding:
        12px;

    margin-bottom:
        15px;

    border-radius:
        11px;

    background:
        #080b10;

    border:
        1px solid
        var(--line);

    font-size:
        10px;
}

.logged-card strong {

    color:
        var(--gold);
}

.logout-btn {

    border:
        0;

    background:
        transparent;

    color:
        #ff6767;

    font-size:
        9px;

    font-weight:
        900;
}

.panel-title {

    font-size:
        17px;

    font-weight:
        900;

    margin:
        0;
}

.panel-sub {

    color:
        var(--muted);

    font-size:
        11px;

    margin:
        5px 0 18px;
}

/* =========================================================
   TABLE SELECT
========================================================= */

.capacity-grid,
.stake-grid {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        9px;

    margin-top:
        8px;
}

.capacity-card {

    height:
        65px;

    border:
        1px solid
        var(--line);

    border-radius:
        11px;

    color:
        #9ca5b3;

    background:
        #090c11;

    font-size:
        11px;

    font-weight:
        900;

    transition:
        .15s;
}

.capacity-card.active {

    color:
        var(--gold);

    border-color:
        rgba(246,201,74,.65);

    background:
        rgba(246,201,74,.06);
}

.stake-card {

    min-height:
        86px;

    border:
        1px solid
        var(--line);

    border-radius:
        13px;

    color:
        white;

    background:
        linear-gradient(
            145deg,
            #151a22,
            #090c10
        );

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;

    justify-content:
        center;

    gap:
        2px;

    transition:
        .16s;
}

.stake-card:hover {

    transform:
        translateY(-2px);

    border-color:
        rgba(246,201,74,.34);
}

.stake-card.active {

    border-color:
        var(--gold);

    background:
        linear-gradient(
            145deg,
            rgba(246,201,74,.14),
            #090c10
        );
}

.stake-symbol {

    font-size:
        17px;
}

.stake-card strong {

    color:
        var(--gold);

    font-size:
        20px;
}

.stake-card small {

    color:
        #727c8b;

    font-size:
        8px;

    font-weight:
        800;

    letter-spacing:
        .6px;
}

/* =========================================================
   GAME
========================================================= */

#game {

    display:
        none;

    min-height:
        100vh;

    padding:
        18px;

    background:

        radial-gradient(
            circle at 50% 45%,
            rgba(24,126,70,.14),
            transparent 42%
        ),

        #06080c;
}

.game-top {

    width:
        min(1150px,100%);

    margin:
        auto;

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

    padding:
        12px 14px;

    border-radius:
        15px;

    background:
        linear-gradient(
            145deg,
            #121722,
            #090c11
        );

    border:
        1px solid
        rgba(255,255,255,.08);

    box-shadow:
        0 15px 45px
        rgba(0,0,0,.25);
}

.game-brand {

    color:
        var(--gold);

    font-weight:
        950;

    font-size:
        14px;

    letter-spacing:
        .5px;
}

/* =========================================================
   GAME TOP STATS
========================================================= */

.game-info {

    display:
        flex;

    align-items:
        stretch;

    flex-wrap:
        wrap;

    gap:
        8px;
}

.game-stat {

    min-width:
        108px;

    display:
        flex;

    align-items:
        center;

    gap:
        9px;

    padding:
        8px 11px;

    border-radius:
        11px;

    border:
        1px solid
        rgba(255,255,255,.09);
}

.stat-icon {

    width:
        30px;

    height:
        30px;

    display:
        grid;

    place-items:
        center;

    border-radius:
        9px;

    font-size:
        15px;

    font-weight:
        950;

    background:
        rgba(255,255,255,.08);
}

.game-stat span {

    display:
        block;

    color:
        rgba(255,255,255,.58);

    font-size:
        7px;

    font-weight:
        900;

    letter-spacing:
        .7px;

    text-transform:
        uppercase;
}

.game-stat strong {

    display:
        block;

    margin-top:
        2px;

    color:
        white;

    font-size:
        13px;

    font-weight:
        950;
}

.trump-stat {

    background:
        linear-gradient(
            135deg,
            #11243c,
            #0a111c
        );

    border-color:
        rgba(62,139,230,.32);
}

.trump-stat
.stat-icon {

    color:
        #73b7ff;

    background:
        rgba(62,139,230,.13);
}

.party-stat {

    background:
        linear-gradient(
            135deg,
            #34270b,
            #151105
        );

    border-color:
        rgba(246,201,74,.3);
}

.party-stat
.stat-icon {

    color:
        #f6c94a;
}

.hand-stat {

    background:
        linear-gradient(
            135deg,
            #2d1639,
            #130b19
        );

    border-color:
        rgba(179,88,220,.28);
}

.hand-stat
.stat-icon {

    color:
        #d28df1;
}

.deck-stat {

    background:
        linear-gradient(
            135deg,
            #0c3025,
            #071611
        );

    border-color:
        rgba(40,180,125,.28);
}

.deck-stat
.stat-icon {

    color:
        #52d6a0;
}

.stake-stat {

    background:
        linear-gradient(
            135deg,
            #3a1717,
            #180b0b
        );

    border-color:
        rgba(220,75,75,.3);
}

.stake-stat
.stat-icon {

    color:
        #ff7777;
}

#status {

    min-height:
        30px;

    margin:
        10px;

    text-align:
        center;

    color:
        var(--gold);

    font-size:
        13px;

    font-weight:
        950;
}

/* =========================================================
   GAME TABLE
========================================================= */

.table-board {

    width:
        min(1080px,96vw);

    height:
        560px;

    margin:
        auto;

    position:
        relative;

    overflow:
        hidden;

    border-radius:
        50% / 38%;

    border:
        17px solid
        #2c1c10;

    background:
        radial-gradient(
            ellipse at center,
            #16844b,
            #0a6037 58%,
            #06331e
        );

    box-shadow:

        0 28px 85px
        rgba(0,0,0,.72),

        inset 0 0 80px
        rgba(0,0,0,.35);
}

.table-board:before {

    content:
        "";

    position:
        absolute;

    inset:
        13px;

    border:
        1px solid
        rgba(255,255,255,.1);

    border-radius:
        50% / 38%;

    pointer-events:
        none;
}

.table-logo {

    position:
        absolute;

    left:
        50%;

    top:
        50%;

    transform:
        translate(-50%,-50%);

    color:
        rgba(255,255,255,.055);

    font-size:
        30px;

    font-weight:
        950;

    letter-spacing:
        5px;
}

#players {

    position:
        absolute;

    inset:
        0;
}

.seat {

    position:
        absolute;

    width:
        140px;

    transform:
        translate(-50%,-50%);

    text-align:
        center;

    z-index:
        5;
}

.seat-box {

    padding:
        7px;

    border-radius:
        11px;

    background:
        rgba(5,8,11,.88);

    border:
        1px solid
        rgba(255,255,255,.11);

    box-shadow:
        0 8px 25px
        rgba(0,0,0,.38);
}

.seat.current
.seat-box {

    border-color:
        var(--gold);

    box-shadow:
        0 0 22px
        rgba(246,201,74,.3);
}

.seat-avatar {

    width:
        29px;

    height:
        29px;

    margin:
        auto;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        #2f3843;

    color:
        var(--gold);

    font-size:
        10px;

    font-weight:
        900;
}

.seat-name {

    margin-top:
        3px;

    font-size:
        10px;

    font-weight:
        900;
}

.seat-info {

    margin-top:
        2px;

    color:
        #7f8998;

    font-size:
        8px;
}

.card-backs {

    display:
        flex;

    justify-content:
        center;

    margin-top:
        4px;
}

.card-back {

    width:
        18px;

    height:
        26px;

    border:
        1px solid
        #d0ad48;

    border-radius:
        3px;

    margin-left:
        -6px;

    background:
        repeating-linear-gradient(
            45deg,
            #27313a 0 3px,
            #121920 3px 6px
        );
}

.card-back:first-child {

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
        50%;

    transform:
        translate(-50%,-50%);

    display:
        flex;

    align-items:
        center;

    justify-content:
        center;

    gap:
        13px;

    max-width:
        62%;

    z-index:
        4;
}

.play-group {

    display:
        flex;

    flex-direction:
        column;

    align-items:
        center;

    animation:
        groupAppear
        .28s
        cubic-bezier(
            .2,
            .8,
            .2,
            1
        );
}

.play-name {

    margin-bottom:
        5px;

    padding:
        3px 7px;

    border-radius:
        20px;

    color:
        white;

    background:
        rgba(0,0,0,.32);

    font-size:
        8px;

    font-weight:
        900;
}

/* =========================================================
   CARD COLORS

   ♠ YVAVI = BLACK
   ♣ JVARI = EMERALD
   ♦ AGURI = NAVY BLUE
   ♥ GULI = DARK BURGUNDY
========================================================= */

.card {

    width:
        62px;

    height:
        90px;

    padding:
        6px;

    border-radius:
        8px;

    border:
        1px solid
        #d9d9d4;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        space-between;

    font-weight:
        950;

    box-shadow:
        0 7px 18px
        rgba(0,0,0,.45);

    user-select:
        none;
}

/* ♠ */

.card.suit-spades {

    color:
        #080a0d;

    border-color:
        #34383f;

    background:
        linear-gradient(
            145deg,
            #ffffff,
            #e7e8ea
        );
}

/* ♣ */

.card.suit-clubs {

    color:
        #006b4f;

    border-color:
        rgba(0,107,79,.45);

    background:
        linear-gradient(
            145deg,
            #fafffd,
            #e2f2ec
        );

    box-shadow:
        0 7px 18px
        rgba(0,75,55,.25);
}

/* ♦ */

.card.suit-diamonds {

    color:
        #071f52;

    border-color:
        rgba(7,31,82,.45);

    background:
        linear-gradient(
            145deg,
            #fafcff,
            #e4ebf5
        );

    box-shadow:
        0 7px 18px
        rgba(7,31,82,.25);
}

/* ♥ */

.card.suit-hearts {

    color:
        #6f1025;

    border-color:
        rgba(111,16,37,.42);

    background:
        linear-gradient(
            145deg,
            #fffafb,
            #f3e1e6
        );

    box-shadow:
        0 7px 18px
        rgba(111,16,37,.23);
}

.card-top,
.card-bottom {

    display:
        flex;

    gap:
        3px;

    align-items:
        center;

    font-size:
        12px;

    font-weight:
        950;
}

.card-center {

    text-align:
        center;

    font-size:
        28px;

    font-weight:
        950;
}

.card-bottom {

    transform:
        rotate(180deg);
}

/* =========================================================
   CARD ANIMATIONS
========================================================= */

@keyframes cardFlyToTable {

    0% {

        opacity:
            0;

        transform:
            translateY(110px)
            scale(.65)
            rotate(-12deg);

        filter:
            blur(3px);
    }

    48% {

        opacity:
            1;

        transform:
            translateY(-14px)
            scale(1.08)
            rotate(3deg);

        filter:
            blur(0);
    }

    72% {

        transform:
            translateY(6px)
            scale(.97)
            rotate(-1deg);
    }

    100% {

        opacity:
            1;

        transform:
            translateY(0)
            scale(1)
            rotate(0);
    }
}

@keyframes groupAppear {

    from {

        opacity:
            0;

        transform:
            scale(.82);
    }

    to {

        opacity:
            1;

        transform:
            scale(1);
    }
}

.play-group
.card {

    animation:
        cardFlyToTable
        .58s
        cubic-bezier(
            .16,
            1,
            .3,
            1
        )
        both;
}

.play-group
.card:nth-child(3) {

    animation-delay:
        .08s;
}

.play-group
.card:nth-child(4) {

    animation-delay:
        .14s;
}

.play-group
.card:nth-child(5) {

    animation-delay:
        .20s;
}

.play-group
.card:nth-child(6) {

    animation-delay:
        .26s;
}

@keyframes winnerGlow {

    from {

        box-shadow:
            0 0 12px
            rgba(246,201,74,.45);
    }

    to {

        box-shadow:
            0 0 30px
            rgba(246,201,74,.95);
    }
}

.play-group.winner
.card {

    border:
        2px solid
        var(--gold);

    animation:
        winnerGlow
        .7s
        ease-in-out
        infinite alternate;
}

/* =========================================================
   MY HAND
========================================================= */

.hand-panel {

    width:
        min(1000px,100%);

    margin:
        16px auto 0;

    text-align:
        center;
}

.hand-title {

    margin-bottom:
        9px;

    color:
        #a5afbe;

    font-size:
        11px;

    font-weight:
        800;
}

#my-cards {

    min-height:
        108px;

    display:
        flex;

    justify-content:
        center;

    align-items:
        flex-end;

    flex-wrap:
        wrap;

    gap:
        10px;
}

#my-cards
.card {

    cursor:
        pointer;

    transition:
        transform .16s,
        box-shadow .16s,
        border .16s;
}

#my-cards
.card:hover {

    transform:
        translateY(-8px)
        scale(1.04);
}

#my-cards
.card.selected {

    transform:
        translateY(-17px)
        scale(1.05);

    border:
        3px solid
        var(--gold);

    box-shadow:
        0 0 24px
        rgba(246,201,74,.65);
}

.play-btn {

    min-width:
        180px;

    height:
        43px;

    margin-top:
        12px;

    padding:
        0 30px;

    border:
        0;

    border-radius:
        11px;

    color:
        #151005;

    font-weight:
        950;

    background:
        linear-gradient(
            135deg,
            #ffe35d,
            #ff9700
        );

    box-shadow:
        0 10px 30px
        rgba(255,151,0,.18);
}

.play-btn:disabled {

    color:
        #68717e;

    background:
        #2b323c;

    box-shadow:
        none;

    cursor:
        not-allowed;
}

/* =========================================================
   LIVE SCORE
========================================================= */

.score-board {

    width:
        min(900px,100%);

    margin:
        18px auto 25px;

    border-radius:
        16px;

    overflow:
        hidden;

    border:
        1px solid
        rgba(246,201,74,.15);

    background:
        linear-gradient(
            145deg,
            #11151d,
            #080b10
        );

    box-shadow:
        0 20px 55px
        rgba(0,0,0,.3);
}

.score-header {

    min-height:
        65px;

    padding:
        13px 16px;

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    gap:
        10px;

    border-bottom:
        1px solid
        var(--line);

    background:
        linear-gradient(
            135deg,
            rgba(246,201,74,.1),
            rgba(246,201,74,.015)
        );
}

.score-header strong {

    display:
        block;

    color:
        var(--gold);

    font-size:
        13px;

    font-weight:
        950;

    letter-spacing:
        .6px;
}

.score-header span {

    display:
        block;

    color:
        #7f8998;

    margin-top:
        3px;

    font-size:
        8px;
}

.score-cup {

    width:
        42px;

    height:
        42px;

    display:
        grid;

    place-items:
        center;

    border-radius:
        11px;

    background:
        rgba(246,201,74,.1);

    border:
        1px solid
        rgba(246,201,74,.17);

    font-size:
        21px;
}

.standing-row {

    display:
        grid;

    grid-template-columns:
        65px
        minmax(120px,1.4fr)
        1fr
        1fr;

    align-items:
        center;

    min-height:
        58px;

    border-bottom:
        1px solid
        rgba(255,255,255,.045);
}

.standing-row.header {

    min-height:
        36px;

    color:
        #687384;

    font-size:
        7px;

    font-weight:
        900;

    letter-spacing:
        .5px;

    text-transform:
        uppercase;
}

.standing-cell {

    padding:
        9px 12px;

    text-align:
        center;
}

.player-standing {

    display:
        flex;

    align-items:
        center;

    gap:
        9px;

    text-align:
        left;
}

.standing-avatar {

    width:
        33px;

    height:
        33px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        #252d38;

    border:
        1px solid
        rgba(255,255,255,.09);

    font-size:
        10px;

    font-weight:
        950;
}

.standing-player-name {

    font-size:
        10px;

    font-weight:
        900;
}

.standing-you {

    display:
        inline-block;

    margin-left:
        5px;

    padding:
        2px 5px;

    border-radius:
        4px;

    color:
        #151005;

    background:
        var(--gold);

    font-size:
        6px;

    font-weight:
        950;
}

.place-medal {

    font-size:
        22px;
}

.place-number {

    color:
        #7f8998;

    font-size:
        11px;

    font-weight:
        900;
}

.last-hand-score {

    color:
        #b0b8c5;

    font-size:
        12px;

    font-weight:
        950;
}

.last-hand-score.positive {

    color:
        #62dba4;
}

.last-hand-score.negative {

    color:
        #ff6d76;
}

.total-score {

    color:
        white;

    font-size:
        18px;

    font-weight:
        950;
}

.standing-row.first {

    background:
        linear-gradient(
            90deg,
            rgba(246,201,74,.1),
            transparent 70%
        );
}

.standing-row.second {

    background:
        linear-gradient(
            90deg,
            rgba(190,200,215,.06),
            transparent 70%
        );
}

.standing-row.third {

    background:
        linear-gradient(
            90deg,
            rgba(190,116,67,.07),
            transparent 70%
        );
}

/* =========================================================
   MOBILE
========================================================= */

@media(
    max-width:800px
) {

    .main-grid {

        grid-template-columns:
            1fr;
    }

    .game-top {

        justify-content:
            center;
    }

    .game-brand {

        width:
            100%;

        text-align:
            center;
    }

    .game-info {

        justify-content:
            center;
    }

    .table-board {

        height:
            490px;

        border-width:
            12px;
    }

    .seat {

        width:
            110px;
    }

    .card {

        width:
            52px;

        height:
            76px;
    }

    .card-center {

        font-size:
            22px;
    }
}

@media(
    max-width:600px
) {

    .standing-row {

        grid-template-columns:
            45px
            minmax(100px,1.4fr)
            .8fr
            .8fr;
    }

    .standing-cell {

        padding:
            8px 5px;
    }

    .standing-avatar {

        display:
            none;
    }

    .total-score {

        font-size:
            14px;
    }
}

@media(
    max-width:520px
) {

    .navbar {

        padding:
            0 13px;
    }

    .logo {

        font-size:
            16px;
    }

    .lobby-container {

        padding:
            25px 11px 50px;
    }

    .panel {

        padding:
            17px;
    }

    #game {

        padding:
            7px;
    }

    .game-stat {

        min-width:
            calc(50% - 5px);
    }

    .table-board {

        height:
            420px;

        border-radius:
            47% / 31%;

        border-width:
            9px;
    }

    .seat {

        width:
            88px;
    }

    .seat-name {

        font-size:
            8px;
    }

    .seat-info {

        font-size:
            7px;
    }

    .card {

        width:
            47px;

        height:
            69px;

        padding:
            4px;
    }

    .card-center {

        font-size:
            19px;
    }

    .card-top,
    .card-bottom {

        font-size:
            9px;
    }

    #table-cards {

        max-width:
            73%;

        gap:
            6px;
    }

    #my-cards {

        gap:
            6px;
    }

    .stake-card {

        min-height:
            77px;
    }
}

</style>

</head>

<body>

<!-- ======================================================
     LOBBY
======================================================= -->

<div id="lobby">

    <div class="navbar">

        <div class="logo">

            BURA

            <span>
                VIP CLUB
            </span>

        </div>

        <div class="nav-user">

            <div>

                <div
                    class="nav-name"
                    id="nav-username"
                >
                    სტუმარი
                </div>

                <div
                    class="nav-balance"
                    id="nav-balance"
                >
                    გაიარე რეგისტრაცია
                </div>

            </div>

            <div
                class="avatar"
                id="nav-avatar"
            >
                G
            </div>

        </div>

    </div>

    <div class="lobby-container">

        <div class="hero">

            <div class="hero-tag">
                ♠ ONLINE CARD ROOM
            </div>

            <h1>
                BURA VIP CLUB
            </h1>

            <p>
                შექმენი ანგარიში, აირჩიე 3 ან 4 კაციანი მაგიდა,
                პარტიები და სასურველი ფსონი.
            </p>

        </div>

        <div class="main-grid">

            <!-- AUTH -->

            <div class="panel">

                <div class="auth-header">

                    <div class="auth-crown">
                        ♛
                    </div>

                    <div>

                        <h2>
                            Player Account
                        </h2>

                        <p>
                            შენი ადგილი BURA VIP CLUB-ში
                        </p>

                    </div>

                </div>

                <div class="bonus-banner">

                    <div class="bonus-icon">
                        ♠
                    </div>

                    <div>

                        <strong>
                            Welcome Balance
                        </strong>

                        <span>
                            ყველა მოთამაშე იწყებს $1,000 სატესტო ბალანსით
                        </span>

                    </div>

                </div>

                <div class="auth-tabs">

                    <button
                        id="login-tab"
                        class="auth-tab active"
                        onclick="showLogin()"
                    >
                        შესვლა
                    </button>

                    <button
                        id="register-tab"
                        class="auth-tab"
                        onclick="showRegister()"
                    >
                        რეგისტრაცია
                    </button>

                </div>

                <div id="login-box">

                    <div class="field">

                        <label>
                            Username
                        </label>

                        <input
                            id="login-username"
                            placeholder="შენი username"
                        >

                    </div>

                    <div class="field">

                        <label>
                            პაროლი
                        </label>

                        <input
                            id="login-password"
                            type="password"
                            placeholder="პაროლი"
                        >

                    </div>

                    <div class="tester-hint">

                        🧪 TEST MODE:

                        ჩაწერე

                        <b>
                            saba123
                        </b>

                        — პაროლი არ გჭირდება.
                        ცარიელი ადგილები ავტომატურად
                        შეივსება ბოტებით.

                    </div>

                    <button
                        class="gold-btn"
                        onclick="loginUser()"
                    >
                        შესვლა
                    </button>

                </div>

                <div
                    id="register-box"
                    class="hidden"
                >

                    <div class="field">

                        <label>
                            Username
                        </label>

                        <input
                            id="reg-username"
                            maxlength="20"
                            placeholder="მაგ: giorgi99"
                        >

                    </div>

                    <div class="field">

                        <label>
                            Email
                        </label>

                        <input
                            id="reg-email"
                            type="email"
                            placeholder="you@email.com"
                        >

                    </div>

                    <div class="field">

                        <label>
                            პაროლი
                        </label>

                        <input
                            id="reg-password"
                            type="password"
                            placeholder="მინიმუმ 6 სიმბოლო"
                        >

                    </div>

                    <button
                        class="gold-btn"
                        onclick="registerUser()"
                    >
                        ანგარიშის შექმნა
                    </button>

                </div>

                <div
                    id="auth-message"
                    class="message"
                ></div>

            </div>

            <!-- TABLE SELECT -->

            <div class="panel">

                <h2 class="panel-title">
                    აირჩიე მაგიდა
                </h2>

                <div class="panel-sub">
                    მხოლოდ 3 და 4 კაციანი მაგიდები · მაქსიმუმ 4 პარტია
                </div>

                <div
                    id="logged-user-card"
                    class="logged-card hidden"
                >

                    <div>

                        მოთამაშე:

                        <strong
                            id="logged-name"
                        ></strong>

                    </div>

                    <button
                        class="logout-btn"
                        onclick="logout()"
                    >
                        გასვლა
                    </button>

                </div>

                <div class="field">

                    <label>
                        მოთამაშეების რაოდენობა
                    </label>

                    <input
                        type="hidden"
                        id="capacity"
                        value="3"
                    >

                    <div class="capacity-grid">

                        <button
                            class="capacity-card active"
                            onclick="selectCapacity(3,this)"
                        >
                            👥 3 მოთამაშე
                        </button>

                        <button
                            class="capacity-card"
                            onclick="selectCapacity(4,this)"
                        >
                            👥 4 მოთამაშე
                        </button>

                    </div>

                </div>

                <div class="field">

                    <label>
                        პარტიების რაოდენობა
                    </label>

                    <select id="parties">

                        <option value="1">
                            1 პარტია · 5 ხელი
                        </option>

                        <option value="2">
                            2 პარტია · 10 ხელი
                        </option>

                        <option value="3">
                            3 პარტია · 15 ხელი
                        </option>

                        <option value="4">
                            4 პარტია · 20 ხელი
                        </option>

                    </select>

                </div>

                <div class="field">

                    <label>
                        ფსონი
                    </label>

                    <input
                        type="hidden"
                        id="stake"
                        value="5"
                    >

                    <div class="stake-grid">

                        <button
                            class="stake-card active"
                            onclick="selectStake(5,this)"
                        >

                            <span class="stake-symbol">
                                ♠
                            </span>

                            <strong>
                                $5
                            </strong>

                            <small>
                                LOW TABLE
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(10,this)"
                        >

                            <span
                                class="stake-symbol"
                                style="color:#00a77b"
                            >
                                ♣
                            </span>

                            <strong>
                                $10
                            </strong>

                            <small>
                                STANDARD
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(25,this)"
                        >

                            <span
                                class="stake-symbol"
                                style="color:#841b33"
                            >
                                ♥
                            </span>

                            <strong>
                                $25
                            </strong>

                            <small>
                                HIGH TABLE
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(50,this)"
                        >

                            <span
                                class="stake-symbol"
                                style="color:#12377a"
                            >
                                ♦
                            </span>

                            <strong>
                                $50
                            </strong>

                            <small>
                                VIP TABLE
                            </small>

                        </button>

                        <button
                            class="stake-card"
                            onclick="selectStake(100,this)"
                            style="grid-column:1/-1"
                        >

                            <span class="stake-symbol">
                                ♛
                            </span>

                            <strong>
                                $100
                            </strong>

                            <small>
                                ELITE TABLE
                            </small>

                        </button>

                    </div>

                </div>

                <button
                    class="gold-btn"
                    onclick="joinTable()"
                >
                    მაგიდაზე დაჯდომა
                </button>

                <div
                    id="waiting-message"
                    class="message"
                ></div>

            </div>

        </div>

    </div>

</div>

<!-- ======================================================
     GAME
======================================================= -->

<div id="game">

    <div class="game-top">

        <div class="game-brand">
            BURA VIP CLUB
        </div>

        <div class="game-info">

            <div
                class="game-stat trump-stat"
                id="trump-stat"
            >

                <div
                    class="stat-icon"
                    id="trump-icon"
                >
                    ♠
                </div>

                <div>

                    <span>
                        კოზირი
                    </span>

                    <strong id="trump">
                        -
                    </strong>

                </div>

            </div>

            <div class="game-stat party-stat">

                <div class="stat-icon">
                    ★
                </div>

                <div>

                    <span>
                        პარტია
                    </span>

                    <strong id="party-num">
                        -
                    </strong>

                </div>

            </div>

            <div class="game-stat hand-stat">

                <div class="stat-icon">
                    #
                </div>

                <div>

                    <span>
                        ხელი
                    </span>

                    <strong id="hand-index">
                        -
                    </strong>

                </div>

            </div>

            <div class="game-stat deck-stat">

                <div class="stat-icon">
                    ▣
                </div>

                <div>

                    <span>
                        დასტაში
                    </span>

                    <strong id="deck-count">
                        -
                    </strong>

                </div>

            </div>

            <div class="game-stat stake-stat">

                <div class="stat-icon">
                    $
                </div>

                <div>

                    <span>
                        ფსონი
                    </span>

                    <strong id="game-stake">
                        -
                    </strong>

                </div>

            </div>

        </div>

    </div>

    <div id="status"></div>

    <div class="table-board">

        <div class="table-logo">
            BURA
        </div>

        <div id="players"></div>

        <div id="table-cards"></div>

    </div>

    <div class="hand-panel">

        <div class="hand-title">
            შენი კარტები
        </div>

        <div id="my-cards"></div>

        <button
            id="play-button"
            class="play-btn"
            disabled
            onclick="playSelectedCards()"
        >
            ჩამოსვლა
        </button>

    </div>

    <div class="score-board">

        <div class="score-header">

            <div>

                <strong>
                    LIVE STANDINGS
                </strong>

                <span>
                    საერთო ქულა განახლდება ყოველი სრული ხელის დასრულების შემდეგ
                </span>

            </div>

            <div class="score-cup">
                🏆
            </div>

        </div>

        <div id="score-content"></div>

    </div>

</div>

<script>

/* =========================================================
   CLIENT
========================================================= */

const socket =
    io();

let token =
    localStorage.getItem(
        'bura_token'
    );

let username =
    localStorage.getItem(
        'bura_username'
    );

let balance =
    localStorage.getItem(
        'bura_balance'
    );

let isTester =
    localStorage.getItem(
        'bura_tester'
    ) ===
    'true';

let currentState =
    null;

let selectedCards =
    [];

updateUserUI();

/* =========================================================
   AUTH UI
========================================================= */

function showLogin() {

    document
        .getElementById(
            'login-box'
        )
        .classList
        .remove(
            'hidden'
        );

    document
        .getElementById(
            'register-box'
        )
        .classList
        .add(
            'hidden'
        );

    document
        .getElementById(
            'login-tab'
        )
        .classList
        .add(
            'active'
        );

    document
        .getElementById(
            'register-tab'
        )
        .classList
        .remove(
            'active'
        );
}

function showRegister() {

    document
        .getElementById(
            'register-box'
        )
        .classList
        .remove(
            'hidden'
        );

    document
        .getElementById(
            'login-box'
        )
        .classList
        .add(
            'hidden'
        );

    document
        .getElementById(
            'register-tab'
        )
        .classList
        .add(
            'active'
        );

    document
        .getElementById(
            'login-tab'
        )
        .classList
        .remove(
            'active'
        );
}

function setAuthMessage(
    text,
    error
) {

    const element =
        document
            .getElementById(
                'auth-message'
            );

    element.textContent =
        text;

    element.className =
        error
            ?
            'message error'
            :
            'message';
}

/* =========================================================
   REGISTER CLIENT
========================================================= */

async function registerUser() {

    const regUsername =
        document
            .getElementById(
                'reg-username'
            )
            .value
            .trim();

    const email =
        document
            .getElementById(
                'reg-email'
            )
            .value
            .trim();

    const password =
        document
            .getElementById(
                'reg-password'
            )
            .value;

    setAuthMessage(
        'ანგარიში იქმნება...',
        false
    );

    try {

        const response =
            await fetch(
                '/api/register',
                {

                    method:
                        'POST',

                    headers: {

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({

                            username:
                                regUsername,

                            email,

                            password
                        })
                }
            );

        const data =
            await response.json();

        if (
            !response.ok
            ||
            !data.ok
        ) {

            setAuthMessage(
                data.message ||
                'რეგისტრაცია ვერ შესრულდა.',
                true
            );

            return;
        }

        saveLogin(
            data
        );

        setAuthMessage(
            '✓ ანგარიში შეიქმნა. საწყისი ბალანსი $1,000',
            false
        );

    } catch (
        err
    ) {

        console.error(
            err
        );

        setAuthMessage(
            'სერვერთან დაკავშირება ვერ მოხერხდა.',
            true
        );
    }
}

/* =========================================================
   LOGIN CLIENT
========================================================= */

async function loginUser() {

    const loginUsername =
        document
            .getElementById(
                'login-username'
            )
            .value
            .trim();

    let password =
        document
            .getElementById(
                'login-password'
            )
            .value;

    if (
        loginUsername
            .toLowerCase()
        ===
        'saba123'
    ) {

        password =
            '';

        setAuthMessage(
            '🧪 TEST MODE იტვირთება...',
            false
        );

    } else {

        setAuthMessage(
            'შესვლა...',
            false
        );
    }

    try {

        const response =
            await fetch(
                '/api/login',
                {

                    method:
                        'POST',

                    headers: {

                        'Content-Type':
                            'application/json'
                    },

                    body:
                        JSON.stringify({

                            username:
                                loginUsername,

                            password
                        })
                }
            );

        const data =
            await response.json();

        if (
            !response.ok
            ||
            !data.ok
        ) {

            setAuthMessage(
                data.message ||
                'შესვლა ვერ შესრულდა.',
                true
            );

            return;
        }

        saveLogin(
            data
        );

        if (
            data.isTester
        ) {

            setAuthMessage(
                '🧪 TEST MODE აქტიურია — მაგიდა ბოტებით შეივსება.',
                false
            );

        } else {

            setAuthMessage(
                '✓ წარმატებით შეხვედით.',
                false
            );
        }

    } catch (
        err
    ) {

        console.error(
            err
        );

        setAuthMessage(
            'სერვერთან დაკავშირება ვერ მოხერხდა.',
            true
        );
    }
}

/* =========================================================
   LOGIN STORAGE
========================================================= */

function saveLogin(
    data
) {

    token =
        data.token;

    username =
        data.username;

    balance =
        data.balance;

    isTester =
        !!data.isTester;

    localStorage.setItem(
        'bura_token',
        token
    );

    localStorage.setItem(
        'bura_username',
        username
    );

    localStorage.setItem(
        'bura_balance',
        String(
            balance
        )
    );

    localStorage.setItem(
        'bura_tester',
        String(
            isTester
        )
    );

    updateUserUI();
}

function logout() {

    token =
        null;

    username =
        null;

    balance =
        null;

    isTester =
        false;

    [
        'bura_token',
        'bura_username',
        'bura_balance',
        'bura_tester'
    ].forEach(
        key =>
            localStorage
                .removeItem(
                    key
                )
    );

    updateUserUI();

    setAuthMessage(
        'ანგარიშიდან გამოხვედი.',
        false
    );
}

/* =========================================================
   PROFILE UI
========================================================= */

function updateUserUI() {

    const navUsername =
        document
            .getElementById(
                'nav-username'
            );

    const navBalance =
        document
            .getElementById(
                'nav-balance'
            );

    const avatar =
        document
            .getElementById(
                'nav-avatar'
            );

    const loggedCard =
        document
            .getElementById(
                'logged-user-card'
            );

    const loggedName =
        document
            .getElementById(
                'logged-name'
            );

    if (
        token &&
        username
    ) {

        navUsername
            .textContent =
            username +
            (
                isTester
                    ?
                    ' 🧪'
                    :
                    ''
            );

        navBalance
            .textContent =
            isTester
                ?
                'TEST MODE · $1,000'
                :
                'ბალანსი: $' +
                (
                    balance ||
                    0
                );

        avatar
            .textContent =
            username
                .charAt(0)
                .toUpperCase();

        loggedName
            .textContent =
            username;

        loggedCard
            .classList
            .remove(
                'hidden'
            );

    } else {

        navUsername
            .textContent =
            'სტუმარი';

        navBalance
            .textContent =
            'გაიარე რეგისტრაცია';

        avatar
            .textContent =
            'G';

        loggedCard
            .classList
            .add(
                'hidden'
            );
    }
}

/* =========================================================
   TABLE SELECTION
========================================================= */

function selectCapacity(
    value,
    button
) {

    document
        .getElementById(
            'capacity'
        )
        .value =
            value;

    document
        .querySelectorAll(
            '.capacity-card'
        )
        .forEach(
            element =>
                element
                    .classList
                    .remove(
                        'active'
                    )
        );

    button
        .classList
        .add(
            'active'
        );
}

function selectStake(
    value,
    button
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
            element =>
                element
                    .classList
                    .remove(
                        'active'
                    )
        );

    button
        .classList
        .add(
            'active'
        );
}

/* =========================================================
   JOIN
========================================================= */

function joinTable() {

    if (
        !token
    ) {

        setAuthMessage(
            'ჯერ გაიარე რეგისტრაცია ან შედი ანგარიშზე.',
            true
        );

        window.scrollTo({

            top:
                0,

            behavior:
                'smooth'
        });

        return;
    }

    const data = {

        token,

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
            document
                .getElementById(
                    'stake'
                )
                .value
    };

    document
        .getElementById(
            'waiting-message'
        )
        .textContent =
            isTester
                ?
                '🧪 TEST TABLE მზადდება...'
                :
                'ვეძებთ შესაბამის მაგიდას...';

    socket.emit(
        'joinTable',
        data
    );
}

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
    'waitingForPlayers',
    data => {

        document
            .getElementById(
                'waiting-message'
            )
            .textContent =
                'ველოდებით მოთამაშეებს: '
                +
                data.current
                +
                '/'
                +
                data.max
                +
                ' · ფსონი $'
                +
                data.stake;
    }
);

socket.on(
    'gameStateUpdate',
    state => {

        if (
            !state
        ) {

            return;
        }

        currentState =
            state;

        selectedCards =
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

        renderGame(
            state
        );
    }
);

socket.on(
    'errorMessage',
    message => {

        document
            .getElementById(
                'status'
            )
            .textContent =
                message;

        document
            .getElementById(
                'waiting-message'
            )
            .textContent =
                message;
    }
);

socket.on(
    'playerLeft',
    () => {

        document
            .getElementById(
                'status'
            )
            .textContent =
                'ერთ-ერთმა მოთამაშემ მაგიდა დატოვა.';
    }
);

/* =========================================================
   RENDER GAME
========================================================= */

function renderGame(
    state
) {

    updateTrumpVisual(
        state.trump
    );

    document
        .getElementById(
            'party-num'
        )
        .textContent =
            state.partyNum
            +
            '/'
            +
            state.targetParties;

    document
        .getElementById(
            'hand-index'
        )
        .textContent =
            state.handIndex
            +
            '/'
            +
            state.totalHands;

    document
        .getElementById(
            'deck-count'
        )
        .textContent =
            state.deckCount;

    document
        .getElementById(
            'game-stake'
        )
        .textContent =
            '$' +
            state.stake;

    renderPlayers(
        state
    );

    renderTableCards(
        state
    );

    renderMyCards(
        state
    );

    renderScore(
        state
    );

    updateStatus(
        state
    );
}

/* =========================================================
   TRUMP VISUAL
========================================================= */

function updateTrumpVisual(
    trump
) {

    const text =
        document
            .getElementById(
                'trump'
            );

    const icon =
        document
            .getElementById(
                'trump-icon'
            );

    text.textContent =
        trumpName(
            trump
        );

    if (
        trump ===
        'no_trump'
    ) {

        icon.textContent =
            'Ø';

        icon.style.color =
            '#f6c94a';

        return;
    }

    icon.textContent =
        suitSymbol(
            trump
        );

    const colors = {

        spades:
            '#e4e7eb',

        clubs:
            '#35d6a4',

        diamonds:
            '#6f9eff',

        hearts:
            '#e86a82'
    };

    icon.style.color =
        colors[
            trump
        ] ||
        '#ffffff';
}

/* =========================================================
   PLAYER POSITIONS
========================================================= */

function seatPosition(
    playerIndex,
    playerCount,
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
        myIndex <
        0
    ) {

        myIndex =
            0;
    }

    const relative =
        (
            playerIndex -
            myIndex +
            playerCount
        )
        %
        playerCount;

    const positions = {

        3: [

            {
                left:
                    50,

                top:
                    88
            },

            {
                left:
                    20,

                top:
                    24
            },

            {
                left:
                    80,

                top:
                    24
            }
        ],

        4: [

            {
                left:
                    50,

                top:
                    88
            },

            {
                left:
                    11,

                top:
                    50
            },

            {
                left:
                    50,

                top:
                    12
            },

            {
                left:
                    89,

                top:
                    50
            }
        ]
    };

    return (
        positions[
            playerCount
        ]
        ||
        positions[3]
    )[
        relative
    ];
}

/* =========================================================
   RENDER PLAYERS
========================================================= */

function renderPlayers(
    state
) {

    const container =
        document
            .getElementById(
                'players'
            );

    container.innerHTML =
        '';

    state.players.forEach(
        (
            player,
            index
        ) => {

            const seat =
                document
                    .createElement(
                        'div'
                    );

            seat.className =
                'seat'
                +
                (
                    player.isCurrent
                        ?
                        ' current'
                        :
                        ''
                );

            const position =
                seatPosition(
                    index,
                    state.players.length,
                    state.viewingPlayerId,
                    state.players
                );

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
                    let i =
                        0;

                    i <
                    player.cardCount;

                    i++
                ) {

                    backs +=
                        '<div class="card-back"></div>';
                }
            }

            seat.innerHTML =
                '<div class="seat-box">'
                +
                '<div class="seat-avatar">'
                +
                escapeHtml(
                    player.name
                        .charAt(0)
                        .toUpperCase()
                )
                +
                '</div>'
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
                'კარტი: '
                +
                player.cardCount
                +
                ' · მიმდინარე: '
                +
                player.handPoints
                +
                ' · საერთო: '
                +
                player.totalPoints
                +
                '</div>'
                +
                '<div class="card-backs">'
                +
                backs
                +
                '</div>'
                +
                '</div>';

            container.appendChild(
                seat
            );
        }
    );
}

/* =========================================================
   TABLE CARDS
========================================================= */

function renderTableCards(
    state
) {

    const container =
        document
            .getElementById(
                'table-cards'
            );

    container.innerHTML =
        '';

    state.table.forEach(
        play => {

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

            play.cards.forEach(
                card => {

                    group.appendChild(
                        createCardElement(
                            card
                        )
                    );
                }
            );

            container.appendChild(
                group
            );
        }
    );
}

/* =========================================================
   MY CARDS
========================================================= */

function renderMyCards(
    state
) {

    const container =
        document
            .getElementById(
                'my-cards'
            );

    container.innerHTML =
        '';

    const cards =
        state.playersCards[
            state.viewingPlayerId
        ] ||
        [];

    cards.forEach(
        (
            card,
            index
        ) => {

            const element =
                createCardElement(
                    card
                );

            element.onclick =
                () => {

                    toggleCard(
                        index,
                        element
                    );
                };

            container.appendChild(
                element
            );
        }
    );

    updatePlayButton(
        state
    );
}

/* =========================================================
   CREATE CARD
========================================================= */

function createCardElement(
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

    const suit =
        suitSymbol(
            card.suit
        );

    /*
        აქ შეგნებულად არ ვიყენებთ
        nested template literals-ს.
        Render-ის წინა პრობლემა სწორედ
        მსგავსი სტრუქტურიდან იყო.
    */

    element.innerHTML =
        '<div class="card-top">'
        +
        '<span>'
        +
        escapeHtml(
            card.rank
        )
        +
        '</span>'
        +
        '<span>'
        +
        suit
        +
        '</span>'
        +
        '</div>'
        +
        '<div class="card-center">'
        +
        suit
        +
        '</div>'
        +
        '<div class="card-bottom">'
        +
        '<span>'
        +
        escapeHtml(
            card.rank
        )
        +
        '</span>'
        +
        '<span>'
        +
        suit
        +
        '</span>'
        +
        '</div>';

    return element;
}

/* =========================================================
   SELECT CARD
========================================================= */

function toggleCard(
    index,
    element
) {

    const existing =
        selectedCards
            .indexOf(
                index
            );

    if (
        existing >=
        0
    ) {

        selectedCards.splice(
            existing,
            1
        );

        element
            .classList
            .remove(
                'selected'
            );

    } else {

        selectedCards.push(
            index
        );

        element
            .classList
            .add(
                'selected'
            );
    }

    updatePlayButton(
        currentState
    );
}

/* =========================================================
   PLAY
========================================================= */

function updatePlayButton(
    state
) {

    const button =
        document
            .getElementById(
                'play-button'
            );

    if (
        !state
    ) {

        button.disabled =
            true;

        return;
    }

    const active =
        state.players[
            state.currentTurnIndex
        ];

    const myTurn =
        active
        &&
        active.id ===
        state.viewingPlayerId;

    button.disabled =
        !myTurn
        ||
        selectedCards.length ===
        0
        ||
        state.isProcessing
        ||
        state.gameOver;
}

function playSelectedCards() {

    if (
        !selectedCards.length
    ) {

        return;
    }

    socket.emit(
        'playCards',
        {

            cardIndices:
                [
                    ...selectedCards
                ]
        }
    );

    selectedCards =
        [];
}

/* =========================================================
   STATUS
========================================================= */

function updateStatus(
    state
) {

    const element =
        document
            .getElementById(
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
        state.isProcessing
    ) {

        element.textContent =
            '✨ კარტები ითვლება...';

        return;
    }

    const active =
        state.players[
            state.currentTurnIndex
        ];

    if (
        !active
    ) {

        return;
    }

    if (
        active.id ===
        state.viewingPlayerId
    ) {

        element.textContent =
            '🎯 შენი სვლაა';

    } else if (
        active.isBot
    ) {

        element.textContent =
            '🤖 '
            +
            active.name
            +
            ' თამაშობს...';

    } else {

        element.textContent =
            active.name
            +
            '-ის სვლაა';
    }
}

/* =========================================================
   LIVE SCORE
========================================================= */

function renderScore(
    state
) {

    const container =
        document
            .getElementById(
                'score-content'
            );

    const lastScores =
        state.lastHandScores ||
        {};

    /*
        მაღალი ქულა = მაღალი ადგილი
    */

    const sortedPlayers =
        [
            ...state.players
        ].sort(
            (
                a,
                b
            ) =>
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

    let html =
        '';

    /*
        Header
    */

    html +=
        '<div class="standing-row header">'
        +
        '<div class="standing-cell">'
        +
        'ადგილი'
        +
        '</div>'
        +
        '<div class="standing-cell">'
        +
        'მოთამაშე'
        +
        '</div>'
        +
        '<div class="standing-cell">'
        +
        'ბოლო ხელი'
        +
        '</div>'
        +
        '<div class="standing-cell">'
        +
        'საერთო ქულა'
        +
        '</div>'
        +
        '</div>';

    sortedPlayers.forEach(
        (
            player,
            index
        ) => {

            const place =
                index +
                1;

            let medal;

            let rowClass;

            if (
                place ===
                1
            ) {

                medal =
                    '🥇';

                rowClass =
                    ' first';

            } else if (
                place ===
                2
            ) {

                medal =
                    '🥈';

                rowClass =
                    ' second';

            } else if (
                place ===
                3
            ) {

                medal =
                    '🥉';

                rowClass =
                    ' third';

            } else {

                medal =
                    '#' +
                    place;

                rowClass =
                    '';
            }

            const lastScore =
                lastScores[
                    player.id
                ];

            const hasLastScore =
                typeof lastScore ===
                'number';

            let scoreText =
                '-';

            let scoreClass =
                '';

            if (
                hasLastScore
            ) {

                if (
                    lastScore >
                    0
                ) {

                    scoreText =
                        '+' +
                        lastScore;

                    scoreClass =
                        ' positive';

                } else if (
                    lastScore <
                    0
                ) {

                    scoreText =
                        String(
                            lastScore
                        );

                    scoreClass =
                        ' negative';

                } else {

                    scoreText =
                        '0';
                }
            }

            const you =
                player.id ===
                state.viewingPlayerId
                    ?
                    '<span class="standing-you">YOU</span>'
                    :
                    '';

            const medalClass =
                place <=
                3
                    ?
                    'place-medal'
                    :
                    'place-number';

            /*
                ასევე string concatenation,
                nested template string არ არის.
            */

            html +=
                '<div class="standing-row'
                +
                rowClass
                +
                '">'
                +
                '<div class="standing-cell">'
                +
                '<span class="'
                +
                medalClass
                +
                '">'
                +
                medal
                +
                '</span>'
                +
                '</div>'
                +
                '<div class="standing-cell">'
                +
                '<div class="player-standing">'
                +
                '<div class="standing-avatar">'
                +
                escapeHtml(
                    player.name
                        .charAt(0)
                        .toUpperCase()
                )
                +
                '</div>'
                +
                '<div class="standing-player-name">'
                +
                escapeHtml(
                    player.name
                )
                +
                you
                +
                '</div>'
                +
                '</div>'
                +
                '</div>'
                +
                '<div class="standing-cell">'
                +
                '<span class="last-hand-score'
                +
                scoreClass
                +
                '">'
                +
                scoreText
                +
                '</span>'
                +
                '</div>'
                +
                '<div class="standing-cell">'
                +
                '<span class="total-score">'
                +
                (
                    player.totalPoints ||
                    0
                )
                +
                '</span>'
                +
                '</div>'
                +
                '</div>';
        }
    );

    container.innerHTML =
        html;
}

/* =========================================================
   HELPERS
========================================================= */

function suitSymbol(
    suit
) {

    const symbols = {

        spades:
            '♠',

        clubs:
            '♣',

        hearts:
            '♥',

        diamonds:
            '♦'
    };

    return (
        symbols[
            suit
        ] ||
        ''
    );
}

function trumpName(
    trump
) {

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

function escapeHtml(
    text
) {

    return String(
        text ??
        ''
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

</script>

</body>

</html>
`;

/* =========================================================
   MAIN PAGE
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

/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            '===================================='
        );

        console.log(
            'BURA VIP CLUB STARTED'
        );

        console.log(
            'PORT:',
            PORT
        );

        console.log(
            'DECK:',
            createDeck().length,
            'cards'
        );

        console.log(
            'TEST USER:',
            TESTER_USERNAME
        );

        console.log(
            'STARTING BALANCE: $' +
            STARTING_BALANCE
        );

        console.log(
            'TABLES: 3 / 4 players'
        );

        console.log(
            'PARTIES: 1 / 2 / 3 / 4'
        );

        console.log(
            '===================================='
        );
    }
);
