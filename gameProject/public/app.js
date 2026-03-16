console.log('Card Pairs Game - Ready');

let socket = io();
let currentRoom = null;
let playerName = null;
let allRooms = [];

// DOM elements
const q = selector => document.querySelector(selector);

const roomContainer = q('#roomContainer');
const gameContainer = q('#gameContainer');
const playerNameInput = q('#playerName');
const roomIdInput = q('#roomId');
const createRoomBtn = q('#createRoomBtn');
const joinRoomBtn = q('#joinRoomBtn');
const listRoomsBtn = q('#listRoomsBtn');
const roomList = q('#roomList');
const leaveRoomBtn = q('#leaveRoomBtn');
const roomInfo = q('#roomInfo');
const turnIndicator = q('#turnIndicator');
const playersInfo = q('#playersInfo');
const gameBoard = q('#gameBoard');
const gameMessages = q('#gameMessages');

socket.on('message', message => {
    console.log('Server message:', message);
});

socket.on('roomCreated', data => {
    currentRoom = data.roomId;
    addMessage(data.message, 'success');
    showGameScreen();
    roomInfo.textContent = `Room: ${currentRoom}`;
});

socket.on('playerJoined', data => {
    addMessage(data.message, 'info');
});

socket.on('gameStarted', data => {
    addMessage(data.message, 'success');
});

socket.on('gameState', state => {
    if (gameContainer.classList.contains('hidden')) {
        showGameScreen();
        roomInfo.textContent = `Room: ${currentRoom}`;
    }
    
    updatePlayersInfo(state.players);
    
    const currentPlayer = state.players[state.currentPlayerIndex];
    if (currentPlayer) {
        turnIndicator.textContent = `Current Turn: ${currentPlayer.name}`;
    }
    
    updateGameBoard(state.deck, state.currentPlayerIndex, state.players);
    
    if (state.gameOver) {
        turnIndicator.textContent = 'Game Over!';
    }
});

socket.on('match', data => {
    addMessage(data.message, 'success');
});

socket.on('noMatch', data => {
    addMessage(data.message, 'info');
});

socket.on('gameOver', data => {
    addMessage(data.message, 'success');
    
    setTimeout(() => {
        const playAgain = confirm(`${data.message}\n\nWould you like to leave the room?`);
        if (playAgain) {
            leaveRoom();
        }
    }, 1000);
});

socket.on('playerLeft', data => {
    addMessage(data.message, 'warning');
});

socket.on('roomList', data => {
    displayRoomList(data.rooms);
});

socket.on('allRooms', data => {
    allRooms = data.rooms;
});

socket.on('error', data => {
    addMessage(data.message, 'error');
});

function showGameScreen() {
    roomContainer.classList.add('hidden');
    gameContainer.classList.remove('hidden');
}

function showRoomScreen() {
    gameContainer.classList.add('hidden');
    roomContainer.classList.remove('hidden');
    currentRoom = null;
    gameMessages.innerHTML = '';
}

function updatePlayersInfo(players) {
    playersInfo.innerHTML = '';
    
    players.forEach((player, index) => {
        const playerCard = document.createElement('div');
        playerCard.className = 'player-card';
        
        if (player.isCurrentPlayer) {
            playerCard.classList.add('active');
        }
        
        playerCard.innerHTML = `
            <div class="player-name">${player.name}</div>
            <div class="player-score">Score: ${player.score}</div>
        `;
        
        playersInfo.appendChild(playerCard);
    });
}

function updateGameBoard(deck, currentPlayerIndex, players) {
    gameBoard.innerHTML = '';
    
    deck.forEach(card => {
        const cardElement = document.createElement('div');
        cardElement.className = 'card';
        cardElement.dataset.id = card.id;
        
        if (card.matched) {
            cardElement.classList.add('matched');
            cardElement.textContent = card.symbol;
        } else if (card.flipped) {
            cardElement.classList.add('flipped');
            cardElement.textContent = card.symbol;
        } else {
            cardElement.innerHTML = '<span class="card-back">?</span>';
            cardElement.addEventListener('click', () => handleCardClick(card.id));
        }
        
        gameBoard.appendChild(cardElement);
    });
}

function handleCardClick(cardId) {
    if (!currentRoom) {
        addMessage('Not in a room', 'error');
        return;
    }
    
    socket.emit('flipCard', {
        roomId: currentRoom,
        cardId: cardId
    });
}

function addMessage(text, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = text;
    gameMessages.appendChild(messageDiv);
    
    gameMessages.scrollTop = gameMessages.scrollHeight;
    
    while (gameMessages.children.length > 10) {
        gameMessages.removeChild(gameMessages.firstChild);
    }
}

function displayRoomList(rooms) {
    roomList.innerHTML = '';
    
    if (rooms.length === 0) {
        roomList.innerHTML = '<p style="text-align: center; color: #999; padding: 20px;">No available rooms</p>';
        return;
    }
    
    rooms.forEach(room => {
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item';
        roomItem.innerHTML = `
            <div>
                <strong>${room.id}</strong><br>
                <small>Players: ${room.playerCount}/2</small>
            </div>
            <button onclick="quickJoinRoom('${room.id}')">Join</button>
        `;
        roomList.appendChild(roomItem);
    });
}

function checkRoomExists(roomName) {
    return allRooms.some(room => room.id === roomName);
}

function quickJoinRoom(roomId) {
    const name = playerNameInput.value.trim();
    
    if (!name) {
        alert('Please enter your name first');
        return;
    }
    
    playerName = name;
    currentRoom = roomId;
    roomIdInput.value = roomId;
    
    socket.emit('joinRoom', {
        roomId: roomId,
        playerName: name
    });
}

function leaveRoom() {
    showRoomScreen();
    socket.emit('getAllRooms');
}

function requestAllRooms() {
    socket.emit('getAllRooms');
}

// Event listeners
createRoomBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const room = roomIdInput.value.trim();
    
    if (!name) {
        alert('Please enter your name');
        return;
    }
    
    if (!room) {
        alert('Please enter a room name');
        return;
    }
    
    if (checkRoomExists(room)) {
        alert(`Room "${room}" already exists! Please choose a different room name or join the existing room.`);
        return;
    }
    
    playerName = name;
    currentRoom = room;
    
    socket.emit('createRoom', {
        roomId: room,
        playerName: name
    });
});

joinRoomBtn.addEventListener('click', () => {
    const name = playerNameInput.value.trim();
    const room = roomIdInput.value.trim();
    
    if (!name) {
        alert('Please enter your name');
        return;
    }
    
    if (!room) {
        alert('Please enter a room name');
        return;
    }
    
    playerName = name;
    currentRoom = room;
    
    socket.emit('joinRoom', {
        roomId: room,
        playerName: name
    });
});

listRoomsBtn.addEventListener('click', () => {
    socket.emit('listRooms');
});

leaveRoomBtn.addEventListener('click', () => {
    if (confirm('Are you sure you want to leave the room?')) {
        leaveRoom();
    }
});

playerNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createRoomBtn.click();
    }
});

roomIdInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        createRoomBtn.click();
    }
});

roomIdInput.addEventListener('input', () => {
    const room = roomIdInput.value.trim();
    if (room && checkRoomExists(room)) {
        roomIdInput.style.borderColor = '#dc3545';
        roomIdInput.style.backgroundColor = '#fff5f5';
    } else {
        roomIdInput.style.borderColor = '#ddd';
        roomIdInput.style.backgroundColor = 'white';
    }
});

// Request all rooms on page load
requestAllRooms();