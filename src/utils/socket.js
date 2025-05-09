// socket.js
import { io } from 'socket.io-client';

const socket = io('https://localhost:3000/mediasoup', {
  transports: ['websocket'],
  secure: true,
  rejectUnauthorized: false,
});

export default socket;
