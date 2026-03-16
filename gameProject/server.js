const path = require('path');
const http = require('http');
const express = require('express');
const socketio = require('socket.io');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = socketio(server);

const rooms = new Map();
const CARD_SYMBOLS = ['♠', '♥', '♦', '♣', 'A', 'K', 'Q', 'J'];

// Helper function to get local IP
function getLocalIPAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

// Generate shuffled deck of cards
function generateDeck() {
    const deck = [...CARD_SYMBOLS, ...CARD_SYMBOLS];
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck.map((symbol, index) => ({
        id: index,
        symbol: symbol,
        matched: false,
        flipped: false
    }));
}

// Create a new room
function createRoom(roomId, playerName, socketId) {
    const room = {
        id: roomId,
        players: [{ name: playerName, socketId: socketId, score: 0 }],
        deck: generateDeck(),
        currentPlayerIndex: 0,
        flippedCards: [],
        gameStarted: false,
        gameOver: false
    };
    rooms.set(roomId, room);
    return room;
}

// Broadcast to all players in a room
function broadcastToRoom(roomId, event, data) {
    const room = rooms.get(roomId);
    if (room) {
        room.players.forEach(player => {
            io.to(player.socketId).emit(event, data);
        });
    }
}

// Send game state to all players in room
function sendGameState(roomId) {
    const room = rooms.get(roomId);
    if (!room) return;

    const gameState = {
        deck: room.deck.map(card => ({
            id: card.id,
            symbol: card.matched || card.flipped ? card.symbol : null,
            matched: card.matched,
            flipped: card.flipped
        })),
        players: room.players.map((p, idx) => ({
            name: p.name,
            score: p.score,
            isCurrentPlayer: idx === room.currentPlayerIndex
        })),
        currentPlayerIndex: room.currentPlayerIndex,
        gameStarted: room.gameStarted,
        gameOver: room.gameOver
    };

    broadcastToRoom(roomId, 'gameState', gameState);
}

// Get all available rooms
function getAllRooms() {
    return Array.from(rooms.values()).map(room => ({
        id: room.id,
        playerCount: room.players.length,
        gameStarted: room.gameStarted
    }));
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`New client connected: ${socket.id}`);

    socket.emit('message', 'Connected to Card Pairs Game Server');

    // Handle create room
    socket.on('createRoom', (data) => {
        const { roomId, playerName } = data;

        if (rooms.has(roomId)) {
            socket.emit('error', { message: 'Room already exists. Please choose a different room name.' });
            return;
        }

        createRoom(roomId, playerName, socket.id);
        socket.join(roomId);

        socket.emit('roomCreated', {
            roomId: roomId,
            playerName: playerName,
            message: 'Room created successfully! Waiting for another player...'
        });

        sendGameState(roomId);
        io.emit('allRooms', { rooms: getAllRooms() });
    });

    // Handle join room
    socket.on('joinRoom', (data) => {
        const { roomId, playerName } = data;
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('error', { message: 'Room not found. Please check the room name.' });
            return;
        }

        if (room.players.length >= 2) {
            socket.emit('error', { message: 'Room is full. Only 2 players allowed.' });
            return;
        }

        if (room.gameStarted) {
            socket.emit('error', { message: 'Game already in progress.' });
            return;
        }

        room.players.push({ name: playerName, socketId: socket.id, score: 0 });
        socket.join(roomId);

        broadcastToRoom(roomId, 'playerJoined', {
            playerName: playerName,
            message: `${playerName} joined the room!`
        });

        room.gameStarted = true;

        broadcastToRoom(roomId, 'gameStarted', {
            message: 'Game started! Player 1 goes first.'
        });

        sendGameState(roomId);
        io.emit('allRooms', { rooms: getAllRooms() });
    });

    // Handle flip card
    socket.on('flipCard', (data) => {
        const { roomId, cardId } = data;
        const room = rooms.get(roomId);

        if (!room) {
            socket.emit('error', { message: 'Room not found.' });
            return;
        }

        if (!room.gameStarted) {
            socket.emit('error', { message: 'Game has not started yet.' });
            return;
        }

        if (room.gameOver) {
            socket.emit('error', { message: 'Game is over.' });
            return;
        }

        const currentPlayer = room.players[room.currentPlayerIndex];
        if (currentPlayer.socketId !== socket.id) {
            socket.emit('error', { message: 'Not your turn!' });
            return;
        }

        const card = room.deck.find(c => c.id === cardId);

        if (!card || card.matched || card.flipped) {
            socket.emit('error', { message: 'Invalid card selection.' });
            return;
        }

        card.flipped = true;
        room.flippedCards.push(card);
        sendGameState(roomId);

        if (room.flippedCards.length === 2) {
            const [card1, card2] = room.flippedCards;

            if (card1.symbol === card2.symbol) {
                setTimeout(() => {
                    card1.matched = true;
                    card2.matched = true;
                    card1.flipped = false;
                    card2.flipped = false;

                    currentPlayer.score++;

                    broadcastToRoom(roomId, 'match', {
                        message: `${currentPlayer.name} found a match!`
                    });

                    room.flippedCards = [];

                    if (room.deck.every(c => c.matched)) {
                        room.gameOver = true;

                        const winner = room.players.reduce((prev, current) =>
                            prev.score > current.score ? prev : current
                        );

                        const isTie = room.players[0].score === room.players[1].score;

                        broadcastToRoom(roomId, 'gameOver', {
                            winner: isTie ? null : winner.name,
                            message: isTie
                                ? `Game Over! It's a TIE! Both players scored ${room.players[0].score} points!`
                                : `Game Over! ${winner.name} wins with ${winner.score} points!`
                        });
                    }

                    sendGameState(roomId);
                }, 1000);
            } else {
                setTimeout(() => {
                    card1.flipped = false;
                    card2.flipped = false;
                    room.flippedCards = [];

                    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;

                    const nextPlayer = room.players[room.currentPlayerIndex];
                    broadcastToRoom(roomId, 'noMatch', {
                        message: `No match. ${nextPlayer.name}'s turn!`
                    });

                    sendGameState(roomId);
                }, 1500);
            }
        }
    });

    // Handle list rooms
    socket.on('listRooms', () => {
        const availableRooms = Array.from(rooms.values())
            .filter(room => room.players.length < 2 && !room.gameStarted)
            .map(room => ({
                id: room.id,
                playerCount: room.players.length
            }));

        socket.emit('roomList', { rooms: availableRooms });
    });

    // Handle get all rooms
    socket.on('getAllRooms', () => {
        socket.emit('allRooms', { rooms: getAllRooms() });
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);

        rooms.forEach((room, roomId) => {
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);

            if (playerIndex !== -1) {
                const playerName = room.players[playerIndex].name;
                room.players.splice(playerIndex, 1);

                if (room.players.length === 0) {
                    rooms.delete(roomId);
                } else {
                    broadcastToRoom(roomId, 'playerLeft', {
                        message: `${playerName} left the game. Room is now available for new players.`
                    });

                    room.deck = generateDeck();
                    room.currentPlayerIndex = 0;
                    room.flippedCards = [];
                    room.gameStarted = false;
                    room.gameOver = false;
                    room.players[0].score = 0;

                    sendGameState(roomId);
                }

                io.emit('allRooms', { rooms: getAllRooms() });
            }
        });
    });
});

// Start server
server.listen(PORT, () => {
    const localIP = getLocalIPAddress();
    console.log('CARD PAIRS GAME SERVER RUNNING');
    console.log(`\nLocal Access:`);
    console.log(`   http://localhost:${PORT}`);
    console.log(`\nNetwork Access:`);
    console.log(`   http://${localIP}:${PORT}`);
});