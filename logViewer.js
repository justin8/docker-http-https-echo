const express = require('express');
const http = require('http');

let logClients = [];
const logHistory = [];
const MAX_LOG_HISTORY = 500;
let stdoutBuffer = '';
let stderrBuffer = '';

// Store the original stdout/stderr write functions so we can write to the actual console
const originalStdoutWrite = process.stdout.write;
const originalStderrWrite = process.stderr.write;

// Write output directly to terminal bypassing our interceptors (avoids recursion)
function consoleLogDirect(msg) {
  originalStdoutWrite.call(process.stdout, msg + '\n');
}

function consoleErrorDirect(msg) {
  originalStderrWrite.call(process.stderr, msg + '\n');
}

/**
 * Buffers chunks and extracts complete lines.
 * If a line is a JSON log, it parses it to send it structured.
 */
function handleStreamChunk(chunk, isErrorStream = false) {
  const streamType = isErrorStream ? 'error' : 'text';
  
  // Check if the entire incoming chunk is a complete JSON object (e.g. multi-line request echo)
  const trimmedChunk = chunk.trim();
  if (trimmedChunk.startsWith('{') && trimmedChunk.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmedChunk);
      const logItem = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        type: 'json',
        data: parsed,
        raw: chunk
      };
      saveAndBroadcast(logItem);
      return;
    } catch (e) {
      // Fall through to regular line-buffering if parsing fails
    }
  }

  let buffer = isErrorStream ? stderrBuffer : stdoutBuffer;
  buffer += chunk;
  const lines = buffer.split('\n');
  
  // Keep the last part if it doesn't end with a newline
  if (isErrorStream) {
    stderrBuffer = lines.pop();
  } else {
    stdoutBuffer = lines.pop();
  }
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    
    let logItem;
    // Check if the single line itself is a complete JSON object
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        logItem = {
          id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
          timestamp: new Date().toISOString(),
          type: 'json',
          data: parsed,
          raw: line
        };
      } catch (e) {
        // Fall back to text log if JSON parsing fails
      }
    }
    
    if (!logItem) {
      logItem = {
        id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
        timestamp: new Date().toISOString(),
        type: streamType,
        text: line
      };
    }
    
    saveAndBroadcast(logItem);
  }
}

function saveAndBroadcast(logItem) {
  logHistory.push(logItem);
  if (logHistory.length > MAX_LOG_HISTORY) {
    logHistory.shift();
  }
  
  const sseData = `data: ${JSON.stringify(logItem)}\n\n`;
  logClients.forEach(client => {
    try {
      client.write(sseData);
    } catch (err) {
      // Client connection issues are handled by close event, but catch here to be safe
    }
  });
}

/**
 * Intercept stdout and stderr writes.
 */
function startIntercept() {
  process.stdout.write = function (chunk, encoding, callback) {
    const str = chunk.toString();
    handleStreamChunk(str, false);
    return originalStdoutWrite.apply(process.stdout, arguments);
  };
  
  process.stderr.write = function (chunk, encoding, callback) {
    const str = chunk.toString();
    handleStreamChunk(str, true);
    return originalStderrWrite.apply(process.stderr, arguments);
  };
}

/**
 * Restores original write functions.
 */
function stopIntercept() {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
}

/**
 * Returns the HTML string of our premium dashboard.
 */
function getHTMLContent() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HTTP/HTTPS Echo Log Streamer</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-color: #0b0f19;
      --card-bg: rgba(30, 41, 59, 0.45);
      --border-color: rgba(255, 255, 255, 0.08);
      --accent-color: #8b5cf6;
      --accent-gradient: linear-gradient(135deg, #6366f1, #a855f7);
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      
      --color-get: #3b82f6;
      --color-post: #10b981;
      --color-put: #f59e0b;
      --color-delete: #ef4444;
      
      --color-status-2xx: #10b981;
      --color-status-3xx: #06b6d4;
      --color-status-4xx: #f97316;
      --color-status-5xx: #ef4444;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: 'Inter', sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    body::before {
      content: "";
      position: absolute;
      width: 100%;
      height: 100%;
      background-image: 
        radial-gradient(circle at 50% 50%, rgba(99, 102, 241, 0.06), transparent 60%),
        radial-gradient(circle at 10% 20%, rgba(168, 85, 247, 0.03), transparent 40%);
      pointer-events: none;
      z-index: -1;
    }

    header {
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border-color);
      padding: 0.85rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      z-index: 10;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .logo-icon {
      width: 2.2rem;
      height: 2.2rem;
      background: var(--accent-gradient);
      border-radius: 0.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 15px rgba(139, 92, 246, 0.4);
    }

    .logo-icon svg {
      width: 1.2rem;
      height: 1.2rem;
      fill: white;
    }

    .title-area h1 {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.02em;
      background: linear-gradient(to right, #fff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .title-area p {
      font-size: 0.75rem;
      color: var(--text-muted);
      margin-top: 0.1rem;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .status-badge {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(255, 255, 255, 0.03);
      padding: 0.4rem 0.8rem;
      border-radius: 9999px;
      border: 1px solid var(--border-color);
      font-size: 0.75rem;
      font-weight: 500;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      background-color: #ef4444;
      border-radius: 50%;
    }

    .status-dot.connected {
      background-color: #10b981;
      box-shadow: 0 0 8px #10b981;
      animation: pulse 2s infinite;
    }

    .status-dot.connecting {
      background-color: #fb5;
      box-shadow: 0 0 8px #fb5;
      animation: pulse 1.5s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.5); }
      70% { box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
      100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
    }

    main {
      flex: 1;
      display: grid;
      grid-template-columns: 290px 1fr;
      overflow: hidden;
    }

    .sidebar {
      background: rgba(15, 23, 42, 0.25);
      border-right: 1px solid var(--border-color);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
      overflow-y: auto;
    }

    .stats-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.75rem;
    }

    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 0.75rem;
      padding: 0.85rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      transition: all 0.3s ease;
    }

    .stat-card:hover {
      border-color: rgba(139, 92, 246, 0.2);
      transform: translateY(-1px);
    }

    .stat-title {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    .stat-value {
      font-size: 1.4rem;
      font-weight: 700;
      font-family: 'Fira Code', monospace;
    }

    .stat-card.total { border-left: 3px solid #8b5cf6; }
    .stat-card.echo { border-left: 3px solid #10b981; }
    .stat-card.error { border-left: 3px solid #ef4444; }

    .control-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .control-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .search-input {
      background: rgba(15, 23, 42, 0.5);
      border: 1px solid var(--border-color);
      border-radius: 0.5rem;
      padding: 0.6rem 0.8rem;
      color: white;
      font-family: inherit;
      font-size: 0.85rem;
      width: 100%;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--accent-color);
      box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.15);
    }

    .btn-group-vertical {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .btn {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--border-color);
      border-radius: 0.5rem;
      padding: 0.6rem 0.85rem;
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .btn:hover {
      background: rgba(255, 255, 255, 0.06);
      border-color: rgba(255, 255, 255, 0.15);
    }

    .btn.active {
      background: var(--accent-gradient);
      border-color: transparent;
      color: white;
      box-shadow: 0 4px 10px rgba(139, 92, 246, 0.2);
    }

    .btn-badge {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 9999px;
      padding: 0.1rem 0.4rem;
      font-size: 0.7rem;
      font-family: 'Fira Code', monospace;
      color: white;
    }

    .btn-primary {
      background: var(--accent-gradient);
      border-color: transparent;
      justify-content: center;
      font-weight: 600;
      color: white;
      box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25);
    }

    .btn-primary:hover {
      opacity: 0.95;
      transform: translateY(-1px);
    }

    .btn-outline {
      background: transparent;
      border: 1px solid rgba(239, 68, 68, 0.4);
      color: #f87171;
      justify-content: center;
      font-weight: 500;
    }

    .btn-outline:hover {
      background: rgba(239, 68, 68, 0.08);
      border-color: #ef4444;
    }

    .toggle-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 0.8rem;
      padding: 0.35rem 0;
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 32px;
      height: 18px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(255, 255, 255, 0.1);
      transition: .3s;
      border-radius: 18px;
    }

    .slider:before {
      position: absolute;
      content: "";
      height: 12px;
      width: 12px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
    }

    input:checked + .slider {
      background: var(--accent-gradient);
    }

    input:checked + .slider:before {
      transform: translateX(14px);
    }

    .terminal-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #040711;
      overflow: hidden;
      position: relative;
    }

    .terminal-header {
      background: rgba(10, 15, 30, 0.8);
      border-bottom: 1px solid var(--border-color);
      padding: 0.65rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      color: var(--text-muted);
      user-select: none;
    }

    .terminal-controls {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .terminal-body {
      flex: 1;
      padding: 1.5rem;
      overflow-y: auto;
      font-family: 'Fira Code', monospace;
      font-size: 0.85rem;
      line-height: 1.6;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      scroll-behavior: smooth;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-muted);
      gap: 0.75rem;
      user-select: none;
    }

    .empty-state svg {
      width: 2.5rem;
      height: 2.5rem;
      stroke: rgba(255, 255, 255, 0.12);
      stroke-width: 1.5;
    }

    .empty-state p {
      font-size: 0.85rem;
    }

    .log-row {
      display: flex;
      flex-direction: column;
      border-bottom: 1px solid rgba(255, 255, 255, 0.015);
      padding-bottom: 0.35rem;
      animation: fadeIn 0.1s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(2px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .log-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.7rem;
      color: var(--text-muted);
      margin-bottom: 0.15rem;
      user-select: none;
    }

    .log-time-tag {
      font-weight: 500;
    }

    .log-badge {
      padding: 0.05rem 0.35rem;
      border-radius: 0.25rem;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 0.6rem;
    }

    .log-badge.text {
      background: rgba(148, 163, 184, 0.08);
      color: var(--text-muted);
    }

    .log-badge.json {
      background: rgba(16, 185, 129, 0.1);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.15);
    }

    .log-badge.error {
      background: rgba(239, 68, 68, 0.1);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.15);
    }

    .log-content {
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* Parsed line coloring */
    .log-ip { color: #f43f5e; }
    .log-time { color: #64748b; }
    .log-method { font-weight: 700; border-radius: 3px; padding: 0px 4px; font-size: 0.75rem; }
    .log-method.method-get { background: rgba(59, 130, 246, 0.12); color: #60a5fa; }
    .log-method.method-post { background: rgba(16, 185, 129, 0.12); color: #34d399; }
    .log-method.method-put { background: rgba(245, 158, 11, 0.12); color: #fbbf24; }
    .log-method.method-delete { background: rgba(239, 68, 68, 0.12); color: #f87171; }
    .log-path { color: #e2e8f0; font-weight: 500; }
    .log-proto { color: #475569; }
    .log-status { font-weight: 700; }
    .log-status.status-2xx { color: #34d399; }
    .log-status.status-3xx { color: #22d3ee; }
    .log-status.status-4xx { color: #fb923c; }
    .log-status.status-5xx { color: #f87171; }
    .log-size { color: #64748b; }
    .log-system-info { color: #c084fc; font-weight: 500; }
    .log-system-error { color: #f87171; }

    /* Interactive JSON rendering */
    .json-summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      padding: 0.25rem 0.5rem;
      background: rgba(255, 255, 255, 0.02);
      border-radius: 0.375rem;
      border: 1px solid rgba(255, 255, 255, 0.04);
      width: fit-content;
      font-size: 0.8rem;
      user-select: none;
      transition: all 0.2s;
    }

    .json-summary:hover {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(139, 92, 246, 0.25);
    }

    .json-summary::before {
      content: "▶";
      display: inline-block;
      font-size: 0.6rem;
      color: var(--text-muted);
      transition: transform 0.2s;
    }

    .log-row.expanded .json-summary::before {
      transform: rotate(90deg);
    }

    .json-details {
      display: none;
      margin-top: 0.4rem;
      padding: 0.75rem 1rem;
      background: rgba(10, 15, 30, 0.4);
      border-left: 2px solid var(--accent-color);
      border-radius: 0 0.5rem 0.5rem 0;
      overflow-x: auto;
    }

    .log-row.expanded .json-details {
      display: block;
    }

    .json-tree {
      list-style-type: none;
    }

    .json-tree ul {
      list-style-type: none;
      padding-left: 1.25rem;
      border-left: 1px dashed rgba(255, 255, 255, 0.06);
      margin: 0.1rem 0;
    }

    .json-toggle {
      color: #94a3b8;
      cursor: pointer;
      font-weight: 600;
      user-select: none;
      padding: 0 0.1rem;
    }

    .json-toggle:hover {
      color: white;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 2px;
    }

    .json-key {
      color: #a5b4fc;
      font-weight: 500;
    }

    .json-string {
      color: #34d399;
    }

    .json-number {
      color: #fbbf24;
    }

    .json-boolean {
      color: #c084fc;
    }

    .json-null {
      color: #64748b;
      font-style: italic;
    }

    /* Toast styles */
    .toast {
      position: absolute;
      bottom: 1.5rem;
      right: 1.5rem;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid var(--accent-color);
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 0 15px rgba(139, 92, 246, 0.15);
      border-radius: 0.5rem;
      padding: 0.75rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      transform: translateY(100px);
      opacity: 0;
      transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 100;
      font-size: 0.85rem;
      pointer-events: none;
    }

    .toast.show {
      transform: translateY(0);
      opacity: 1;
    }

    .toast svg {
      width: 1.1rem;
      height: 1.1rem;
      stroke: #10b981;
      stroke-width: 2.5;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H7c0-2.76 2.24-5 5-5s5 2.24 5 5c0 1.04-.42 1.99-1.07 2.75z"/>
        </svg>
      </div>
      <div class="title-area">
        <h1>HTTP/HTTPS Echo Log Streamer</h1>
        <p>Live debugging traffic console & terminal logger</p>
      </div>
    </div>
    
    <div class="header-actions">
      <div class="status-badge">
        <div id="status-dot" class="status-dot disconnected"></div>
        <span id="status-text">Disconnected</span>
      </div>
    </div>
  </header>

  <main>
    <div class="sidebar">
      <div class="stats-grid">
        <div class="stat-card total">
          <span class="stat-title">Total Logs</span>
          <span class="stat-value" id="stat-total">0</span>
        </div>
        <div class="stat-card echo">
          <span class="stat-title">Echo Requests</span>
          <span class="stat-value" id="stat-echoes">0</span>
        </div>
        <div class="stat-card error">
          <span class="stat-title">Errors</span>
          <span class="stat-value" id="stat-errors">0</span>
        </div>
      </div>

      <div class="control-group">
        <span class="control-label">Search / Filter</span>
        <input type="text" id="search-input" class="search-input" placeholder="Type keyword or pattern...">
      </div>

      <div class="control-group">
        <span class="control-label">View Category</span>
        <div class="btn-group-vertical">
          <button class="btn active" id="btn-filter-all">
            All Logs
            <span class="btn-badge" id="badge-all">0</span>
          </button>
          <button class="btn" id="btn-filter-json">
            Echo Requests
            <span class="btn-badge" id="badge-json">0</span>
          </button>
          <button class="btn" id="btn-filter-text">
            Standard Output
            <span class="btn-badge" id="badge-text">0</span>
          </button>
          <button class="btn" id="btn-filter-error">
            Errors & Warnings
            <span class="btn-badge" id="badge-error">0</span>
          </button>
        </div>
      </div>

      <div class="control-group">
        <span class="control-label">Preferences</span>
        <div class="toggle-option">
          <span>Auto Scroll</span>
          <label class="switch">
            <input type="checkbox" id="toggle-scroll" checked>
            <span class="slider"></span>
          </label>
        </div>
        <div class="toggle-option">
          <span>Wrap Lines</span>
          <label class="switch">
            <input type="checkbox" id="toggle-wrap" checked>
            <span class="slider"></span>
          </label>
        </div>
        <div class="toggle-option">
          <span>Show Timestamps</span>
          <label class="switch">
            <input type="checkbox" id="toggle-timestamps" checked>
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="control-group" style="margin-top: auto;">
        <button class="btn btn-primary" id="btn-test-request">
          ⚡ Trigger Test Request
        </button>
        <button class="btn btn-outline" id="btn-clear">
          Clear Screen
        </button>
      </div>
    </div>

    <div class="terminal-container">
      <div class="terminal-header">
        <span>CONSOLE OUTPUT</span>
        <div class="terminal-controls">
          <span id="rendered-count">Showing 0 logs</span>
        </div>
      </div>
      
      <div class="terminal-body" id="terminal-body">
        <div class="empty-state" id="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p>Awaiting incoming requests and logs...</p>
        </div>
      </div>
    </div>
  </main>

  <div class="toast" id="toast">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
      <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>Test Request Sent successfully!</span>
  </div>

  <script>
    const allLogs = [];
    let activeFilter = 'all';
    let searchQuery = '';
    
    // UI Elements
    const terminalBody = document.getElementById('terminal-body');
    const emptyState = document.getElementById('empty-state');
    const searchInput = document.getElementById('search-input');
    const renderedCount = document.getElementById('rendered-count');
    
    const statTotal = document.getElementById('stat-total');
    const statEchoes = document.getElementById('stat-echoes');
    const statErrors = document.getElementById('stat-errors');
    
    const badgeAll = document.getElementById('badge-all');
    const badgeJson = document.getElementById('badge-json');
    const badgeText = document.getElementById('badge-text');
    const badgeError = document.getElementById('badge-error');
    
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    
    const toggleScroll = document.getElementById('toggle-scroll');
    const toggleWrap = document.getElementById('toggle-wrap');
    const toggleTimestamps = document.getElementById('toggle-timestamps');
    
    const btnFilterAll = document.getElementById('btn-filter-all');
    const btnFilterJson = document.getElementById('btn-filter-json');
    const btnFilterText = document.getElementById('btn-filter-text');
    const btnFilterError = document.getElementById('btn-filter-error');
    
    const btnClear = document.getElementById('btn-clear');
    const btnTestRequest = document.getElementById('btn-test-request');
    const toast = document.getElementById('toast');

    // Initialize EventSource
    let eventSource;
    function connectSSE() {
      statusDot.className = 'status-dot connecting';
      statusText.textContent = 'Connecting...';
      
      eventSource = new EventSource('/stream');
      
      eventSource.onopen = () => {
        statusDot.className = 'status-dot connected';
        statusText.textContent = 'Connected';
      };
      
      eventSource.onerror = (err) => {
        statusDot.className = 'status-dot disconnected';
        statusText.textContent = 'Disconnected (Retrying)';
        eventSource.close();
        setTimeout(connectSSE, 3000);
      };
      
      eventSource.onmessage = (event) => {
        try {
          const logItem = JSON.parse(event.data);
          allLogs.push(logItem);
          if (allLogs.length > 2000) {
            allLogs.shift();
          }
          
          updateSidebarStats();
          
          if (shouldShowLog(logItem)) {
            appendLog(logItem);
          }
        } catch (e) {
          console.error("Failed to parse log", e);
        }
      };
    }
    
    connectSSE();

    // Stats calculations
    function getLogStats() {
      let totals = { all: 0, json: 0, text: 0, error: 0 };
      allLogs.forEach(log => {
        totals.all++;
        if (log.type === 'json') {
          totals.json++;
        } else if (log.type === 'error' || isTextError(log.text)) {
          totals.error++;
        } else {
          totals.text++;
        }
      });
      return totals;
    }

    function isTextError(text) {
      if (!text) return false;
      const lower = text.toLowerCase();
      return lower.includes('error') || lower.includes('exception') || text.includes(' at ');
    }
    
    function updateSidebarStats() {
      const stats = getLogStats();
      statTotal.textContent = stats.all;
      statEchoes.textContent = stats.json;
      statErrors.textContent = stats.error;
      
      badgeAll.textContent = stats.all;
      badgeJson.textContent = stats.json;
      badgeText.textContent = stats.text;
      badgeError.textContent = stats.error;
    }

    function shouldShowLog(log) {
      // Category filter
      if (activeFilter === 'json' && log.type !== 'json') return false;
      if (activeFilter === 'text' && (log.type !== 'text' && log.type !== 'error')) return false;
      if (activeFilter === 'error') {
        const isErr = log.type === 'error' || (log.type === 'text' && isTextError(log.text));
        if (!isErr) return false;
      }
      
      // Search filter
      if (searchQuery) {
        if (log.type === 'text' && !log.text.toLowerCase().includes(searchQuery)) return false;
        if (log.type === 'json' && !JSON.stringify(log.data).toLowerCase().includes(searchQuery)) return false;
        if (log.type === 'error' && !log.text.toLowerCase().includes(searchQuery)) return false;
      }
      
      return true;
    }

    // Dynamic coloring of raw Morgan & terminal output
    function colorizeText(text) {
      // Colorize morgan request logs
      // Regex pattern matching: ::ffff:127.0.0.1 - - [19/Jul/2026:12:00:00 +0000] "GET /test HTTP/1.1" 200 458
      const morganRegex = /^(\\S+) - \\S+ \\[(.*?)\\] "([A-Z]+) (\\S+) (.*?)" (\\d{3}) (\\S+)/;
      const match = text.match(morganRegex);
      if (match) {
        const [_, ip, timestamp, method, path, protocol, status, size] = match;
        let statusClass = 'status-2xx';
        if (status.startsWith('3')) statusClass = 'status-3xx';
        if (status.startsWith('4')) statusClass = 'status-4xx';
        if (status.startsWith('5')) statusClass = 'status-5xx';
        
        let methodClass = \`method-\${method.toLowerCase()}\`;
        
        return \`<span class="log-ip">\${ip}</span> \` +
               \`<span class="log-time">[\${timestamp}]</span> \` +
               \`"<span class="log-method \${methodClass}">\${method}</span> \` +
               \`<span class="log-path">\${path}</span> \` +
               \`<span class="log-proto">\${protocol}</span>" \` +
               \`<span class="log-status \${statusClass}">\${status}</span> \` +
               \`<span class="log-size">\${size}</span>\`;
      }
      
      // Highlight standard listening server strings
      if (text.includes('Listening on ports') || text.includes('listening on port')) {
        return \`<span class="log-system-info">\${text}</span>\`;
      }
      
      // Highlight stack traces or raw errors in red
      if (isTextError(text)) {
        return \`<span class="log-system-error">\${text}</span>\`;
      }
      
      return text;
    }

    // Build collapsible JSON trees
    function renderJsonVal(val) {
      if (val === null) return '<span class="json-null">null</span>';
      if (typeof val === 'object') {
        const isArray = Array.isArray(val);
        const keys = Object.keys(val);
        if (keys.length === 0) return isArray ? '[]' : '{}';
        
        let html = \`<span class="json-toggle">\${isArray ? '[' : '{'}</span><ul class="json-collapsible">\`;
        for (const k of keys) {
          html += \`<li><span class="json-key">"\${k}"</span>: \${renderJsonVal(val[k])}</li>\`;
        }
        html += \`</ul><span>\${isArray ? ']' : '}'}</span>\`;
        return html;
      }
      if (typeof val === 'string') return \`<span class="json-string">\${JSON.stringify(val)}</span>\`;
      if (typeof val === 'number') return \`<span class="json-number">\${val}</span>\`;
      if (typeof val === 'boolean') return \`<span class="json-boolean">\${val}</span>\`;
      return \`<span class="json-string">\${JSON.stringify(val)}</span>\`;
    }

    // Append log row to the terminal container
    function appendLog(log, prepend = false) {
      emptyState.style.display = 'none';
      
      const row = document.createElement('div');
      row.className = 'log-row';
      row.id = log.id;
      
      // Create metadata line
      const meta = document.createElement('div');
      meta.className = 'log-meta';
      if (!toggleTimestamps.checked) meta.style.display = 'none';
      
      const timeTag = document.createElement('span');
      timeTag.className = 'log-time-tag';
      timeTag.textContent = new Date(log.timestamp).toLocaleTimeString();
      meta.appendChild(timeTag);
      
      const badge = document.createElement('span');
      let badgeType = log.type;
      if (log.type === 'text' && isTextError(log.text)) {
        badgeType = 'error';
      }
      badge.className = \`log-badge \${badgeType}\`;
      badge.textContent = badgeType === 'error' ? 'error' : log.type;
      meta.appendChild(badge);
      row.appendChild(meta);
      
      // Create content container
      const content = document.createElement('div');
      content.className = 'log-content';
      if (!toggleWrap.checked) content.style.whiteSpace = 'pre';
      
      if (log.type === 'json') {
        const method = log.data.method || 'GET';
        const path = log.data.path || '/';
        const ip = log.data.ip || '127.0.0.1';
        
        const summary = document.createElement('div');
        summary.className = 'json-summary';
        summary.innerHTML = \`[JSON Request] <span class="log-method method-\${method.toLowerCase()}">\${method}</span> <span class="log-path">\${path}</span> from \${ip}\`;
        
        const details = document.createElement('div');
        details.className = 'json-details';
        const tree = document.createElement('div');
        tree.className = 'json-tree';
        tree.innerHTML = renderJsonVal(log.data);
        details.appendChild(tree);
        
        row.classList.add('json-row');
        row.appendChild(summary);
        row.appendChild(details);
      } else {
        content.innerHTML = colorizeText(log.text);
        row.appendChild(content);
      }
      
      if (prepend) {
        terminalBody.insertBefore(row, terminalBody.firstChild);
      } else {
        terminalBody.appendChild(row);
      }
      
      if (toggleScroll.checked && !prepend) {
        terminalBody.scrollTop = terminalBody.scrollHeight;
      }
      
      updateRenderedCount();
    }

    function updateRenderedCount() {
      const count = terminalBody.querySelectorAll('.log-row').length;
      renderedCount.textContent = \`Showing \${count} logs\`;
    }

    // Perform a full refresh of logs based on filters
    function filterLogs() {
      // Clear terminal (keep empty state if none)
      const rows = terminalBody.querySelectorAll('.log-row');
      rows.forEach(r => r.remove());
      
      const filtered = allLogs.filter(shouldShowLog);
      
      if (filtered.length === 0) {
        emptyState.style.display = 'flex';
      } else {
        emptyState.style.display = 'none';
        filtered.forEach(log => appendLog(log));
      }
      
      updateRenderedCount();
    }

    // Toggle active filters
    function setFilter(filter, button) {
      [btnFilterAll, btnFilterJson, btnFilterText, btnFilterError].forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      activeFilter = filter;
      filterLogs();
    }

    btnFilterAll.onclick = () => setFilter('all', btnFilterAll);
    btnFilterJson.onclick = () => setFilter('json', btnFilterJson);
    btnFilterText.onclick = () => setFilter('text', btnFilterText);
    btnFilterError.onclick = () => setFilter('error', btnFilterError);

    // Live search input handler
    searchInput.oninput = (e) => {
      searchQuery = e.target.value.toLowerCase();
      filterLogs();
    };

    // Toggle option changes
    toggleScroll.onchange = () => {
      if (toggleScroll.checked) {
        terminalBody.scrollTop = terminalBody.scrollHeight;
      }
    };
    
    toggleWrap.onchange = () => {
      const contents = terminalBody.querySelectorAll('.log-content');
      contents.forEach(c => {
        c.style.whiteSpace = toggleWrap.checked ? 'pre-wrap' : 'pre';
      });
    };
    
    toggleTimestamps.onchange = () => {
      const metas = terminalBody.querySelectorAll('.log-meta');
      metas.forEach(m => {
        m.style.display = toggleTimestamps.checked ? 'flex' : 'none';
      });
    };

    // Collapse/Expand clicks using Event Delegation
    document.addEventListener('click', (e) => {
      const summary = e.target.closest('.json-summary');
      if (summary) {
        const row = summary.closest('.log-row');
        row.classList.toggle('expanded');
        return;
      }
      
      if (e.target.classList.contains('json-toggle')) {
        const ul = e.target.nextElementSibling;
        if (ul && ul.classList.contains('json-collapsible')) {
          ul.classList.toggle('collapsed');
          const isCollapsed = ul.classList.contains('collapsed');
          
          if (isCollapsed) {
            e.target.dataset.original = e.target.textContent;
            e.target.textContent = e.target.textContent === '[' ? '[...]' : '{...}';
            ul.style.display = 'none';
          } else {
            e.target.textContent = e.target.dataset.original || (e.target.textContent.includes('[') ? '[' : '{');
            ul.style.display = 'block';
          }
        }
      }
    });

    // Clear logs
    btnClear.onclick = () => {
      allLogs.length = 0;
      updateSidebarStats();
      filterLogs();
    };

    // Toast functionality
    function showToast() {
      toast.classList.add('show');
      setTimeout(() => {
        toast.classList.remove('show');
      }, 3000);
    }

    // Trigger test request endpoint
    btnTestRequest.onclick = () => {
      fetch('/api/test-request', { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            showToast();
          }
        })
        .catch(err => {
          console.error("Failed to trigger request", err);
        });
    };
  </script>
</body>
</html>`;
}

/**
 * Initializes the log viewer web server.
 * Intercepts stdout/stderr.
 */
function initLogViewer() {
  const logPort = process.env.LOG_SERVER_PORT || 8081;
  const targetPort = process.env.HTTP_PORT || 8080;
  const logApp = express();

  logApp.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(getHTMLContent());
  });

  logApp.get('/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Stream initial history
    logHistory.forEach(logItem => {
      res.write(`data: ${JSON.stringify(logItem)}\n\n`);
    });

    logClients.push(res);

    req.on('close', () => {
      logClients = logClients.filter(c => c !== res);
    });
  });

  logApp.post('/api/test-request', (req, res) => {
    // Send a local request to the main server to create dummy logs
    const testReq = http.request({
      hostname: '127.0.0.1',
      port: targetPort,
      path: '/demo-log-viewer-path?demo=true&test=1',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LogViewerTestTrigger/1.0'
      }
    }, (testRes) => {
      let body = '';
      testRes.on('data', c => body += c);
      testRes.on('end', () => {
        res.json({ success: true, status: testRes.statusCode });
      });
    });

    testReq.on('error', (err) => {
      res.status(500).json({ success: false, error: err.message });
    });

    testReq.write(JSON.stringify({
      message: "Testing the real-time http request logger!",
      environment: process.env.NODE_ENV || "development",
      timestamp: new Date().toISOString(),
      details: {
        agent: "Antigravity Logger AI",
        awesome: true
      }
    }));
    testReq.end();
  });

  const server = logApp.listen(logPort, () => {
    consoleLogDirect(`Web log viewer server running on port ${logPort}`);
  });

  startIntercept();

  return server;
}

module.exports = {
  initLogViewer,
  stopIntercept
};
