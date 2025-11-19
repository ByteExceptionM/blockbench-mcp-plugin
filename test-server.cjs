#!/usr/bin/env node
/**
 * Standalone test server that mimics the Blockbench MCP server
 * Uses the same logic as index.ts
 */

const net = require('net');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

const port = 3000;
const endpoint = '/bb-mcp';

console.log('[Test Server] Creating MCP server instance...');
const currentServer = new McpServer({
  name: "Blockbench MCP Test",
  version: "1.0.0",
});

// Register a simple test tool
currentServer.tool({
  name: 'test_tool',
  description: 'A simple test tool',
  inputSchema: {
    type: 'object',
    properties: {},
  }
}, async () => {
  console.log('[Test Server] test_tool called!');
  return {
    content: [{ type: 'text', text: 'Test tool executed successfully!' }]
  };
});

console.log('[Test Server] Creating TCP server...');
const httpServer = net.createServer((socket) => {
  console.log('[Test Server] New socket connection established');
  let buffer = "";

  socket.on("data", async (chunk) => {
    console.log('[Test Server] Socket received data, chunk size:', chunk.length);
    buffer += chunk.toString();
    console.log('[Test Server] Current buffer size:', buffer.length);

    const headerEndIndex = buffer.indexOf("\r\n\r\n");
    if (headerEndIndex === -1) {
      console.log('[Test Server] Waiting for more data (headers not complete)');
      return;
    }

    console.log('[Test Server] Complete request received, parsing...');
    const headerSection = buffer.substring(0, headerEndIndex);
    const bodySection = buffer.substring(headerEndIndex + 4);
    console.log('[Test Server] Body section length:', bodySection.length);

    const lines = headerSection.split("\r\n");
    const [method, path] = lines[0].split(" ");
    console.log('[Test Server] Request method:', method, 'path:', path);

    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const colonIndex = lines[i].indexOf(":");
      if (colonIndex > 0) {
        const key = lines[i].substring(0, colonIndex).trim().toLowerCase();
        const value = lines[i].substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
    console.log('[Test Server] Parsed headers:', headers);

    if (method !== "POST" || path !== endpoint) {
      console.log('[Test Server] Rejecting request - wrong method or path');
      socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
      socket.end();
      return;
    }

    console.log('[Test Server] Request accepted, processing...');

    try {
      const jsonBody = JSON.parse(bodySection);
      console.log('[Test Server] Received request:', JSON.stringify(jsonBody, null, 2));

      const req = {
        method,
        url: path,
        headers,
        httpVersion: "1.1",
        httpVersionMajor: 1,
        httpVersionMinor: 1,
        complete: true,
        socket,
        on: () => {},
        once: () => {},
        emit: () => {},
        removeListener: () => {},
      };

      let headersSent = false;
      let statusCode = 200;
      let finished = false;
      const res = {
        get headersSent() {
          return headersSent;
        },
        get statusCode() {
          return statusCode;
        },
        set statusCode(code) {
          statusCode = code;
        },
        get finished() {
          return finished;
        },
        get writableEnded() {
          return finished;
        },
        get writableFinished() {
          return finished;
        },
        statusMessage: "OK",
        writeHead: (status, statusMessageOrHeaders, headers) => {
          if (headersSent) return res;
          headersSent = true;
          statusCode = status;
          console.log('[Test Server] writeHead called with status:', status);

          let actualHeaders = headers;
          if (typeof statusMessageOrHeaders === 'string') {
            res.statusMessage = statusMessageOrHeaders;
          } else if (statusMessageOrHeaders) {
            actualHeaders = statusMessageOrHeaders;
          }

          const statusText = status === 200 ? "OK" : status === 404 ? "Not Found" : "Internal Server Error";
          let response = `HTTP/1.1 ${status} ${statusText}\r\n`;

          if (actualHeaders) {
            for (const [key, value] of Object.entries(actualHeaders)) {
              response += `${key}: ${value}\r\n`;
            }
          }
          response += "\r\n";
          socket.write(response);
          console.log('[Test Server] Headers sent:', actualHeaders);
          return res;
        },
        flushHeaders: () => {
          if (!headersSent) {
            res.writeHead(statusCode);
          }
          return res;
        },
        write: (data, encodingOrCallback, callback) => {
          if (!headersSent) {
            res.writeHead(statusCode);
          }
          console.log('[Test Server] write called with data:', typeof data === 'string' ? data.substring(0, 200) : `Buffer(${data.length})`);
          socket.write(data);

          const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
          if (cb) {
            setTimeout(cb, 0);
          }
          return true;
        },
        end: (dataOrCallback, encodingOrCallback, callback) => {
          if (finished) {
            console.log('[Test Server] end called but already finished');
            return res;
          }

          if (!headersSent) {
            res.writeHead(statusCode);
          }

          let data = undefined;
          let cb = undefined;

          if (typeof dataOrCallback === 'function') {
            cb = dataOrCallback;
          } else {
            data = dataOrCallback;
            cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
          }

          console.log('[Test Server] end called with data:', data ? (typeof data === 'string' ? data.substring(0, 200) : `Buffer(${data.length})`) : 'no data');
          if (data) socket.write(data);
          socket.end();
          finished = true;

          if (cb) {
            setTimeout(cb, 0);
          }
          return res;
        },
        on: () => res,
        once: () => res,
        emit: () => true,
        removeListener: () => res,
        removeAllListeners: () => res,
        setHeader: () => res,
        getHeader: () => undefined,
        getHeaders: () => ({}),
        hasHeader: () => false,
        removeHeader: () => res,
        addTrailers: () => {},
        setTimeout: () => res,
      };

      console.log('[Test Server] Creating StreamableHTTPServerTransport...');
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      console.log('[Test Server] Transport created successfully');

      socket.on("close", () => {
        console.log('[Test Server] Socket closed, closing transport');
        transport.close();
      });

      console.log('[Test Server] Connecting transport to server...');
      console.log('[Test Server] Current server exists?', !!currentServer);

      try {
        await currentServer.connect(transport);
        console.log('[Test Server] Transport connected successfully!');
      } catch (err) {
        console.error('[Test Server] Error connecting transport:', err);
        throw err;
      }

      console.log('[Test Server] Calling transport.handleRequest...');
      console.log('[Test Server] Request object keys:', Object.keys(req));
      console.log('[Test Server] Response object keys:', Object.keys(res));
      console.log('[Test Server] JSON body:', jsonBody);

      try {
        await transport.handleRequest(req, res, jsonBody);
        console.log('[Test Server] transport.handleRequest completed successfully!');
      } catch (err) {
        console.error('[Test Server] Error in transport.handleRequest:', err);
        throw err;
      }

      console.log('[Test Server] Request handling finished');
      console.log('[Test Server] Headers sent?', headersSent);
      console.log('[Test Server] Finished?', finished);
    } catch (error) {
      console.error("[Test Server] Request handling error:", error);
      socket.write("HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\n\r\n");
      socket.write(JSON.stringify({ error: "Internal server error" }));
      socket.end();
    }
  });

  socket.on("error", (error) => {
    console.error("[Test Server] Socket error:", error);
  });

  socket.on("close", () => {
    console.log("[Test Server] Socket closed");
  });

  socket.on("end", () => {
    console.log("[Test Server] Socket ended");
  });
});

console.log('[Test Server] Starting httpServer.listen on port', port);
httpServer.listen(port, () => {
  console.log(`[Test Server] ✓ Server is now listening on http://localhost:${port}${endpoint}`);
  console.log('[Test Server] You can now run: node test-client.js');
});

httpServer.on("error", (error) => {
  console.error("[Test Server] Server error:", error);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n[Test Server] Shutting down...');
  httpServer.close();
  process.exit(0);
});
