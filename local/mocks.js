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
// MOCK: UrlFetchApp
// ═══════════════════════════════════════════════════════════════════════════════
const UrlFetchApp = {
  fetch(url, options) {
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
