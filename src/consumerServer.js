// consumerServer.js

const WebSocket = require('ws');
const readline = require('readline');

// Configuration
const TB_URL = 'ws://localhost:9000'; // Trading Broadcaster WebSocket URL

// Initialize WebSocket Client
let ws;

// Initialize Readline Interface for User Input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'Consumer> ',
});

// Function to Connect to the Trading Broadcaster
const connectToTB = () => {
  ws = new WebSocket(TB_URL);

  ws.on('open', () => {
    console.log(`Connected to Trading Broadcaster at ${TB_URL}`);
    rl.prompt();
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      if (message.symbol) {
        // Trade Data Received
        console.log(`\nTrade Data Received: Symbol=${message.symbol}, Price=${message.price}, Quantity=${message.quantity}, Timestamp=${message.timestamp}`);
      } else if (message.status) {
        // Response to Command
        console.log(`\nResponse: Status=${message.status}, Message=${message.message}`);
      } else {
        // Unknown Message
        console.log(`\nUnknown Message Received: ${data}`);
      }
    } catch (error) {
      console.error(`Error parsing message: ${error.message}`);
    }
    rl.prompt();
  });

  ws.on('close', () => {
    console.log('Disconnected from Trading Broadcaster. Attempting to reconnect in 5 seconds...');
    setTimeout(connectToTB, 5000); // Retry connection after 5 seconds
  });

  ws.on('error', (error) => {
    console.error(`WebSocket Error: ${error.message}`);
  });
};

// Function to Send Commands to the Trading Broadcaster
const sendCommand = (command) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(command));
  } else {
    console.log('Cannot send command. WebSocket is not open.');
  }
};

// Handle User Input Commands
const handleUserInput = (line) => {
  const args = line.trim().split(' ');
  const action = args[0];

  switch (action) {
    case 'add-provider':
      handleAddProvider(args.slice(1));
      break;
    case 'clear-providers':
      sendCommand({ action: 'clear-providers' });
      break;
    case 'clear-prices':
      sendCommand({ action: 'clear-prices' });
      break;
    case 'exit':
      console.log('Exiting Consumer Server...');
      ws.close();
      rl.close();
      process.exit(0);
      break;
    default:
      console.log(`Unknown command: ${action}`);
      console.log('Available commands: add-provider, clear-providers, clear-prices, exit');
  }

  rl.prompt();
};

// Handle the add-provider Command
const handleAddProvider = (args) => {
  if (args.length < 2) {
    console.log('Usage: add-provider <provider_url> <symbol1> <symbol2> ...');
    return;
  }

  const host = args[0];
  const symbols = args.slice(1);

  const command = {
    action: 'add-provider',
    host: host,
    symbols: symbols,
  };

  sendCommand(command);
};

// Start the Consumer Server
const startConsumer = () => {
  connectToTB();

  rl.prompt();

  rl.on('line', (line) => {
    handleUserInput(line);
  }).on('close', () => {
    console.log('Consumer Server closed.');
    process.exit(0);
  });
};

// Initialize the Consumer Server
startConsumer();
