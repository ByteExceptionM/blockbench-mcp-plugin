#!/usr/bin/env node
/**
 * Simple MCP test client to debug the Blockbench MCP server
 * Simulates what mcp-remote does
 */

const http = require('http');

const endpoint = 'http://localhost:3000/bb-mcp';

function sendRequest(data) {
  return new Promise((resolve, reject) => {
    const url = new URL(endpoint);
    const postData = JSON.stringify(data);

    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Accept': 'application/json, text/event-stream',
      }
    };

    console.log('\n[Test Client] Sending request:', JSON.stringify(data, null, 2));
    console.log('[Test Client] Options:', options);

    const req = http.request(options, (res) => {
      console.log(`[Test Client] Status: ${res.statusCode}`);
      console.log(`[Test Client] Headers:`, res.headers);

      let responseData = '';

      res.on('data', (chunk) => {
        responseData += chunk;
        console.log(`[Test Client] Received chunk:`, chunk.toString());
      });

      res.on('end', () => {
        console.log(`[Test Client] Response complete:`, responseData);
        try {
          const json = JSON.parse(responseData);
          resolve(json);
        } catch (e) {
          resolve(responseData);
        }
      });
    });

    req.on('error', (error) => {
      console.error(`[Test Client] Error:`, error);
      reject(error);
    });

    req.on('timeout', () => {
      console.error(`[Test Client] Request timed out`);
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.setTimeout(10000); // 10 second timeout

    req.write(postData);
    req.end();
  });
}

async function test() {
  console.log('=== Testing Blockbench MCP Server ===\n');

  try {
    // Test 1: Initialize
    console.log('\n--- Test 1: Initialize ---');
    const initResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: {
          name: 'test-client',
          version: '1.0.0'
        }
      }
    });
    console.log('[Test Client] Initialize response:', JSON.stringify(initResponse, null, 2));

    // Test 2: List tools
    console.log('\n--- Test 2: List Tools ---');
    const toolsResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {}
    });
    console.log('[Test Client] Tools list response:', JSON.stringify(toolsResponse, null, 2));

    // Test 3: Call a tool (blockbench_list_outline)
    console.log('\n--- Test 3: Call blockbench_list_outline ---');
    const callResponse = await sendRequest({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'blockbench_list_outline',
        arguments: {}
      }
    });
    console.log('[Test Client] Tool call response:', JSON.stringify(callResponse, null, 2));

    console.log('\n=== All tests completed ===');
  } catch (error) {
    console.error('\n=== Test failed ===');
    console.error(error);
    process.exit(1);
  }
}

test();
