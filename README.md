# Job Search Co-Pilot

AI-powered job search triage in Google Sheets.

## Local Development

This project uses Google Apps Script but supports local development to minimize network requests and enable faster iteration.

### Architecture

```
Production (Apps Script)          Local Development
┌─────────────────────────┐       ┌─────────────────────────┐
│ GmailApp, SpreadsheetApp│       │ Mock services (Node.js) │
│ PropertiesService, etc. │       │ JSON file storage       │
└───────────┬─────────────┘       └───────────┬─────────────┘
            │                                 │
            ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│      Code.js (logic)    │  ───  │      Code.js (logic)    │
└───────────┬─────────────┘       └───────────┬─────────────┘
            │                                 │
            ▼                                 ▼
┌─────────────────────────┐       ┌─────────────────────────┐
│  HtmlService (Setup.html)│      │  Express + Live Reload  │
└─────────────────────────┘       └─────────────────────────┘
```

### Quick Start

```bash
# Install dependencies
npm install

# Start local dev server (UI + mock backend)
npm run dev

# Run tests
npm test

# Deploy to Apps Script
npm run deploy
```

### Project Structure

```
├── Code.js              # Main Apps Script logic
├── Setup.html           # Web UI for setup
├── tests.js             # Apps Script tests (run in GAS)
├── tests_ui.js          # UI component tests
├── local/               # Local development files
│   ├── server.js        # Express server for local UI
│   ├── mocks.js         # Mock Apps Script services
│   └── data/            # Local JSON storage for mocks
├── appsscript.json      # Apps Script manifest
├── .clasp.json          # Clasp config
└── sync.sh              # Quick deploy script
```

### Required Files for Local Dev

Create these files to enable local development:

#### 1. `local/mocks.js` - Mock Apps Script Services

```javascript
/**
 * Mock implementations of Google Apps Script services
 * These allow Code.js to run in Node.js without network calls
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Mock data storage
const loadJSON = (file) => {
  const p = path.join(DATA_DIR, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
};
const saveJSON = (file, data) => fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: PropertiesService
// ═══════════════════════════════════════════════════════════════════════════════
const PropertiesService = {
  getScriptProperties() {
    return {
      getProperty(key) {
        const props = loadJSON('properties.json');
        return props[key] || null;
      },
      setProperty(key, value) {
        const props = loadJSON('properties.json');
        props[key] = value;
        saveJSON('properties.json', props);
      },
      getProperties() {
        return loadJSON('properties.json');
      }
    };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: GmailApp
// ═══════════════════════════════════════════════════════════════════════════════
const GmailApp = {
  search(query, start = 0, max = 50) {
    // Load mock threads from local JSON
    const threads = loadJSON('mock_threads.json').threads || [];
    return threads.slice(start, start + max).map(t => createMockThread(t));
  }
};

function createMockThread(data) {
  return {
    getId: () => data.id,
    getMessages: () => data.messages.map(m => ({
      getFrom: () => m.from,
      getTo: () => m.to,
      getSubject: () => m.subject,
      getDate: () => new Date(m.date),
      getPlainBody: () => m.body
    }))
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: SpreadsheetApp
// ═══════════════════════════════════════════════════════════════════════════════
const SpreadsheetApp = {
  getActiveSpreadsheet() {
    return createMockSpreadsheet();
  },
  getUi() {
    return {
      createMenu: () => ({ addItem: () => ({ addToUi: () => {} }) }),
      showModalDialog: () => {}
    };
  }
};

function createMockSpreadsheet() {
  const sheets = loadJSON('sheets.json');
  
  return {
    getId: () => 'mock-spreadsheet-id',
    getUrl: () => 'http://localhost:3000',
    getSheetByName(name) {
      if (!sheets[name]) return null;
      return createMockSheet(name, sheets);
    },
    insertSheet(name) {
      sheets[name] = { data: [], widths: [], heights: [] };
      saveJSON('sheets.json', sheets);
      return createMockSheet(name, sheets);
    },
    setHideGridlines() { return this; }
  };
}

function createMockSheet(name, sheets) {
  const sheet = sheets[name] || { data: [], widths: [], heights: [] };
  
  return {
    getName: () => name,
    getLastRow: () => sheet.data.length,
    getLastColumn: () => (sheet.data[0] || []).length,
    getMaxRows: () => Math.max(sheet.data.length, 100),
    getMaxColumns: () => 26,
    getSheetId: () => name.hashCode || 0,
    
    getRange(row, col, numRows = 1, numCols = 1) {
      return createMockRange(name, sheets, row, col, numRows, numCols);
    },
    
    clear() {
      sheet.data = [];
      saveJSON('sheets.json', sheets);
      return this;
    },
    
    setColumnWidth(col, width) {
      sheet.widths[col] = width;
      saveJSON('sheets.json', sheets);
      return this;
    },
    
    setRowHeights(startRow, numRows, height) {
      for (let i = 0; i < numRows; i++) {
        sheet.heights[startRow + i] = height;
      }
      saveJSON('sheets.json', sheets);
      return this;
    },
    
    setFrozenRows() { return this; },
    setHideGridlines() { return this; },
    hideSheet() { return this; }
  };
}

function createMockRange(sheetName, sheets, row, col, numRows, numCols) {
  const sheet = sheets[sheetName];
  
  return {
    getValues() {
      const result = [];
      for (let r = row - 1; r < row - 1 + numRows; r++) {
        const rowData = [];
        for (let c = col - 1; c < col - 1 + numCols; c++) {
          rowData.push(sheet.data[r]?.[c] ?? '');
        }
        result.push(rowData);
      }
      return result;
    },
    
    setValues(values) {
      for (let r = 0; r < values.length; r++) {
        if (!sheet.data[row - 1 + r]) sheet.data[row - 1 + r] = [];
        for (let c = 0; c < values[r].length; c++) {
          sheet.data[row - 1 + r][col - 1 + c] = values[r][c];
        }
      }
      saveJSON('sheets.json', sheets);
      return this;
    },
    
    clearContent() { return this; },
    clearFormat() { return this; },
    setFontFamily() { return this; },
    setFontSize() { return this; },
    setFontWeight() { return this; },
    setFontColor() { return this; },
    setFontStyle() { return this; },
    setBackground() { return this; },
    setVerticalAlignment() { return this; },
    insertCheckboxes() { return this; }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: UrlFetchApp (for AI calls - can mock or pass through)
// ═══════════════════════════════════════════════════════════════════════════════
const UrlFetchApp = {
  fetch(url, options) {
    // Option 1: Actually make the request (requires node-fetch)
    // Option 2: Return mock AI responses
    const mockResponses = loadJSON('mock_ai_responses.json');
    const mockKey = url.includes('groq') ? 'groq' : 'default';
    
    return {
      getContentText() {
        return JSON.stringify(mockResponses[mockKey] || {
          choices: [{ message: { content: '[]' } }]
        });
      }
    };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: HtmlService
// ═══════════════════════════════════════════════════════════════════════════════
const HtmlService = {
  createTemplateFromFile(filename) {
    return {
      evaluate() {
        return {
          setTitle() { return this; },
          addMetaTag() { return this; },
          getContent() {
            return fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
          }
        };
      }
    };
  },
  createHtmlOutput(html) {
    return { getContent: () => html };
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOCK: ScriptApp
// ═══════════════════════════════════════════════════════════════════════════════
const ScriptApp = {
  getService() {
    return { getUrl: () => 'http://localhost:3000' };
  }
};

module.exports = {
  PropertiesService,
  GmailApp,
  SpreadsheetApp,
  UrlFetchApp,
  HtmlService,
  ScriptApp
};
```

#### 2. `local/server.js` - Local Dev Server

```javascript
const express = require('express');
const path = require('path');
const fs = require('fs');

// Load mocks into global scope (simulates Apps Script environment)
const mocks = require('./mocks');
Object.assign(global, mocks);

// Load Code.js into global scope
const codeContent = fs.readFileSync(path.join(__dirname, '..', 'Code.js'), 'utf8');
eval(codeContent);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

// Serve Setup.html as the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'Setup.html'));
});

// API endpoint to simulate google.script.run
app.post('/api/:functionName', (req, res) => {
  const fn = global[req.params.functionName];
  if (typeof fn !== 'function') {
    return res.status(404).json({ error: `Function ${req.params.functionName} not found` });
  }
  
  try {
    const result = fn(...(req.body.args || []));
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Dashboard data endpoint (for local UI)
app.get('/api/dashboard', (req, res) => {
  const sheets = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'sheets.json'), 'utf8') || '{}');
  res.json(sheets.Dashboard || { data: [] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Local dev server running at http://localhost:${PORT}`);
  console.log('   - UI: http://localhost:3000');
  console.log('   - API: http://localhost:3000/api/{functionName}');
  console.log('\n📁 Mock data stored in: local/data/\n');
});
```

#### 3. `local/data/mock_threads.json` - Sample Test Data

```json
{
  "threads": [
    {
      "id": "thread-001",
      "messages": [
        {
          "from": "recruiter@stripe.com",
          "to": "you@gmail.com",
          "subject": "Software Engineer Role at Stripe",
          "date": "2026-02-10T10:00:00Z",
          "body": "Hi! We reviewed your application and would love to schedule a call. Are you available this week?"
        }
      ]
    },
    {
      "id": "thread-002",
      "messages": [
        {
          "from": "you@gmail.com",
          "to": "hiring@figma.com",
          "subject": "Following up on my application",
          "date": "2026-02-01T10:00:00Z",
          "body": "Hi, I submitted my application last week and wanted to follow up."
        }
      ]
    },
    {
      "id": "thread-003",
      "messages": [
        {
          "from": "mentor@alumni.edu",
          "to": "you@gmail.com",
          "subject": "Re: Coffee chat request",
          "date": "2026-02-11T14:00:00Z",
          "body": "Happy to chat! How about next Tuesday at 2pm?"
        }
      ]
    }
  ]
}
```

#### 4. `local/data/mock_ai_responses.json` - Mock AI Responses

```json
{
  "groq": {
    "choices": [
      {
        "message": {
          "content": "[{\"category\":\"JOB\",\"isJob\":true,\"play\":\"Reply today—they asked for availability. Suggest 2-3 specific times.\",\"draft\":\"Thanks so much for reaching out! I'm very interested. I'm available Tuesday 2-4pm or Wednesday morning. Would either work?\"},{\"category\":\"JOB\",\"isJob\":true,\"play\":\"Follow up—11 days since you wrote. Reference something specific about the role.\",\"draft\":\"Hi! Wanted to check in on my application. I'm particularly excited about the design systems work mentioned in the JD. Any updates?\"},{\"category\":\"NETWORKING\",\"isJob\":false,\"play\":\"Confirm the meeting—they proposed a time.\",\"draft\":\"Tuesday at 2pm works perfectly! Looking forward to it. Should I come to your office or meet virtually?\"}]"
        }
      }
    ]
  }
}
```

### Updated package.json

```json
{
  "name": "job-search-copilot",
  "version": "1.2.0",
  "description": "AI-powered job search triage in Google Sheets",
  "scripts": {
    "dev": "node local/server.js",
    "test": "node --experimental-vm-modules node_modules/jest/bin/jest.js",
    "test:watch": "npm test -- --watch",
    "deploy": "./sync.sh",
    "push": "clasp push",
    "pull": "clasp pull",
    "open": "clasp open"
  },
  "devDependencies": {
    "@types/google-apps-script": "^2.0.8",
    "express": "^4.18.2",
    "jest": "^29.7.0"
  }
}
```

### Local UI Development

The `Setup.html` file needs a small shim to work locally. Add this to the bottom of the `<script>` section when developing locally (the server will inject it):

```javascript
// Local development shim for google.script.run
if (typeof google === 'undefined') {
  window.google = {
    script: {
      run: new Proxy({}, {
        get(_, functionName) {
          let successHandler = () => {};
          let failureHandler = () => {};
          
          return {
            withSuccessHandler(fn) { successHandler = fn; return this; },
            withFailureHandler(fn) { failureHandler = fn; return this; },
            [functionName]: (...args) => {
              fetch(`/api/${functionName}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ args })
              })
              .then(r => r.json())
              .then(data => data.success ? successHandler(data.result) : failureHandler(data))
              .catch(failureHandler);
            }
          };
        }
      })
    }
  };
}
```

### Testing Locally

```bash
# Run unit tests (pure logic, no network)
npm test

# Start dev server and test UI manually
npm run dev
# Open http://localhost:3000

# Test specific functions via API
curl -X POST http://localhost:3000/api/sync
```

### Workflow

1. **Edit locally** - Modify `Code.js`, `Setup.html`, run `npm run dev`
2. **Test locally** - Use mock data, no network calls
3. **Deploy** - Run `npm run deploy` (or `./sync.sh`) to push to Apps Script

### Key Principles

- **Separation of concerns**: `App` adapter pattern in `Code.js` makes services mockable
- **No network in tests**: All external calls go through mockable interfaces
- **Same code runs everywhere**: `Code.js` works identically in Apps Script and Node.js

## Production Deployment

```bash
# Initial setup
clasp login
clasp clone <script-id>  # or use existing .clasp.json

# Deploy
clasp push
clasp deploy  # creates a new version
```

## License

MIT
