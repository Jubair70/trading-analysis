// __tests__/tradingBroadcaster.test.js

const WebSocket = require("ws");

const { startServer, stopServer, consumers, providers } = require("./tradingBroadcaster");

const SERVER_PORT = 1001;
const TB_URL = `ws://localhost:${SERVER_PORT}`;

describe("Trading Broadcaster Tests", () => {
  let providerWs;
  let consumerWs;
  const providerURL = "ws://localhost:1002"; // Mock Provider URL

  // Sample Trade Data
  const tradeDataArray = [
    {
      'symbol': 'a631dc6c-ee85-458d-80d7-50018aedfbad',
      'price': 10.58,
      'quantity': 500,
      'timestampDifference': 0
    },
    {
      'symbol': '9e8bff74-50cd-4d80-900c-b5ce3bf371ee',
      'price': 18.58,
      'quantity': 1500,
      'timestampDifference': 1
    },
    {
      'symbol': 'a631dc6c-ee85-458d-80d7-50018aedfbad',
      'price': 11.0,
      'quantity': 1000,
      'timestampDifference': -500
    },
    {
      'symbol': 'a631dc6c-ee85-458d-80d7-50018aedfbad',
      'price': 15.0,
      'quantity': 500,
      'timestampDifference': 2
    },
    {
      'symbol': '4',
      'price': 9.0,
      'quantity': 1000,
      'timestampDifference': 3
    },
  ];

  // Helper function to create a timestamp based on timestampDifference
  const createTimestamp = (differenceInSeconds) => {
    const now = Math.floor(Date.now() / 1000);
    return now + differenceInSeconds;
  };

  beforeAll(async () => {
    // Start the Trading Broadcaster server
    await startServer(SERVER_PORT);

    // Start a Mock Provider Server
    const mockProviderServer = new WebSocket.Server({ port: 1002 }, () => {
      console.log("Mock Provider Server is listening on port 1002");
    });

    mockProviderServer.on('connection', (ws) => {
      providerWs = ws;
      console.log("Mock Provider connected to Trading Broadcaster.");

      // Send trade data after a short delay to ensure consumer is ready
      setTimeout(() => {
        tradeDataArray.forEach((trade, index) => {
          const tradeWithTimestamp = {
            symbol: trade.symbol,
            price: trade.price,
            quantity: trade.quantity,
            timestamp: createTimestamp(trade.timestampDifference),
          };
          ws.send(JSON.stringify(tradeWithTimestamp));
        });
      }, 500);
    });

    // Attach the mockProviderServer to the test context for cleanup
    global.mockProviderServer = mockProviderServer;

    // Start a Mock Consumer Client
    consumerWs = new WebSocket(TB_URL);

    // Wait for the consumer to connect before running tests
    await new Promise((resolve) => {
      consumerWs.on('open', () => {
        console.log("Mock Consumer connected to Trading Broadcaster.");
        // Subscribe to the mock provider and specific symbols
        const subscribeMessage = {
          action: 'add-provider',
          host: providerURL,
          symbols: ['4', '1', '2'], // '4' is valid; '1' and '2' are valid if present
        };
        consumerWs.send(JSON.stringify(subscribeMessage));
        resolve();
      });
    });
  });

  afterAll(async () => {
    // Close Consumer WebSocket
    if (consumerWs && consumerWs.readyState === WebSocket.OPEN) {
      consumerWs.close();
    }

    // Close Provider WebSocket
    if (providerWs && providerWs.readyState === WebSocket.OPEN) {
      providerWs.close();
    }

    // Close Mock Provider Server
    if (global.mockProviderServer) {
      global.mockProviderServer.close();
    }

    // Stop the Trading Broadcaster server
    await stopServer();
  });

  test("Consumer should receive only valid and latest trade data", (done) => {
    const expectedTrades = [
      // Only the last valid trade with symbol '4' should be received
      {
        symbol: '4',
        price: 9.0,
        quantity: 1000,
        timestampDifference: 3, // Adjusted to timestamp
      },
    ];

    const receivedTrades = [];

    consumerWs.on('message', (data) => {
      try {
        const trade = JSON.parse(data);
        // Filter out responses to 'add-provider' action
        if (trade.symbol && trade.price && trade.quantity && trade.timestamp) {
          receivedTrades.push(trade);
        }

        // After all trades are sent, validate the received trades
        if (receivedTrades.length === expectedTrades.length) {
          // Validate each received trade
          receivedTrades.forEach((trade, index) => {
            expect(trade.symbol).toBe(expectedTrades[index].symbol);
            expect(trade.price).toBe(expectedTrades[index].price);
            expect(trade.quantity).toBe(expectedTrades[index].quantity);
            // Timestamp validation can be more robust based on the test environment
            expect(trade.timestamp).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) - 10);
          });
          done();
        }
      } catch (error) {
        done(error);
      }
    });
  });

  test("Consumer should not receive trades with invalid symbols", (done) => {
    // Define that no trades with invalid symbols should be received
    const invalidSymbols = ['a631dc6c-ee85-458d-80d7-50018aedfbad', '9e8bff74-50cd-4d80-900c-b5ce3bf371ee'];

    const invalidTradesReceived = [];

    const checkInvalidTrades = () => {
      invalidTradesReceived.forEach((trade) => {
        expect(validSymbols.has(trade.symbol)).toBe(true);
      });
      done();
    };

    consumerWs.on('message', (data) => {
      try {
        const trade = JSON.parse(data);
        if (invalidSymbols.includes(trade.symbol)) {
          invalidTradesReceived.push(trade);
        }

        // Wait a short duration to ensure all messages are processed
        setTimeout(() => {
          checkInvalidTrades();
        }, 1000);
      } catch (error) {
        done(error);
      }
    });
  });

  test("Consumer should handle out-of-order trade data correctly", (done) => {
    // The third trade has a timestampDifference of -500 (older timestamp)
    // Ensure that it does not overwrite the latest trade for its symbol
    const symbol = '4';
    const tradesForSymbol = [
      {
        symbol: symbol,
        price: 9.0,
        quantity: 1000,
        timestampDifference: 3,
      },
      // Assuming another trade with symbol '4' arrives with a newer timestamp
      {
        symbol: symbol,
        price: 10.0,
        quantity: 500,
        timestampDifference: 5,
      },
      // And an older trade arrives
      {
        symbol: symbol,
        price: 8.5,
        quantity: 700,
        timestampDifference: -200,
      },
    ];

    const expectedTrades = [
      {
        symbol: symbol,
        price: 9.0,
        quantity: 1000,
        timestamp: createTimestamp(tradesForSymbol[0].timestampDifference),
      },
      {
        symbol: symbol,
        price: 10.0,
        quantity: 500,
        timestamp: createTimestamp(tradesForSymbol[1].timestampDifference),
      },
      // The third trade should not overwrite the latest trade
    ];

    const receivedTrades = [];

    // Send additional trades after initial subscription
    setTimeout(() => {
      tradesForSymbol.forEach((trade) => {
        const tradeWithTimestamp = {
          symbol: trade.symbol,
          price: trade.price,
          quantity: trade.quantity,
          timestamp: createTimestamp(trade.timestampDifference),
        };
        providerWs.send(JSON.stringify(tradeWithTimestamp));
      });
    }, 1000);

    consumerWs.on('message', (data) => {
      try {
        const trade = JSON.parse(data);
        if (trade.symbol === symbol && trade.price !== 9.0) {
          receivedTrades.push(trade);
        }

        // After all trades are sent, validate the latest trade
        if (receivedTrades.length === 1) {
          const latestTrade = receivedTrades[0];
          expect(latestTrade.symbol).toBe(symbol);
          expect(latestTrade.price).toBe(10.0);
          expect(latestTrade.quantity).toBe(500);
          done();
        }
      } catch (error) {
        done(error);
      }
    });
  });

});

// Helper function to create a timestamp based on timestampDifference
const createTimestamp = (differenceInSeconds) => {
  const now = Math.floor(Date.now() / 1000);
  return now + differenceInSeconds;
};
