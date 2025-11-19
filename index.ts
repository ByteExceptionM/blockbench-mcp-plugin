/**
 * @author jasonjgardner
 * @discord jason.gardner
 * @github https://github.com/jasonjgardner
 */
/// <reference types="three" />
/// <reference types="blockbench-types" />
import { VERSION } from "@/lib/constants";
import { getServer } from "@/server/server";
import { tools } from "@/lib/factories";
import { resources, prompts } from "@/server";
import { uiSetup, uiTeardown } from "@/ui";
import { settingsSetup, settingsTeardown } from "@/ui/settings";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Import tools to ensure they're registered
import "@/server/tools";

let currentServer: McpServer | null = null;
let currentTransport: StreamableHTTPServerTransport | null = null;
let expressApp: any = null;
let httpServer: any = null;

BBPlugin.register("mcp", {
  version: VERSION,
  title: "MCP Server",
  author: "Jason J. Gardner",
  description: "Plugin to run an MCP server inside Blockbench.",
  tags: ["MCP", "Server", "Protocol"],
  icon: "settings_ethernet",
  variant: "both",
  async onload() {
    console.log('[MCP Plugin] Starting onload...');
    settingsSetup();

    console.log('[MCP Plugin] Getting server instance...');
    currentServer = getServer();
    console.log('[MCP Plugin] Server instance created:', !!currentServer);
    console.log('[MCP Plugin] Server type:', currentServer.constructor.name);
    console.log('[MCP Plugin] Server has registerTool?', typeof currentServer.registerTool === 'function');

    console.log('[MCP Plugin] Setting up UI...');
    uiSetup({
      server: currentServer,
      tools,
      resources,
      prompts,
    });
    console.log('[MCP Plugin] UI setup complete');

    // Start TCP server using net module (HTTP over raw TCP)
    console.log('[MCP Plugin] Starting TCP server setup...');
    try {
      console.log('[MCP Plugin] Requiring net module...');
      const net = requireNativeModule("net");
      
      if (!net) {
        console.error('[MCP Plugin] Net module not available!');
        throw new Error("Net module not available");
      }
      console.log('[MCP Plugin] Net module loaded successfully');

      const port = Settings.get("mcp_port") || 3000;
      const endpoint = Settings.get("mcp_endpoint") || "/bb-mcp";
      console.log('[MCP Plugin] Configuration - Port:', port, 'Endpoint:', endpoint);

      // Create TCP server and manually handle HTTP
      httpServer = net.createServer((socket: any) => {
        console.log('[MCP Server] New socket connection established');
        let buffer = "";

        socket.on("data", async (chunk: Buffer) => {
          console.log('[MCP Server] Socket received data, chunk size:', chunk.length);
          buffer += chunk.toString();
          console.log('[MCP Server] Current buffer size:', buffer.length);

          // Check if we have complete HTTP request (ends with \r\n\r\n for headers)
          const headerEndIndex = buffer.indexOf("\r\n\r\n");
          if (headerEndIndex === -1) {
            console.log('[MCP Server] Waiting for more data (headers not complete)');
            return; // Wait for more data
          }

          console.log('[MCP Server] Complete request received, parsing...');
          const headerSection = buffer.substring(0, headerEndIndex);
          const bodySection = buffer.substring(headerEndIndex + 4);
          console.log('[MCP Server] Body section length:', bodySection.length);

          // Parse HTTP request line and headers
          const lines = headerSection.split("\r\n");
          const [method, path] = lines[0].split(" ");
          console.log('[MCP Server] Request method:', method, 'path:', path);

          // Parse headers
          const headers: Record<string, string> = {};
          for (let i = 1; i < lines.length; i++) {
            const colonIndex = lines[i].indexOf(":");
            if (colonIndex > 0) {
              const key = lines[i].substring(0, colonIndex).trim().toLowerCase();
              const value = lines[i].substring(colonIndex + 1).trim();
              headers[key] = value;
            }
          }
          console.log('[MCP Server] Parsed headers:', headers);

          // Only handle POST to our endpoint
          if (method !== "POST" || path !== endpoint) {
            console.log('[MCP Server] Rejecting request - wrong method or path');
            socket.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n");
            socket.end();
            return;
          }

          console.log('[MCP Server] Request accepted, processing...');
          
          try {
            const jsonBody = JSON.parse(bodySection);
            console.log('[MCP Server] Received request:', JSON.stringify(jsonBody, null, 2));

            // Create mock req/res objects for transport with more complete API
            const req: any = {
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
            const res: any = {
              get headersSent() {
                return headersSent;
              },
              get statusCode() {
                return statusCode;
              },
              set statusCode(code: number) {
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
              writeHead: (status: number, statusMessageOrHeaders?: any, headers?: any) => {
                if (headersSent) return res;
                headersSent = true;
                statusCode = status;
                console.log('[MCP Server] writeHead called with status:', status);

                // Handle both (status, headers) and (status, statusMessage, headers) signatures
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
                console.log('[MCP Server] Headers sent:', actualHeaders);
                return res;
              },
              flushHeaders: () => {
                if (!headersSent) {
                  res.writeHead(statusCode);
                }
                return res;
              },
              write: (data: string | Buffer, encodingOrCallback?: any, callback?: any) => {
                if (!headersSent) {
                  res.writeHead(statusCode);
                }
                console.log('[MCP Server] write called with data:', typeof data === 'string' ? data.substring(0, 200) : `Buffer(${data.length})`);
                socket.write(data);

                // Call callback if provided
                const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
                if (cb) {
                  setTimeout(cb, 0);
                }
                return true;
              },
              end: (dataOrCallback?: any, encodingOrCallback?: any, callback?: any) => {
                if (finished) {
                  console.log('[MCP Server] end called but already finished');
                  return res;
                }

                if (!headersSent) {
                  res.writeHead(statusCode);
                }

                // Handle different signatures of end()
                let data = undefined;
                let cb = undefined;

                if (typeof dataOrCallback === 'function') {
                  cb = dataOrCallback;
                } else {
                  data = dataOrCallback;
                  cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
                }

                console.log('[MCP Server] end called with data:', data ? (typeof data === 'string' ? data.substring(0, 200) : `Buffer(${data.length})`) : 'no data');
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
            
            // Create transport for this request
            console.log('[MCP Server] Creating StreamableHTTPServerTransport...');
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined,
              enableJsonResponse: true,
            });
            console.log('[MCP Server] Transport created successfully');

            // Add transport event listeners for debugging
            if (transport.onmessage) {
              const originalOnMessage = transport.onmessage;
              transport.onmessage = function(...args: any[]) {
                console.log('[MCP Server] Transport onmessage called with:', args);
                return originalOnMessage.apply(this, args);
              };
            }

            if (transport.onerror) {
              const originalOnError = transport.onerror;
              transport.onerror = function(...args: any[]) {
                console.log('[MCP Server] Transport onerror called with:', args);
                return originalOnError.apply(this, args);
              };
            }

            socket.on("close", () => {
              console.log('[MCP Server] Socket closed, closing transport');
              transport.close();
            });

            console.log('[MCP Server] Connecting transport to server...');
            console.log('[MCP Server] Current server exists?', !!currentServer);

            try {
              await currentServer?.connect(transport);
              console.log('[MCP Server] Transport connected successfully!');
            } catch (err) {
              console.error('[MCP Server] Error connecting transport:', err);
              throw err;
            }

            console.log('[MCP Server] Calling transport.handleRequest...');
            console.log('[MCP Server] Request object keys:', Object.keys(req));
            console.log('[MCP Server] Response object keys:', Object.keys(res));
            console.log('[MCP Server] JSON body:', jsonBody);

            try {
              // @ts-ignore - Our mocks have enough for the transport to work
              await transport.handleRequest(req, res, jsonBody);
              console.log('[MCP Server] transport.handleRequest completed successfully!');
            } catch (err) {
              console.error('[MCP Server] Error in transport.handleRequest:', err);
              throw err;
            }

            console.log('[MCP Server] Request handling finished');
            console.log('[MCP Server] Headers sent?', headersSent);
            console.log('[MCP Server] Finished?', finished);
          } catch (error) {
            console.error("Request handling error:", error);
            socket.write("HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\n\r\n");
            socket.write(JSON.stringify({ error: "Internal server error" }));
            socket.end();
          }
        });
        
        socket.on("error", (error: Error) => {
          console.error("[MCP Server] Socket error:", error);
        });

        socket.on("close", () => {
          console.log("[MCP Server] Socket closed");
        });

        socket.on("end", () => {
          console.log("[MCP Server] Socket ended");
        });
      });

      console.log('[MCP Plugin] Starting httpServer.listen on port', port);
      httpServer.listen(port, () => {
        console.log(`[MCP Plugin] ✓ Server is now listening on http://localhost:${port}${endpoint}`);
        Blockbench.showQuickMessage(`MCP Server started on port ${port}`, 2000);
      });

      httpServer.on("error", (error: Error) => {
        console.error("[MCP Plugin] Server error:", error);
        Blockbench.showMessageBox({
          title: "MCP Server Error",
          message: `Failed to start server: ${error.message}`,
        });
      });
    } catch (error) {
      console.error("Failed to start MCP server:", error);
      Blockbench.showMessageBox({
        title: "MCP Server Error",
        message: `Failed to initialize server: ${error}`,
      });
    }
  },

  onunload() {
    // Shutdown the server
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
    
    if (currentTransport) {
      currentTransport.close();
      currentTransport = null;
    }
    
    currentServer = null;
    expressApp = null;
    
    uiTeardown();
    settingsTeardown();
  },

  oninstall() {
    Blockbench.showQuickMessage("Installed MCP Server plugin", 2000);
    settingsSetup();
  },

  onuninstall() {
    Blockbench.showQuickMessage("Uninstalled MCP Server plugin", 2000);
    settingsTeardown();
  },
});
