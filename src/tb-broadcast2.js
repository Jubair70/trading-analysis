// tradingBroadcaster.js

const { WebSocket, WebSocketServer } = require('ws');
const http = require('http');
const util = require('util');

// Configuration
const SERVER_PORT = 9000;

// Initialize HTTP Server
const server = http.createServer();

// Initialize WebSocket Server
const wss = new WebSocketServer({ server });

// Define Valid Symbols as a Set for O(1) Lookup
const validSymbols = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9']);

// Maps to Manage Consumers and Providers
const consumers = new Map(); // Map<WebSocket, ConsumerData>
const providers = new Map(); // Map<ProviderURL, ProviderWebSocket>

/**
 * Sends a JSON response to a Consumer WebSocket.
 * @param {WebSocket} ws - The Consumer WebSocket.
 * @param {Object} response - The response object to send.
 */
const sendResponse = (ws, response) => {
  try {
    ws.send(JSON.stringify(response));
  } catch (error) {
    console.error('Error sending response to Consumer:', error.message);
  }
};

/**
 * Adds a Provider to a Consumer's subscription.
 * @param {WebSocket} ws - The Consumer WebSocket.
 * @param {Object} data - The data containing host and symbols.
 */
const addProvider = (ws, data) => {
  const { host, symbols } = data;

  console.log(`Received add-provider command: Host=${host}, Symbols=${symbols}`);

  // Validate Message Format
  if (!host || !Array.isArray(symbols)) {
    sendResponse(ws, { status: 'not processed', message: 'Invalid add-provider message format' });
    return;
  }

  // Filter Symbols Against Valid Symbols
  const filteredSymbols = symbols.filter(symbol => validSymbols.has(symbol));
  console.log(`Filtered Symbols for Host ${host}:`, filteredSymbols);

  if (filteredSymbols.length === 0) {
    sendResponse(ws, { status: 'processed', message: `No valid symbols to subscribe for ${host}` });
    return;
  }

  let providerWs = providers.get(host);

  if (!providerWs) {
    // Connect to the Provider if not already connected
    console.log(`Connecting to Provider: ${host}`);
    providerWs = new WebSocket(host);

    // Handle Provider Connection Open
    providerWs.on('open', () => {
      console.log(`Connected to Provider: ${host}`);
      sendResponse(ws, { status: 'processed', message: `connected to ${host}` });
    });

    // Handle Provider Messages
    providerWs.on('message', (msg) => {
      handleProviderMessage(host, msg);
    });

    // Handle Provider Errors
    providerWs.on('error', (err) => {
      console.error(`Error with Provider ${host}:`, err.message);
      sendResponse(ws, { status: 'not processed', message: `error connecting to ${host}` });
    });

    // Handle Provider Disconnection
    providerWs.on('close', () => {
      console.log(`Provider disconnected: ${host}`);
      providers.delete(host);
      notifyConsumersProviderDisconnected(host);
    });

    providers.set(host, providerWs);
    console.log('Current Providers:', util.inspect(providers, false, null, true));
  }

  // Update Consumer's Provider Symbols
  const consumerData = consumers.get(ws);

  if (consumerData) {
    if (!consumerData.providers.has(host)) {
      consumerData.providers.set(host, new Set(filteredSymbols));
    } else {
      const existingSymbols = consumerData.providers.get(host);
      filteredSymbols.forEach(symbol => existingSymbols.add(symbol));
    }
  } else {
    // Initialize Consumer Data if Not Present
    consumers.set(ws, {
      providers: new Map([[host, new Set(filteredSymbols)]]),
      latestPrices: new Map(),
    });
  }

  console.log('Updated Consumers:', util.inspect(consumers, false, null, true));
  sendResponse(ws, { status: 'processed', message: `updated symbols for ${host}` });
};

/**
 * Notifies all Consumers that a Provider has been disconnected.
 * @param {string} host - The Provider URL.
 */
const notifyConsumersProviderDisconnected = (host) => {
  consumers.forEach((consumerData, consumerWs) => {
    if (consumerData.providers.has(host)) {
      consumerData.providers.delete(host);
      sendResponse(consumerWs, { status: 'processed', message: `provider ${host} disconnected` });
    }
  });
};

/**
 * Clears all Providers subscribed by a Consumer.
 * @param {WebSocket} ws - The Consumer WebSocket.
 */
const clearProviders = (ws) => {
  const consumerData = consumers.get(ws);
  if (!consumerData) return;

  consumerData.providers.forEach((symbols, host) => {
    // Check if Other Consumers Are Using This Provider
    const isProviderUsed = Array.from(consumers.entries()).some(([clientWs, data]) => {
      return clientWs !== ws && data.providers.has(host);
    });

    if (!isProviderUsed) {
      const providerWs = providers.get(host);
      if (providerWs) {
        console.log(`Closing Provider connection: ${host}`);
        providerWs.close();
        providers.delete(host);
      }
    }
  });

  consumerData.providers.clear();
  console.log('Cleared all Providers for a Consumer.');
};

/**
 * Clears all Latest Prices stored for a Consumer.
 * @param {WebSocket} ws - The Consumer WebSocket.
 */
const clearPrices = (ws) => {
  const consumerData = consumers.get(ws);
  if (consumerData && consumerData.latestPrices) {
    consumerData.latestPrices.clear();
    console.log('Cleared all Prices for a Consumer.');
  }
};

/**
 * Handles incoming messages from Consumers.
 * @param {WebSocket} ws - The Consumer WebSocket.
 * @param {string} message - The incoming message.
 */
const handleConsumerMessage = (ws, message) => {
  try {
    const data = JSON.parse(message);
    const action = data.action;

    switch (action) {
      case 'add-provider':
        addProvider(ws, data);
        break;
      case 'clear-providers':
        clearProviders(ws);
        sendResponse(ws, { status: 'processed' });
        break;
      case 'clear-prices':
        clearPrices(ws);
        sendResponse(ws, { status: 'processed' });
        break;
      default:
        sendResponse(ws, { status: 'not processed', message: 'Unknown action' });
    }
  } catch (error) {
    console.error('Invalid message format:', error.message);
    sendResponse(ws, { status: 'not processed', message: 'Invalid message format' });
  }
};

/**
 * Handles incoming messages from Providers and broadcasts to relevant Consumers.
 * @param {string} host - The Provider URL.
 * @param {string} message - The incoming trade message.
 */
const handleProviderMessage = (host, message) => {
  try {
    const trade = JSON.parse(message);
    const { symbol, price, quantity, timestamp } = trade;

    console.log(`Processing trade from Provider ${host}:`, trade);

    // Validate Trade Data
    if (!symbol || !price || !quantity || !timestamp) {
      console.warn(`Incomplete trade data from Provider ${host}:`, trade);
      return; // Ignore incomplete data
    }

    // Broadcast to Relevant Consumers
    consumers.forEach((consumerData, consumerWs) => {
      const subscribedSymbols = consumerData.providers.get(host);
      if (subscribedSymbols && subscribedSymbols.has(symbol)) {
        const existingTrade = consumerData.latestPrices.get(symbol);
        if (!existingTrade || timestamp > existingTrade.timestamp) {
          consumerData.latestPrices.set(symbol, trade);
          consumerWs.send(JSON.stringify(trade));
        }
      }
    });
  } catch (error) {
    console.error(`Error processing message from Provider ${host}:`, error.message);
  }

  console.log('Current Consumers:', util.inspect(consumers, false, null, true));
};

// Handle New Consumer Connections
wss.on('connection', (ws) => {
  console.log('New Consumer connected.');

  // Initialize Consumer Data
  consumers.set(ws, {
    providers: new Map(),
    latestPrices: new Map(),
  });

  // Handle Incoming Messages from Consumers
  ws.on('message', (message) => {
    console.log(" Message from consumer %s",message)
    handleConsumerMessage(ws, message);
  });

  // Handle Consumer Disconnection
  ws.on('close', () => {
    console.log('Consumer disconnected.');
    clearProviders(ws);
    consumers.delete(ws);
  });

  // Handle Consumer Errors
  ws.on('error', (error) => {
    console.error('WebSocket error with Consumer:', error.message);
    clearProviders(ws);
    consumers.delete(ws);
  });
});

// Start the HTTP Server
server.listen(SERVER_PORT, () => {
  console.log(`Trading Broadcaster server is listening on port ${SERVER_PORT}`);
});

// Export Consumers and Providers Maps (Optional)
module.exports = { consumers, providers };
