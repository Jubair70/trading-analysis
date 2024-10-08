const {WebSocket,WebSocketServer} = require('ws')
const http = require('http')

const server = http.createServer();

// broadcaster
const wss = new WebSocketServer({ server });

// Function to send responses to Consumers
const sendResponse = (ws, response) => {
    try {
      ws.send(JSON.stringify(response));
    } catch (error) {
      console.error('Error sending response to Consumer:', error.message);
    }
  };

wss.on('connection', function connection(ws) {
  ws.on('error', console.error);
});



server.listen(9002, function() {
    console.log((new Date()) + ' Server is listening on port 9001');
});