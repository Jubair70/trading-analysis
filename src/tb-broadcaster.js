
const {WebSocket,WebSocketServer} = require('ws')
const http = require('http')
const util = require('util')


const server = http.createServer();

// broadcaster
const wss = new WebSocketServer({ server });
const validSymbols = [
  '1','2','3','4','5','6','7','8','9'
]

// Maps to manage Consumers and Providers
let consumers = new Map(); // Map<WebSocket, ConsumerData>
let providers = new Map(); // Map<ProviderURL, ProviderWebSocket>


// Function to send responses to Consumers
const sendResponse = (ws, response) => {
    try {
      ws.send(JSON.stringify(response));
    } catch (error) {
      console.error('Error sending response to Consumer:', error.message);
    }
  };

// Function to add a Provider to a Consumer
const addProvider = async (ws, data) => {
  
    const { host, symbols } = data;
    console.log("In the add Provider",host, symbols)
    if (!host || !Array.isArray(symbols)) {
      sendResponse(ws, { status: 'not processed', message: 'Invalid add-provider message format' });
      return;
    }

    
  
    // Validate symbols against Symbol API
    const filteredSymbols = symbols.filter(symbol => validSymbols.includes(symbol));
    console.log(" Filtered Symbols ", filteredSymbols)

    if (filteredSymbols.length === 0) {
      sendResponse(ws, { status: 'processed', message: `No valid symbols to subscribe for ${host}` });
      return;
    }
  
    let providerWs = providers.get(host);

    // console.log(" providerWs ", providerWs)
    if (!providerWs) {
      // Connect to the Provider
      console.log(`Connecting to Provider: ${host}`);
      providerWs = new WebSocket(host);
      
      
      // Handle Provider connection open
      providerWs.on('open', () => {
        console.log(`Connected to Provider: ${host}`);
        sendResponse(ws, { status: 'processed', message: `connected to ${host}` });
      });
  
      // Handle Provider messages
      providerWs.on('message', (msg) => {
        console.log(" Provider received %s",host, msg);
        handleProviderMessage(host, msg);
      });
  
      // Handle Provider errors
      providerWs.on('error', (err) => {
        console.error(`Error with Provider ${host}:`, err.message);
        sendResponse(ws, { status: 'not processed', message: `error connecting to ${host}` });
      });
  
      // Handle Provider disconnection
      providerWs.on('close', () => {
        console.log(`Provider disconnected: ${host}`);
        providers.delete(host);
        // Notify all Consumers subscribed to this Provider
        consumers.forEach((consumerData, consumerWs) => {
          if (consumerData.providers.has(host)) {
            consumerData.providers.delete(host);
            sendResponse(consumerWs, { status: 'processed', message: `provider ${host} disconnected` });
          }
        });
      });
  
      providers.set(host, providerWs);
      console.log("Providers ",providers)
    }
  
    // Update Consumer's provider symbols

    // console.log(`Initial Consumers ${host}:`, consumers);
    const consumerData = consumers.get(ws);
    if(consumerData)
{
  if (!consumerData.providers.has(host)) {
    consumerData.providers.set(host, new Set(filteredSymbols));
  } else {
    // console.log(" Inside ",consumerData.providers)
    const existingSymbols = consumerData.providers.get(host);
    filteredSymbols.forEach(symbol => existingSymbols.add(symbol));
    consumerData.providers.set(host,existingSymbols)
    // console.log(" Inside ",consumerData.providers.get(host))
  }
}
else {
  let temp = new Map()
  temp.set(host, new Set(filteredSymbols))
  consumers.set(ws,{
    "providers": temp
  })
}
    // console.log(" Consumers ",consumers)
    console.log(" Consumers ",util.inspect(consumers, false, null, true /* enable colors */))
    // console.log(`Updated Consumers ${host}:`, consumers);
    sendResponse(ws, { status: 'processed', message: `updated symbols for ${host}` });
  };

  const clearProviders = (ws) => {
    const consumerData = consumers.get(ws);
    if (!consumerData) return;
  
    consumerData.providers.forEach((symbols, host) => {
      // Check if other Consumers are using this Provider
      let isProviderUsed = false;
      consumers.forEach((data, clientWs) => {
        if (clientWs !== ws && data.providers.has(host)) {
          isProviderUsed = true;
        }
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

  const clearPrices = (ws) => {
    const consumerData = consumers.get(ws);
    if (consumerData) {
      consumerData.latestPrices.clear();
      console.log('Cleared all Prices for a Consumer.');
    }
  };

// handle comsumer
const handleConsumerMessage = async (ws, message) => {
    try {
      const data = JSON.parse(message);
      const action = data.action;
  
      switch (action) {
        case 'add-provider':
          await addProvider(ws, data);
          break;
        case 'clear-providers':
          try {
            clearProviders(ws);
            console.log(" Consumers ",util.inspect(consumers, false, null, true /* enable colors */))
          }
          catch(e){
            console.log(e)
          }
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
      console.log("Not Processed Error ",error)
      sendResponse(ws, { status: 'not processed', message: 'Invalid message format' });
    }
  };
  
// Function to handle messages from Providers
const handleProviderMessage = (host, message) => {
  try {
    const trade = JSON.parse(message);
    const { symbol, price, quantity, timestamp } = trade;
    console.log(" Provider Processing ",symbol, price, quantity, timestamp)
    if (!symbol || !price || !quantity || !timestamp) {
      console.warn(`Incomplete trade data from Provider ${host}:`, trade);
      return; // Ignore incomplete data
    }
    

    // Broadcast to relevant Consumers
    consumers.forEach((consumerData, consumerWs) => {
      const subscribedSymbols = consumerData.providers.get(host);
      console.log(" consumerData ",consumerData)
      if (subscribedSymbols && subscribedSymbols.has(symbol)) {
        // Check and update latest price based on timestamp
        if("latestPrices" in consumerData){
        const existingTrade = consumerData.latestPrices.get(symbol);
        if (!existingTrade || timestamp > existingTrade.timestamp) {
          consumerData.latestPrices.set(symbol, trade);
          consumerWs.send(JSON.stringify(trade));
        }
      }
      else{
       
        let latestPrices = new Map()
        latestPrices.set(symbol, trade)
        consumerData.latestPrices = latestPrices
        // consumers = {...consumers,consumerData}
        consumerWs.send(JSON.stringify(trade));
      }
      }
    });
  } catch (error) {
    console.error(`Error processing message from Provider ${host}:`, error.message);
  }

  console.log(" Consumers ",util.inspect(consumers, false, null, true /* enable colors */))
};




// connection
  wss.on('connection', function connection(ws) {
    ws.on('error', console.error);
  
    // ws.on('message', function message(data, isBinary) {
    //   wss.clients.forEach(function each(client) {
    //     if (client.readyState === WebSocket.OPEN) {
    //       client.send(data, { binary: isBinary });
    //     }
    //   });
    // });
  
    // Handle incoming messages from Consumers
    ws.on('message', (message) => {
      handleConsumerMessage(ws, message);
    });
  
    //ws.send('Hello! Message From Server!!');
  });
  
  server.listen(9000, function() {
      console.log((new Date()) + ' Server is listening on port 9000');
  });
  

  exports.providers = providers
  exports.consumers = consumers