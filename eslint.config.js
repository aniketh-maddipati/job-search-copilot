export default [
  {
    files: ["**/*.js"],
    ignores: ["node_modules/**", "tests/**"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        SpreadsheetApp:    "readonly",
        GmailApp:          "readonly",
        PropertiesService: "readonly",
        ScriptApp:         "readonly",
        UrlFetchApp:       "readonly",
        HtmlService:       "readonly",
        ContentService:    "readonly",
        Utilities:         "readonly",
        Session:           "readonly",
        console:           "readonly",
      }
    },
    rules: {
      "no-undef":       "error",
      "no-unreachable": "error",
      "no-dupe-keys":   "error",
      "no-redeclare":   "error",
      "no-unused-vars": ["warn", {
        varsIgnorePattern: "^(onOpen|doGet|sync|syncFresh|showSetup|saveAndInit|clearCache|showDebugSheets|hideDebugSheets|createDailyTrigger|removeTriggers|sendDailyDigest|getDebugInfo|Providers|Filters)$",
        caughtErrors: "none"
      }]
    }
  }
];
