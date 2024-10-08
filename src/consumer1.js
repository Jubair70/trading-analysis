const { WebSocket, WebSocketServer } = require("ws");
const http = require("http");

const server = http.createServer();

// broadcaster
const wss = new WebSocketServer({ server });

// Function to send responses to Consumers
const sendResponse = (ws, response) => {
  try {
    ws.send(JSON.stringify(response));
  } catch (error) {
    console.error("Error sending response to Consumer:", error.message);
  }
};

wss.on("connection", function connection(ws) {
  ws.on("error", console.error);

  ws.on("message", function message(data, isBinary) {
    let { action } = JSON.parse(data);
    console.log(" Data %s", data)
    if (action === "add-provider") {
        console.log("in consumer")
      let host = "ws://localhost:9000"
      console.log(`Connecting to TB: ${host}`);
      providerWs = new WebSocket(host);

      // Handle Provider Connection Open
    providerWs.on("open", () => {
      console.log(`Connected to TB: ${host}`);
      sendResponse(providerWs, JSON.parse(data));
    });
    
      providerWs.on('message', (message) => {
        console.log(" Message from provider %s",message)
      });

    }
    wss.clients.forEach(function each(client) {
        
        if (  client.readyState === WebSocket.OPEN) {
            
          
            client.send(data, { binary: isBinary });
          }
    
    })


    
  });
  // sendResponse(ws,{ "status": "processed", "message": "connected to ws://localhost:9001" })
});

server.listen(1001, function () {
  console.log(new Date() + " Server is listening on port 1001");
});
