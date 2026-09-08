const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*"
    }
});

const PORT = process.env.PORT || 10000;

app.use(express.json());

/* =========================================================
   USERS / REGISTRATION
========================================================= */

const USERS_FILE = path.join(__dirname, "users.json");

let users = [];

try {
    if (fs.existsSync(USERS_FILE)) {
        users = JSON.parse(
            fs.readFileSync(USERS_FILE, "utf8")
        );
    }
} catch (err) {
    console.error("users.json read error:", err);
    users = [];
}

function saveUsers() {
    try {
        fs.writeFileSync(
            USERS_FILE,
            JSON.stringify(users, null, 2)
        );
    } catch (err) {
        console.error("users.json save error:", err);
    }
}

function normalizeUsername(username) {
    return String(username || "").trim();
}

function normalizeEmail(email) {
    return String(email || "")
        .trim()
        .toLowerCase();
}

function hashPassword(password, salt) {
    return crypto
        .scryptSync(password, salt, 64)
        .toString("hex");
}

function createToken() {
    return crypto
        .randomBytes(32)
        .toString("hex");
}

const sessions = new Map();

/* =========================================================
   REGISTER
========================================================= */

app.post("/api/register", (req, res) => {

    const username =
        normalizeUsername(req.body.username);

    const email =
        normalizeEmail(req.body.email);

    const password =
        String(req.body.password || "");

    if (
        username.length < 3 ||
        username.length > 20
    ) {
        return res.status(400).json({
            ok: false,
            message:
                "Username უნდა იყოს 3-20 სიმბოლო."
        });
    }

    if (
        !/^[a-zA-Z0-9_\u10A0-\u10FF]+$/u.test(
            username
        )
    ) {
        return res.status(400).json({
            ok: false,
            message:
                "Username-ში გამოიყენე ასოები, ციფრები ან _"
        });
    }

    if (
        !email ||
        !email.includes("@")
    ) {
        return res.status(400).json({
            ok: false,
            message:
                "შეიყვანე სწორი Email."
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            ok: false,
            message:
                "პაროლი მინიმუმ 6 სიმბოლო უნდა იყოს."
        });
    }

    const usernameExists =
        users.some(
            u =>
                u.username.toLowerCase() ===
                username.toLowerCase()
        );

    if (usernameExists) {
        return res.status(409).json({
            ok: false,
            message:
                "ეს Username უკვე დაკავებულია."
        });
    }

    const emailExists =
        users.some(
            u =>
                u.email === email
        );

    if (emailExists) {
        return res.status(409).json({
            ok: false,
            message:
                "ეს Email უკვე რეგისტრირებულია."
        });
    }

    const salt =
        crypto
            .randomBytes(16)
            .toString("hex");

    const passwordHash =
        hashPassword(password, salt);

    const user = {
        id:
            "user_" +
            Date.now() +
            "_" +
            Math.floor(
                Math.random() * 100000
            ),

        username,
        email,
        salt,
        passwordHash,

        balance: 100,

        createdAt:
            new Date().toISOString()
    };

    users.push(user);

    saveUsers();

    const token =
        createToken();

    sessions.set(
        token,
        user.id
    );

    res.json({
        ok: true,
        token,
        username:
            user.username,

        balance:
            user.balance
    });
});

/* =========================================================
   LOGIN
========================================================= */

app.post("/api/login", (req, res) => {

    const username =
        normalizeUsername(
            req.body.username
        );

    const password =
        String(
            req.body.password || ""
        );

    const user =
        users.find(
            u =>
                u.username.toLowerCase() ===
                username.toLowerCase()
        );

    if (!user) {
        return res.status(401).json({
            ok: false,
            message:
                "Username ან პაროლი არასწორია."
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
        return res.status(401).json({
            ok: false,
            message:
                "Username ან პაროლი არასწორია."
        });
    }

    const token =
        createToken();

    sessions.set(
        token,
        user.id
    );

    res.json({
        ok: true,
        token,
        username:
            user.username,

        balance:
            user.balance
    });
});

/* =========================================================
   AUTH
========================================================= */

function getUserByToken(token) {

    if (!token) {
        return null;
    }

    const userId =
        sessions.get(token);

    if (!userId) {
        return null;
    }

    return (
        users.find(
            u =>
                u.id === userId
        ) || null
    );
}

/* =========================================================
   GAME CONSTANTS

   36 CARDS:
   6 7 8 9 J Q K 10 A
========================================================= */

const CARD_VALUES = {

    "6": 0,

    "7": 0,

    "8": 0,

    "9": 0,

    "J": 2,

    "Q": 3,

    "K": 4,

    "10": 10,

    "A": 11
};

const RANKS_ORDER = [

    "6",

    "7",

    "8",

    "9",

    "J",

    "Q",

    "K",

    "10",

    "A"
];

const SUITS = [

    "spades",

    "clubs",

    "hearts",

    "diamonds"
];

const TRUMP_ROTATION = [

    "spades",

    "clubs",

    "hearts",

    "diamonds",

    "no_trump"
];

/* =========================================================
   ROOMS
========================================================= */

let rooms = {};

/* =========================================================
   CREATE 36 CARD DECK
========================================================= */

function createDeck() {

    let deck = [];

    for (
        const suit of SUITS
    ) {

        for (
            const rank of RANKS_ORDER
        ) {

            deck.push({

                id:
                    `${suit}_${rank}_${Math.random()}`,

                rank,

                suit,

                value:
                    CARD_VALUES[rank]
            });
        }
    }

    /*
        9 ranks x 4 suits = 36 cards
    */

    for (
        let i =
            deck.length - 1;

        i > 0;

        i--
    ) {

        const j =
            Math.floor(
                Math.random() *
                (i + 1)
            );

        [
            deck[i],
            deck[j]
        ] = [
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
    roomId,
    maxPlayers,
    targetParties,
    stake
) {

    return {

        id:
            roomId,

        maxPlayers:
            Number(maxPlayers),

        targetParties:
            Number(targetParties),

        stake:
            Number(stake),

        players: [],

        gameState:
            null
    };
}

/* =========================================================
   START HAND
========================================================= */

function startNewHand(
    room,
    previousGame = null
) {

    const deck =
        createDeck();

    const playersCards = {};

    const takenCards = {};

    const totalScores = {};

    room.players.forEach(
        player => {

            playersCards[
                player.id
            ] =
                deck.splice(
                    0,
                    5
                );

            takenCards[
                player.id
            ] = [];

            totalScores[
                player.id
            ] =
                previousGame
                    ?
                    (
                        previousGame
                            .totalScores[
                                player.id
                            ] || 0
                    )
                    :
                    0;
        }
    );

    const handIndex =
        previousGame
            ?
            previousGame.handIndex + 1
            :
            1;

    const partyNum =
        Math.ceil(
            handIndex / 5
        );

    const trumpIndex =
        (
            handIndex - 1
        ) % 5;

    const currentTrump =
        TRUMP_ROTATION[
            trumpIndex
        ];

    let startLeaderIndex =
        0;

    if (
        previousGame &&
        previousGame
            .nextRoundLeaderIndex !==
            undefined
    ) {

        startLeaderIndex =
            previousGame
                .nextRoundLeaderIndex;
    }

    return {

        deck,

        playersCards,

        takenCards,

        totalScores,

        currentTurnIndex:
            startLeaderIndex,

        table: [],

        trump:
            currentTrump,

        partyNum,

        handIndex,

        roundHistory:
            previousGame
                ?
                previousGame
                    .roundHistory
                :
                [],

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
        trump !== "no_trump" &&
        challengeCard.suit ===
        trump;

    const leadTrump =
        trump !== "no_trump" &&
        leadCard.suit ===
        trump;

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

    if (
        challengeCard.suit ===
        leadCard.suit
    ) {

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

    return false;
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

    const isMaliutka =
        challengeCards.length === 5 &&
        challengeCards.every(
            card =>
                card.suit ===
                challengeCards[0].suit
        );

    if (
        isMaliutka &&
        leadCards.length < 5
    ) {
        return true;
    }

    if (
        leadCards.length !==
        challengeCards.length
    ) {
        return false;
    }

    const sortedLead =
        [...leadCards].sort(
            (a, b) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    const sortedChallenge =
        [...challengeCards].sort(
            (a, b) =>
                RANKS_ORDER.indexOf(
                    b.rank
                )
                -
                RANKS_ORDER.indexOf(
                    a.rank
                )
        );

    for (
        let i = 0;

        i <
        sortedLead.length;

        i++
    ) {

        if (
            !cardBeatsCard(
                sortedLead[i],
                sortedChallenge[i],
                trump
            )
        ) {

            return false;
        }
    }

    return true;
}

/* =========================================================
   WINNING PLAY
========================================================= */

function getWinningPlayIndex(
    table,
    trump
) {

    if (
        !table ||
        table.length === 0
    ) {
        return -1;
    }

    let winningIndex =
        0;

    for (
        let i = 1;

        i <
        table.length;

        i++
    ) {

        if (
            beatsPlay(
                table[
                    winningIndex
                ],
                table[i],
                trump
            )
        ) {

            winningIndex =
                i;
        }
    }

    return winningIndex;
}

/* =========================================================
   PERSONAL GAME STATE
========================================================= */

function getClientGameState(
    room,
    forPlayerId
) {

    const gs =
        room.gameState;

    if (!gs) {
        return null;
    }

    const winningIndex =
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

                return {

                    id:
                        player.id,

                    name:
                        player.name,

                    balance:
                        player.balance,

                    cardCount:
                        gs.playersCards[
                            player.id
                        ]
                            ?
                            gs.playersCards[
                                player.id
                            ].length
                            :
                            0,

                    takenCount:
                        gs.takenCards[
                            player.id
                        ]
                            ?
                            gs.takenCards[
                                player.id
                            ].length
                            :
                            0,

                    handPoints:
                        gs.takenCards[
                            player.id
                        ]
                            ?
                            gs.takenCards[
                                player.id
                            ].reduce(
                                (
                                    sum,
                                    card
                                ) =>
                                    sum +
                                    card.value,
                                0
                            )
                            :
                            0,

                    totalPoints:
                        gs.totalScores[
                            player.id
                        ] || 0,

                    isCurrent:
                        index ===
                        gs.currentTurnIndex
                };
            }
        );

    const visibleCards = {};

    /*
        IMPORTANT:
        მხოლოდ თავისი კარტები
        ეგზავნება მოთამაშეს.
    */

    if (
        forPlayerId &&
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
                        winningIndex
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

        gameOver:
            gs.gameOver
    };
}

/* =========================================================
   BROADCAST PERSONAL STATE

   THIS FIXES INVISIBLE CARDS
========================================================= */

function broadcastGameState(
    room
) {

    room.players.forEach(
        player => {

            if (
                player.isBot
            ) {
                return;
            }

            io.to(
                player.id
            ).emit(
                "gameStateUpdate",
                getClientGameState(
                    room,
                    player.id
                )
            );
        }
    );
}

/* =========================================================
   FINISH HAND
========================================================= */

function finishHand(
    room
) {

    const gs =
        room.gameState;

    const handScores = {};

    let minScore =
        Infinity;

    let minPlayerIndex =
        0;

    room.players.forEach(
        (
            player,
            index
        ) => {

            const points =
                gs.takenCards[
                    player.id
                ].reduce(
                    (
                        sum,
                        card
                    ) =>
                        sum +
                        card.value,
                    0
                );

            handScores[
                player.id
            ] =
                points;

            gs.totalScores[
                player.id
            ] =
                (
                    gs.totalScores[
                        player.id
                    ] || 0
                )
                +
                (
                    points === 0
                        ?
                        -120
                        :
                        points
                );

            if (
                points <
                minScore
            ) {

                minScore =
                    points;

                minPlayerIndex =
                    index;
            }
        }
    );

    gs.roundHistory.push({

        handIndex:
            gs.handIndex,

        trump:
            gs.trump,

        scores:
            handScores
    });

    const totalMaxHands =
        room.targetParties *
        5;

    if (
        gs.handIndex >=
        totalMaxHands
    ) {

        gs.gameOver =
            true;

        broadcastGameState(
            room
        );

        return;
    }

    const nextLeaderIndex =
        (
            minPlayerIndex + 1
        ) %
        room.players.length;

    gs.nextRoundLeaderIndex =
        nextLeaderIndex;

    room.gameState =
        startNewHand(
            room,
            gs
        );

    broadcastGameState(
        room
    );
}

/* =========================================================
   SOCKET.IO
========================================================= */

io.on(
    "connection",
    socket => {

        console.log(
            "connected:",
            socket.id
        );

        /* =================================================
           JOIN TABLE
        ================================================= */

        socket.on(
            "joinTable",
            data => {

                const user =
                    getUserByToken(
                        data.token
                    );

                if (!user) {

                    socket.emit(
                        "errorMessage",
                        "ჯერ გაიარე რეგისტრაცია ან შედი ანგარიშზე."
                    );

                    return;
                }

                const capacity =
                    Math.max(
                        2,
                        Math.min(
                            6,
                            parseInt(
                                data.capacity
                            ) || 2
                        )
                    );

                const parties =
                    Math.max(
                        1,
                        parseInt(
                            data.parties
                        ) || 1
                    );

                const stake =
                    Math.max(
                        0,
                        parseFloat(
                            data.stake
                        ) || 1
                    );

                if (
                    user.balance <
                    stake
                ) {

                    socket.emit(
                        "errorMessage",
                        "არ გაქვს საკმარისი ბალანსი."
                    );

                    return;
                }

                /*
                    ერთი socket ერთ მაგიდაზე.
                */

                if (
                    socket.roomId
                ) {
                    return;
                }

                let room =
                    Object.values(
                        rooms
                    ).find(
                        r =>
                            r.maxPlayers ===
                            capacity
                            &&
                            r.targetParties ===
                            parties
                            &&
                            r.stake ===
                            stake
                            &&
                            r.players.length <
                            r.maxPlayers
                            &&
                            !r.gameState
                    );

                if (!room) {

                    const roomId =
                        "room_" +
                        Date.now() +
                        "_" +
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

                /*
                    ერთი username ორჯერ
                    ერთ ოთახში არ მოხვდეს.
                */

                const alreadyInRoom =
                    room.players.some(
                        p =>
                            p.userId ===
                            user.id
                    );

                if (
                    alreadyInRoom
                ) {

                    socket.emit(
                        "errorMessage",
                        "ეს მომხმარებელი უკვე მაგიდაზეა."
                    );

                    return;
                }

                socket.roomId =
                    room.id;

                socket.userId =
                    user.id;

                socket.join(
                    room.id
                );

                user.balance -=
                    stake;

                saveUsers();

                room.players.push({

                    id:
                        socket.id,

                    userId:
                        user.id,

                    name:
                        user.username,

                    balance:
                        user.balance,

                    isBot:
                        false
                });

                /*
                    როცა მაგიდა შეივსება
                    თამაში ავტომატურად იწყება.
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
                        IMPORTANT FIX:
                        ყველა მოთამაშეს პირადად
                        თავისი კარტები ეგზავნება.
                    */

                    broadcastGameState(
                        room
                    );

                } else {

                    io.to(
                        room.id
                    ).emit(
                        "waitingForPlayers",
                        {

                            current:
                                room.players
                                    .length,

                            max:
                                room.maxPlayers
                        }
                    );
                }
            }
        );

        /* =================================================
           PLAY CARDS
        ================================================= */

        socket.on(
            "playCards",
            data => {

                if (
                    !socket.roomId
                    ||
                    !rooms[
                        socket.roomId
                    ]
                ) {
                    return;
                }

                const room =
                    rooms[
                        socket.roomId
                    ];

                const gs =
                    room.gameState;

                if (
                    !gs
                    ||
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
                        "errorMessage",
                        "ახლა შენი სვლა არ არის."
                    );

                    return;
                }

                const playerCards =
                    gs.playersCards[
                        socket.id
                    ];

                if (
                    !playerCards
                ) {
                    return;
                }

                const cardIndices =
                    Array.isArray(
                        data.cardIndices
                    )
                        ?
                        [...new Set(
                            data.cardIndices
                        )]
                        :
                        [];

                const selectedCards =
                    cardIndices
                        .map(
                            index =>
                                playerCards[
                                    index
                                ]
                        )
                        .filter(Boolean);

                if (
                    selectedCards.length ===
                    0
                    ||
                    selectedCards.length !==
                    cardIndices.length
                ) {

                    socket.emit(
                        "errorMessage",
                        "აირჩიე კარტი."
                    );

                    return;
                }

                const isMaliutka =
                    selectedCards.length ===
                    5
                    &&
                    selectedCards.every(
                        card =>
                            card.suit ===
                            selectedCards[
                                0
                            ].suit
                    );

                /*
                    პირველი მოთამაშე.
                */

                if (
                    gs.table.length ===
                    0
                ) {

                    const firstSuit =
                        selectedCards[
                            0
                        ].suit;

                    const sameSuit =
                        selectedCards.every(
                            card =>
                                card.suit ===
                                firstSuit
                        );

                    if (
                        !sameSuit
                    ) {

                        socket.emit(
                            "errorMessage",
                            "პირველმა მოთამაშემ ერთი ფერის კარტები უნდა ჩამოვიდეს."
                        );

                        return;
                    }

                    gs.leadCardCount =
                        selectedCards.length;

                } else {

                    if (
                        !isMaliutka
                        &&
                        selectedCards.length !==
                        gs.leadCardCount
                    ) {

                        socket.emit(
                            "errorMessage",
                            `უნდა ჩამოხვიდე ${gs.leadCardCount} კარტი ან მალიუტკა.`
                        );

                        return;
                    }
                }

                /*
                    Remove selected cards.
                */

                gs.playersCards[
                    socket.id
                ] =
                    playerCards.filter(
                        (
                            card,
                            index
                        ) =>
                            !cardIndices.includes(
                                index
                            )
                    );

                gs.table.push({

                    playerId:
                        socket.id,

                    playerName:
                        activePlayer.name,

                    cards:
                        selectedCards
                });

                /*
                    Next player
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

                    return;
                }

                /*
                    Round complete
                */

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

                const winnerId =
                    winningPlay
                        .playerId;

                const tableCards =
                    [];

                gs.table.forEach(
                    play =>
                        tableCards.push(
                            ...play.cards
                        )
                );

                gs.takenCards[
                    winnerId
                ].push(
                    ...tableCards
                );

                const winnerIndex =
                    room.players
                        .findIndex(
                            player =>
                                player.id ===
                                winnerId
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

                        gs.table = [];

                        gs.leadCardCount =
                            null;

                        /*
                            ხელში ისევ მაქსიმუმ
                            5 კარტი.
                        */

                        while (
                            gs.deck.length >
                            0
                        ) {

                            let needCards =
                                false;

                            for (
                                let step = 0;

                                step <
                                room.players
                                    .length;

                                step++
                            ) {

                                const playerIndex =
                                    (
                                        winnerIndex +
                                        step
                                    )
                                    %
                                    room.players
                                        .length;

                                const player =
                                    room.players[
                                        playerIndex
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

                                    needCards =
                                        true;
                                }
                            }

                            if (
                                !needCards
                            ) {
                                break;
                            }
                        }

                        const allHandsEmpty =
                            room.players.every(
                                player =>
                                    gs.playersCards[
                                        player.id
                                    ].length ===
                                    0
                            );

                        gs.isProcessing =
                            false;

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
                        }

                    },
                    1200
                );
            }
        );

        /* =================================================
           DISCONNECT
        ================================================= */

        socket.on(
            "disconnect",
            () => {

                const roomId =
                    socket.roomId;

                if (
                    !roomId
                    ||
                    !rooms[
                        roomId
                    ]
                ) {
                    return;
                }

                const room =
                    rooms[
                        roomId
                    ];

                room.players =
                    room.players.filter(
                        player =>
                            player.id !==
                            socket.id
                    );

                io.to(
                    room.id
                ).emit(
                    "playerLeft"
                );

                /*
                    თუ თამაში ჯერ არ იყო
                    დაწყებული ოთახი დარჩეს,
                    თუ ცარიელია წაიშალოს.
                */

                if (
                    room.players.length ===
                    0
                ) {

                    delete rooms[
                        roomId
                    ];
                }
            }
        );
    }
);

/* =========================================================
   FRONTEND
========================================================= */

app.get(
    "/",
    (req, res) => {

        res.send(`
<!DOCTYPE html>
<html lang="ka">

<head>

<meta charset="UTF-8">

<meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
/>

<title>BURA VIP CLUB</title>

<script src="/socket.io/socket.io.js"></script>

<style>

/* =========================================================
   ROOT
========================================================= */

* {
    box-sizing: border-box;
}

:root {
    --bg: #07090d;
    --panel: #11151c;
    --panel2: #181d26;
    --gold: #f4c542;
    --gold2: #ff9800;
    --green: #0c6b3b;
    --green2: #073b23;
    --text: #ffffff;
    --muted: #8993a4;
    --red: #e04d4d;
    --line: rgba(255,255,255,.08);
}

html,
body {
    padding: 0;
    margin: 0;
    min-height: 100%;
}

body {
    min-height: 100vh;

    background:
        radial-gradient(
            circle at 50% 0,
            rgba(244,197,66,.10),
            transparent 30%
        ),
        #07090d;

    color: white;

    font-family:
        Inter,
        Segoe UI,
        Arial,
        sans-serif;
}

button,
input,
select {
    font: inherit;
}

button {
    cursor: pointer;
}

.hidden {
    display: none !important;
}

/* =========================================================
   NAV
========================================================= */

.navbar {

    height: 76px;

    padding:
        0 28px;

    display:
        flex;

    align-items:
        center;

    justify-content:
        space-between;

    border-bottom:
        1px solid
        var(--line);

    background:
        rgba(7,9,13,.92);

    backdrop-filter:
        blur(18px);

    position:
        sticky;

    top:
        0;

    z-index:
        100;
}

.logo {

    font-size:
        22px;

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

    color:
        #c4cad5;

    font-size:
        13px;
}

.avatar {

    width:
        36px;

    height:
        36px;

    border-radius:
        50%;

    display:
        grid;

    place-items:
        center;

    background:
        linear-gradient(
            145deg,
            #545c69,
            #252a33
        );

    border:
        1px solid
        rgba(244,197,66,.35);

    font-weight:
        900;

    color:
        var(--gold);
}

/* =========================================================
   LOBBY
========================================================= */

#lobby {

    min-height:
        100vh;
}

.lobby-wrapper {

    width:
        min(1200px,100%);

    margin:
        auto;

    padding:
        38px 20px 70px;
}

.hero {

    text-align:
        center;

    margin-bottom:
        28px;
}

.hero h1 {

    font-size:
        clamp(
            28px,
            5vw,
            48px
        );

    margin:
        0;

    background:
        linear-gradient(
            135deg,
            #fff1a5,
            #f4c542,
            #ff9700
        );

    -webkit-background-clip:
        text;

    color:
        transparent;
}

.hero p {

    color:
        var(--muted);

    margin-top:
        10px;
}

/* =========================================================
   CARD PANELS
========================================================= */

.grid {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    gap:
        20px;
}

.panel {

    background:
        linear-gradient(
            145deg,
            rgba(22,27,36,.98),
            rgba(12,15,21,.98)
        );

    border:
        1px solid
        var(--line);

    border-radius:
        18px;

    padding:
        24px;

    box-shadow:
        0 25px 70px
        rgba(0,0,0,.28);
}

.panel h2 {

    font-size:
        18px;

    margin:
        0 0 18px;
}

.panel-subtitle {

    color:
        var(--muted);

    font-size:
        12px;

    margin:
        -10px 0 18px;
}

/* =========================================================
   INPUTS
========================================================= */

.field {

    margin:
        14px 0;
}

.field label {

    display:
        block;

    font-size:
        11px;

    color:
        #9ba4b3;

    margin-bottom:
        6px;

    text-transform:
        uppercase;

    letter-spacing:
        .4px;

    font-weight:
        800;
}

.field input,
.field select {

    width:
        100%;

    height:
        46px;

    background:
        #090c11;

    color:
        white;

    border:
        1px solid
        #2d3440;

    border-radius:
        10px;

    padding:
        0 13px;

    outline:
        none;

    transition:
        .15s;
}

.field input:focus,
.field select:focus {

    border-color:
        rgba(244,197,66,.75);

    box-shadow:
        0 0 0 3px
        rgba(244,197,66,.08);
}

/* =========================================================
   BUTTONS
========================================================= */

.gold-btn {

    width:
        100%;

    height:
        48px;

    border:
        0;

    border-radius:
        11px;

    background:
        linear-gradient(
            135deg,
            #ffe15b,
            #ff9700
        );

    color:
        #181006;

    font-weight:
        950;

    transition:
        .15s;

    box-shadow:
        0 12px 30px
        rgba(255,151,0,.16);
}

.gold-btn:hover {

    transform:
        translateY(-2px);

    box-shadow:
        0 15px 36px
        rgba(255,151,0,.26);
}

.secondary-btn {

    width:
        100%;

    height:
        44px;

    border-radius:
        10px;

    border:
        1px solid
        var(--line);

    background:
        #1c222c;

    color:
        white;

    font-weight:
        800;
}

.secondary-btn:hover {
    background:
        #262e3a;
}

/* =========================================================
   AUTH TABS
========================================================= */

.auth-tabs {

    display:
        grid;

    grid-template-columns:
        1fr 1fr;

    background:
        #090c11;

    border-radius:
        11px;

    padding:
        4px;

    margin-bottom:
        20px;
}

.auth-tab {

    border:
        0;

    height:
        40px;

    border-radius:
        8px;

    background:
        transparent;

    color:
        #8e97a6;

    font-weight:
        850;
}

.auth-tab.active {

    color:
        #111;

    background:
        linear-gradient(
            135deg,
            #ffe15b,
            #ff9700
        );
}

.message {

    min-height:
        22px;

    text-align:
        center;

    margin-top:
        10px;

    color:
        var(--gold);

    font-size:
        12px;

    font-weight:
        800;
}

.message.error {
    color:
        #ff6666;
}

.user-card {

    padding:
        14px;

    margin-bottom:
        18px;

    border-radius:
        12px;

    background:
        #0b0f15;

    border:
        1px solid
        var(--line);

    display:
        flex;

    justify-content:
        space-between;

    align-items:
        center;
}

.user-card strong {
    color:
        var(--gold);
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
        20px;

    background:
        radial-gradient(
            circle at 50% 45%,
            rgba(25,130,70,.13),
            transparent 45%
        ),
        #07090d;
}

.game-header {

    width:
        min(1200px,100%);

    margin:
        auto;

    padding:
        12px 15px;

    border:
        1px solid
        var(--line);

    border-radius:
        13px;

    background:
        rgba(15,18,24,.95);

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
}

.game-logo {

    color:
        var(--gold);

    font-weight:
        950;
}

.game-info {

    display:
        flex;

    gap:
        8px;

    flex-wrap:
        wrap;
}

.badge {

    padding:
        7px 10px;

    border-radius:
        8px;

    background:
        #090c11;

    border:
        1px solid
        var(--line);

    color:
        #aeb6c3;

    font-size:
        11px;
}

.badge b {
    color:
        white;
}

#status {

    min-height:
        28px;

    text-align:
        center;

    color:
        var(--gold);

    font-weight:
        900;

    margin:
        10px;
}

/* =========================================================
   TABLE
========================================================= */

.table-board {

    width:
        min(1100px,96vw);

    height:
        560px;

    position:
        relative;

    margin:
        0 auto;

    border-radius:
        50% / 38%;

    border:
        17px solid
        #2d1c10;

    background:
        radial-gradient(
            ellipse at center,
            #16834b 0%,
            #0a6237 55%,
            #06341e 100%
        );

    box-shadow:
        0 25px 90px
        rgba(0,0,0,.75),
        inset 0 0 70px
        rgba(0,0,0,.40);
}

.table-board:before {

    content:
        "";

    position:
        absolute;

    inset:
        14px;

    border:
        1px solid
        rgba(255,255,255,.10);

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
        rgba(255,255,255,.07);

    font-size:
        32px;

    font-weight:
        950;

    letter-spacing:
        4px;
}

/* =========================================================
   SEATS
========================================================= */

#players {

    position:
        absolute;

    inset:
        0;
}

.seat {

    position:
        absolute;

    transform:
        translate(-50%,-50%);

    width:
        145px;

    text-align:
        center;

    z-index:
        5;
}

.seat-card {

    background:
        rgba(5,9,11,.88);

    border:
        1px solid
        rgba(255,255,255,.13);

    border-radius:
        12px;

    padding:
        8px;

    box-shadow:
        0 8px 25px
        rgba(0,0,0,.4);
}

.seat.current
.seat-card {

    border-color:
        var(--gold);

    box-shadow:
        0 0 25px
        rgba(244,197,66,.35);
}

.seat-avatar {

    width:
        30px;

    height:
        30px;

    margin:
        auto;

    display:
        grid;

    place-items:
        center;

    border-radius:
        50%;

    background:
        #303845;

    color:
        var(--gold);

    font-size:
        11px;

    font-weight:
        900;
}

.seat-name {

    margin-top:
        4px;

    font-size:
        12px;

    font-weight:
        900;
}

.seat-count {

    color:
        #8993a4;

    font-size:
        10px;

    margin-top:
        3px;
}

.card-backs {

    display:
        flex;

    justify-content:
        center;

    margin-top:
        5px;
}

.card-back {

    width:
        20px;

    height:
        29px;

    border:
        1px solid
        #d3af48;

    border-radius:
        4px;

    margin-left:
        -7px;

    background:
        repeating-linear-gradient(
            45deg,
            #26313b 0 3px,
            #121921 3px 6px
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

    gap:
        15px;

    align-items:
        center;

    justify-content:
        center;

    max-width:
        55%;

    z-index:
        4;
}

.play-group {

    text-align:
        center;
}

.play-name {

    font-size:
        10px;

    margin-bottom:
        5px;

    font-weight:
        800;
}

.play-group.winner
.card {

    border:
        2px solid
        var(--gold);

    box-shadow:
        0 0 20px
        var(--gold);
}

/* =========================================================
   CARDS
========================================================= */

.card {

    width:
        62px;

    height:
        90px;

    border-radius:
        8px;

    background:
        #fafaf7;

    color:
        #151515;

    border:
        1px solid
        #d5d5d5;

    box-shadow:
        0 6px 17px
        rgba(0,0,0,.55);

    padding:
        6px;

    display:
        flex;

    flex-direction:
        column;

    justify-content:
        space-between;

    user-select:
        none;

    font-weight:
        950;
}

.card.red {
    color:
        #ad1515;
}

.card-rank {

    font-size:
        14px;
}

.card-suit {

    text-align:
        center;

    font-size:
        29px;
}

.card-bottom {

    text-align:
        right;

    font-size:
        14px;

    transform:
        rotate(180deg);
}

/* =========================================================
   HAND
========================================================= */

.hand-wrap {

    width:
        min(1000px,100%);

    margin:
        18px auto 0;

    text-align:
        center;
}

.hand-title {

    color:
        #9aa3b1;

    font-size:
        12px;

    margin-bottom:
        8px;
}

#my-cards {

    min-height:
        105px;

    display:
        flex;

    justify-content:
        center;

    align-items:
        flex-end;

    flex-wrap:
        wrap;

    gap:
        8px;
}

#my-cards .card {

    cursor:
        pointer;

    transition:
        transform .14s,
        border .14s,
        box-shadow .14s;
}

#my-cards
.card:hover {

    transform:
        translateY(-7px);
}

#my-cards
.card.selected {

    transform:
        translateY(-14px);

    border:
        3px solid
        var(--gold);

    box-shadow:
        0 0 22px
        rgba(244,197,66,.65);
}

.play-btn {

    margin-top:
        12px;

    min-width:
        170px;

    height:
        43px;

    padding:
        0 28px;

    border:
        0;

    border-radius:
        10px;

    background:
        linear-gradient(
            135deg,
            #ffe15b,
            #ff9700
        );

    font-weight:
        950;

    color:
        #15100a;
}

.play-btn:disabled {

    background:
        #2e3540;

    color:
        #68717e;

    cursor:
        not-allowed;
}

/* =========================================================
   RESPONSIVE
========================================================= */

@media (
    max-width: 800px
) {

    .grid {
        grid-template-columns:
            1fr;
    }

    .table-board {

        height:
            480px;

        border-width:
            11px;
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

    .card-suit {
        font-size:
            23px;
    }

    #table-cards {
        max-width:
            70%;
    }
}

@media (
    max-width: 520px
) {

    .navbar {
        padding:
            0 13px;
    }

    .logo {
        font-size:
            17px;
    }

    .lobby-wrapper {
        padding:
            25px 12px;
    }

    .panel {
        padding:
            17px;
    }

    #game {
        padding:
            8px;
    }

    .table-board {

        height:
            420px;

        border-radius:
            47% / 30%;
    }

    .seat {

        width:
            92px;
    }

    .seat-card {
        padding:
            5px;
    }

    .seat-avatar {

        width:
            25px;

        height:
            25px;
    }

    .seat-name {
        font-size:
            10px;
    }

    .card {

        width:
            46px;

        height:
            68px;

        padding:
            4px;
    }

    .card-suit {
        font-size:
            19px;
    }

    .card-rank,
    .card-bottom {
        font-size:
            11px;
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
                <div id="nav-username">
                    სტუმარი
                </div>

                <small
                    id="nav-balance"
                    style="
                    color:#7f8998
                    "
                >
                    გაიარე რეგისტრაცია
                </small>
            </div>

            <div
                class="avatar"
                id="nav-avatar"
            >
                G
            </div>

        </div>

    </div>

    <div
        class="lobby-wrapper"
    >

        <div class="hero">

            <h1>
                BURA VIP CLUB
            </h1>

            <p>
                კლასიკური ბურა თანამედროვე ონლაინ მაგიდაზე
            </p>

        </div>

        <div class="grid">

            <!-- AUTH -->

            <div class="panel">

                <h2>
                    ანგარიში
                </h2>

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

                <!-- LOGIN -->

                <div
                    id="login-box"
                >

                    <div class="field">

                        <label>
                            Username
                        </label>

                        <input
                            id="login-username"
                            placeholder="შენი username"
                        />

                    </div>

                    <div class="field">

                        <label>
                            პაროლი
                        </label>

                        <input
                            id="login-password"
                            type="password"
                            placeholder="პაროლი"
                        />

                    </div>

                    <button
                        class="gold-btn"
                        onclick="loginUser()"
                    >
                        შესვლა
                    </button>

                </div>

                <!-- REGISTER -->

                <div
                    id="register-box"
                    class="hidden"
                >

                    <div class="field">

                        <label>
                            აირჩიე Username
                        </label>

                        <input
                            id="reg-username"
                            maxlength="20"
                            placeholder="მაგ: saba123"
                        />

                    </div>

                    <div class="field">

                        <label>
                            Email
                        </label>

                        <input
                            id="reg-email"
                            type="email"
                            placeholder="you@email.com"
                        />

                    </div>

                    <div class="field">

                        <label>
                            პაროლი
                        </label>

                        <input
                            id="reg-password"
                            type="password"
                            placeholder="მინიმუმ 6 სიმბოლო"
                        />

                    </div>

                    <button
                        class="gold-btn"
                        onclick="registerUser()"
                    >
                        რეგისტრაცია
                    </button>

                </div>

                <div
                    id="auth-message"
                    class="message"
                ></div>

            </div>

            <!-- TABLE -->

            <div class="panel">

                <h2>
                    მაგიდაზე შესვლა
                </h2>

                <div
                    class="panel-subtitle"
                >
                    თამაშამდე საჭიროა ანგარიში.
                </div>

                <div
                    id="logged-user-card"
                    class="user-card hidden"
                >

                    <div>
                        მოთამაშე:
                        <strong
                            id="logged-name"
                        ></strong>
                    </div>

                    <button
                        onclick="logout()"
                        style="
                            background:none;
                            border:0;
                            color:#ff6868;
                            font-weight:800;
                        "
                    >
                        გასვლა
                    </button>

                </div>

                <div class="field">

                    <label>
                        მოთამაშეების რაოდენობა
                    </label>

                    <select
                        id="capacity"
                    >

                        <option value="2">
                            2 მოთამაშე
                        </option>

                        <option value="3">
                            3 მოთამაშე
                        </option>

                        <option value="4">
                            4 მოთამაშე
                        </option>

                        <option value="5">
                            5 მოთამაშე
                        </option>

                        <option value="6">
                            6 მოთამაშე
                        </option>

                    </select>

                </div>

                <div class="field">

                    <label>
                        პარტიები
                    </label>

                    <select
                        id="parties"
                    >

                        <option value="1">
                            1 პარტია
                        </option>

                        <option value="2">
                            2 პარტია
                        </option>

                        <option value="3">
                            3 პარტია
                        </option>

                    </select>

                </div>

                <div class="field">

                    <label>
                        ფსონი
                    </label>

                    <select
                        id="stake"
                    >

                        <option value="1">
                            1
                        </option>

                        <option value="5">
                            5
                        </option>

                        <option value="10">
                            10
                        </option>

                        <option value="20">
                            20
                        </option>

                    </select>

                </div>

                <button
                    class="gold-btn"
                    onclick="joinTable()"
                >
                    თამაშის დაწყება
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

    <div
        class="game-header"
    >

        <div
            class="game-logo"
        >
            BURA VIP CLUB
        </div>

        <div
            class="game-info"
        >

            <div
                class="badge"
            >
                კოზირი:
                <b id="trump">
                    -
                </b>
            </div>

            <div
                class="badge"
            >
                პარტია:
                <b id="party-num">
                    -
                </b>
            </div>

            <div
                class="badge"
            >
                ხელი:
                <b id="hand-index">
                    -
                </b>
            </div>

            <div
                class="badge"
            >
                დასტა:
                <b id="deck-count">
                    -
                </b>
            </div>

        </div>

    </div>

    <div
        id="status"
    ></div>

    <div
        class="table-board"
    >

        <div
            class="table-logo"
        >
            BURA
        </div>

        <div
            id="players"
        ></div>

        <div
            id="table-cards"
        ></div>

    </div>

    <div
        class="hand-wrap"
    >

        <div
            class="hand-title"
        >
            შენი კარტები
        </div>

        <div
            id="my-cards"
        ></div>

        <button
            id="play-button"
            class="play-btn"
            disabled
            onclick="playSelectedCards()"
        >
            ჩამოსვლა
        </button>

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
        "bura_token"
    );

let username =
    localStorage.getItem(
        "bura_username"
    );

let balance =
    localStorage.getItem(
        "bura_balance"
    );

let currentState =
    null;

let selectedCards =
    [];

/* =========================================================
   INITIAL USER UI
========================================================= */

updateUserUI();

/* =========================================================
   AUTH UI
========================================================= */

function showLogin() {

    document
        .getElementById(
            "login-box"
        )
        .classList
        .remove(
            "hidden"
        );

    document
        .getElementById(
            "register-box"
        )
        .classList
        .add(
            "hidden"
        );

    document
        .getElementById(
            "login-tab"
        )
        .classList
        .add(
            "active"
        );

    document
        .getElementById(
            "register-tab"
        )
        .classList
        .remove(
            "active"
        );
}

function showRegister() {

    document
        .getElementById(
            "register-box"
        )
        .classList
        .remove(
            "hidden"
        );

    document
        .getElementById(
            "login-box"
        )
        .classList
        .add(
            "hidden"
        );

    document
        .getElementById(
            "register-tab"
        )
        .classList
        .add(
            "active"
        );

    document
        .getElementById(
            "login-tab"
        )
        .classList
        .remove(
            "active"
        );
}

/* =========================================================
   REGISTER
========================================================= */

async function registerUser() {

    const usernameInput =
        document
            .getElementById(
                "reg-username"
            )
            .value
            .trim();

    const email =
        document
            .getElementById(
                "reg-email"
            )
            .value
            .trim();

    const password =
        document
            .getElementById(
                "reg-password"
            )
            .value;

    setAuthMessage(
        "რეგისტრაცია...",
        false
    );

    try {

        const response =
            await fetch(
                "/api/register",
                {

                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            {

                                username:
                                    usernameInput,

                                email,

                                password
                            }
                        )
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
                "რეგისტრაცია ვერ შესრულდა.",
                true
            );

            return;
        }

        saveLogin(
            data
        );

        setAuthMessage(
            "რეგისტრაცია წარმატებით დასრულდა.",
            false
        );

    } catch (err) {

        console.error(
            err
        );

        setAuthMessage(
            "სერვერთან დაკავშირება ვერ მოხერხდა.",
            true
        );
    }
}

/* =========================================================
   LOGIN
========================================================= */

async function loginUser() {

    const usernameInput =
        document
            .getElementById(
                "login-username"
            )
            .value
            .trim();

    const password =
        document
            .getElementById(
                "login-password"
            )
            .value;

    setAuthMessage(
        "შესვლა...",
        false
    );

    try {

        const response =
            await fetch(
                "/api/login",
                {

                    method:
                        "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            {

                                username:
                                    usernameInput,

                                password
                            }
                        )
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
                "შესვლა ვერ შესრულდა.",
                true
            );

            return;
        }

        saveLogin(
            data
        );

        setAuthMessage(
            "წარმატებით შეხვედით.",
            false
        );

    } catch (err) {

        console.error(
            err
        );

        setAuthMessage(
            "სერვერთან დაკავშირება ვერ მოხერხდა.",
            true
        );
    }
}

function saveLogin(
    data
) {

    token =
        data.token;

    username =
        data.username;

    balance =
        data.balance;

    localStorage.setItem(
        "bura_token",
        token
    );

    localStorage.setItem(
        "bura_username",
        username
    );

    localStorage.setItem(
        "bura_balance",
        balance
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

    localStorage.removeItem(
        "bura_token"
    );

    localStorage.removeItem(
        "bura_username"
    );

    localStorage.removeItem(
        "bura_balance"
    );

    updateUserUI();

    setAuthMessage(
        "ანგარიშიდან გამოხვედი.",
        false
    );
}

function setAuthMessage(
    text,
    isError
) {

    const el =
        document.getElementById(
            "auth-message"
        );

    el.textContent =
        text;

    el.className =
        isError
            ?
            "message error"
            :
            "message";
}

/* =========================================================
   USER UI
========================================================= */

function updateUserUI() {

    const navName =
        document.getElementById(
            "nav-username"
        );

    const navBalance =
        document.getElementById(
            "nav-balance"
        );

    const avatar =
        document.getElementById(
            "nav-avatar"
        );

    const loggedCard =
        document.getElementById(
            "logged-user-card"
        );

    const loggedName =
        document.getElementById(
            "logged-name"
        );

    if (
        token &&
        username
    ) {

        navName.textContent =
            username;

        navBalance.textContent =
            "ბალანსი: " +
            (
                balance ?? 0
            );

        avatar.textContent =
            username
                .charAt(0)
                .toUpperCase();

        loggedName.textContent =
            username;

        loggedCard
            .classList
            .remove(
                "hidden"
            );

    } else {

        navName.textContent =
            "სტუმარი";

        navBalance.textContent =
            "გაიარე რეგისტრაცია";

        avatar.textContent =
            "G";

        loggedCard
            .classList
            .add(
                "hidden"
            );
    }
}

/* =========================================================
   JOIN TABLE
========================================================= */

function joinTable() {

    if (
        !token
    ) {

        setAuthMessage(
            "ჯერ გაიარე რეგისტრაცია ან შედი ანგარიშზე.",
            true
        );

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });

        return;
    }

    const capacity =
        document
            .getElementById(
                "capacity"
            )
            .value;

    const parties =
        document
            .getElementById(
                "parties"
            )
            .value;

    const stake =
        document
            .getElementById(
                "stake"
            )
            .value;

    document
        .getElementById(
            "waiting-message"
        )
        .textContent =
            "მაგიდას ვეძებთ...";

    socket.emit(
        "joinTable",
        {

            token,

            capacity,

            parties,

            stake
        }
    );
}

/* =========================================================
   SOCKET EVENTS
========================================================= */

socket.on(
    "waitingForPlayers",
    data => {

        document
            .getElementById(
                "waiting-message"
            )
            .textContent =
                "ველოდებით მოთამაშეებს: " +
                data.current +
                "/" +
                data.max;
    }
);

socket.on(
    "gameStateUpdate",
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
                "lobby"
            )
            .style
            .display =
                "none";

        document
            .getElementById(
                "game"
            )
            .style
            .display =
                "block";

        renderGame(
            state
        );
    }
);

socket.on(
    "errorMessage",
    message => {

        document
            .getElementById(
                "status"
            )
            .textContent =
                message;

        document
            .getElementById(
                "waiting-message"
            )
            .textContent =
                message;
    }
);

socket.on(
    "playerLeft",
    () => {

        document
            .getElementById(
                "status"
            )
            .textContent =
                "ერთ-ერთმა მოთამაშემ თამაში დატოვა.";
    }
);

/* =========================================================
   RENDER GAME
========================================================= */

function renderGame(
    state
) {

    document
        .getElementById(
            "trump"
        )
        .textContent =
            trumpName(
                state.trump
            );

    document
        .getElementById(
            "party-num"
        )
        .textContent =
            state.partyNum +
            "/" +
            state.targetParties;

    document
        .getElementById(
            "hand-index"
        )
        .textContent =
            state.handIndex;

    document
        .getElementById(
            "deck-count"
        )
        .textContent =
            state.deckCount;

    renderPlayers(
        state
    );

    renderTable(
        state
    );

    renderMyCards(
        state
    );

    updateStatus(
        state
    );
}

/* =========================================================
   PLAYERS
========================================================= */

function renderPlayers(
    state
) {

    const container =
        document
            .getElementById(
                "players"
            );

    container.innerHTML =
        "";

    const count =
        state.players.length;

    state.players.forEach(
        (
            player,
            index
        ) => {

            const seat =
                document
                    .createElement(
                        "div"
                    );

            seat.className =
                "seat" +
                (
                    player.isCurrent
                        ?
                        " current"
                        :
                        ""
                );

            const pos =
                seatPosition(
                    index,
                    count,
                    state.viewingPlayerId,
                    state.players
                );

            seat.style.left =
                pos.left + "%";

            seat.style.top =
                pos.top + "%";

            let backs =
                "";

            if (
                player.id !==
                state.viewingPlayerId
            ) {

                for (
                    let i = 0;

                    i <
                    player.cardCount;

                    i++
                ) {

                    backs +=
                        '<div class="card-back"></div>';
                }
            }

            seat.innerHTML =
                \`
                <div class="seat-card">

                    <div class="seat-avatar">
                        \${escapeHtml(
                            player.name
                                .charAt(0)
                                .toUpperCase()
                        )}
                    </div>

                    <div class="seat-name">
                        \${escapeHtml(
                            player.name
                        )}
                    </div>

                    <div class="seat-count">
                        კარტი:
                        \${player.cardCount}
                        · ქულა:
                        \${player.totalPoints}
                    </div>

                    <div class="card-backs">
                        \${backs}
                    </div>

                </div>
                \`;

            container.appendChild(
                seat
            );
        }
    );
}

/* =========================================================
   SEAT POSITION
========================================================= */

function seatPosition(
    playerIndex,
    playerCount,
    myId,
    players
) {

    let myIndex =
        players.findIndex(
            p =>
                p.id ===
                myId
        );

    if (
        myIndex < 0
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

        2: [
            {
                left: 50,
                top: 88
            },
            {
                left: 50,
                top: 12
            }
        ],

        3: [
            {
                left: 50,
                top: 88
            },
            {
                left: 20,
                top: 25
            },
            {
                left: 80,
                top: 25
            }
        ],

        4: [
            {
                left: 50,
                top: 88
            },
            {
                left: 12,
                top: 50
            },
            {
                left: 50,
                top: 12
            },
            {
                left: 88,
                top: 50
            }
        ],

        5: [
            {
                left: 50,
                top: 88
            },
            {
                left: 12,
                top: 60
            },
            {
                left: 25,
                top: 18
            },
            {
                left: 75,
                top: 18
            },
            {
                left: 88,
                top: 60
            }
        ],

        6: [
            {
                left: 50,
                top: 88
            },
            {
                left: 10,
                top: 64
            },
            {
                left: 18,
                top: 25
            },
            {
                left: 50,
                top: 12
            },
            {
                left: 82,
                top: 25
            },
            {
                left: 90,
                top: 64
            }
        ]
    };

    return (
        positions[
            playerCount
        ] || positions[2]
    )[
        relative
    ];
}

/* =========================================================
   TABLE CARDS
========================================================= */

function renderTable(
    state
) {

    const container =
        document
            .getElementById(
                "table-cards"
            );

    container.innerHTML =
        "";

    state.table.forEach(
        play => {

            const group =
                document
                    .createElement(
                        "div"
                    );

            group.className =
                "play-group" +
                (
                    play.isWinning
                        ?
                        " winner"
                        :
                        ""
                );

            const name =
                document
                    .createElement(
                        "div"
                    );

            name.className =
                "play-name";

            name.textContent =
                play.playerName;

            group.appendChild(
                name
            );

            play.cards.forEach(
                card => {

                    group.appendChild(
                        createCardElement(
                            card,
                            false
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
                "my-cards"
            );

    container.innerHTML =
        "";

    const myCards =
        state.playersCards[
            state.viewingPlayerId
        ] || [];

    myCards.forEach(
        (
            card,
            index
        ) => {

            const element =
                createCardElement(
                    card,
                    true
                );

            element.onclick =
                () =>
                    toggleCard(
                        index,
                        element
                    );

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
   CARD HTML
========================================================= */

function createCardElement(
    card,
    interactive
) {

    const div =
        document
            .createElement(
                "div"
            );

    const red =
        card.suit ===
        "hearts"
        ||
        card.suit ===
        "diamonds";

    div.className =
        "card" +
        (
            red
                ?
                " red"
                :
                ""
        );

    div.innerHTML =
        \`
        <div class="card-rank">
            \${escapeHtml(
                card.rank
            )}
            \${suitSymbol(
                card.suit
            )}
        </div>

        <div class="card-suit">
            \${suitSymbol(
                card.suit
            )}
        </div>

        <div class="card-bottom">
            \${escapeHtml(
                card.rank
            )}
            \${suitSymbol(
                card.suit
            )}
        </div>
        \`;

    return div;
}

/* =========================================================
   SELECT
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
        existing >= 0
    ) {

        selectedCards.splice(
            existing,
            1
        );

        element
            .classList
            .remove(
                "selected"
            );

    } else {

        selectedCards.push(
            index
        );

        element
            .classList
            .add(
                "selected"
            );
    }

    updatePlayButton(
        currentState
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
                "play-button"
            );

    if (
        !state
    ) {

        button.disabled =
            true;

        return;
    }

    const activePlayer =
        state.players[
            state.currentTurnIndex
        ];

    const myTurn =
        activePlayer
        &&
        activePlayer.id ===
        state.viewingPlayerId;

    button.disabled =
        !myTurn
        ||
        selectedCards.length ===
        0
        ||
        state.isProcessing;
}

function playSelectedCards() {

    if (
        selectedCards.length ===
        0
    ) {
        return;
    }

    socket.emit(
        "playCards",
        {

            cardIndices:
                selectedCards
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

    const status =
        document
            .getElementById(
                "status"
            );

    if (
        state.gameOver
    ) {

        status.textContent =
            "თამაში დასრულებულია.";

        return;
    }

    if (
        state.isProcessing
    ) {

        status.textContent =
            "სვლა დასრულდა...";

        return;
    }

    const activePlayer =
        state.players[
            state.currentTurnIndex
        ];

    if (
        !activePlayer
    ) {
        return;
    }

    if (
        activePlayer.id ===
        state.viewingPlayerId
    ) {

        status.textContent =
            "შენი სვლაა!";

    } else {

        status.textContent =
            activePlayer.name +
            "-ის სვლაა";
    }
}

/* =========================================================
   HELPERS
========================================================= */

function suitSymbol(
    suit
) {

    const map = {

        spades:
            "♠",

        clubs:
            "♣",

        hearts:
            "♥",

        diamonds:
            "♦"
    };

    return (
        map[suit] ||
        ""
    );
}

function trumpName(
    trump
) {

    if (
        trump ===
        "no_trump"
    ) {
        return "უკოზირო";
    }

    return suitSymbol(
        trump
    );
}

function escapeHtml(
    text
) {

    return String(
        text ?? ""
    )
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );
}

</script>

</body>

</html>
        `);
    }
);

/* =========================================================
   START SERVER
========================================================= */

server.listen(
    PORT,
    () => {

        console.log(
            "BURA VIP CLUB running on port " +
            PORT
        );

        console.log(
            "Deck cards:",
            createDeck().length
        );
    }
);
