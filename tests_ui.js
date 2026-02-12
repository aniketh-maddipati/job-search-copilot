/**
 * UI Component Tests
 * Run: testSetupUI()
 */

function testSetupUI() {
  const results = [];
  
  // Test 1: Setup sidebar opens
  results.push(test('Setup sidebar can be displayed', () => {
    showSetup();
    // Manual check: Does sidebar appear?
  }));
  
  // Test 2: First run detection
  results.push(test('isFirstRun detects new installations', () => {
    const hasKey = App.props.get('GROQ_KEY');
    const ss = App.sheets.getActive();
    const dashboard = App.sheets.getSheet(ss, CORE.SHEETS.MAIN);
    
    if (!hasKey && !dashboard) {
      assert(isFirstRun() === true, 'Should detect first run');
    }
  }));
  
  // Test 3: Menu creation
  results.push(test('onOpen creates menu without errors', () => {
    onOpen();
    // Manual check: Does menu appear in Sheet?
  }));
  
  report(results);
}

function testCoreLogic() {
  const results = [];
  
  // Security tests
  results.push(test('Security.stripPII removes emails', () => {
    const input = 'Contact john@example.com for details';
    const output = Security.stripPII(input);
    assert(!output.includes('john@example.com'), 'Email should be stripped');
    assert(output.includes('[email]'), 'Should replace with [email]');
  }));
  
  results.push(test('Security.sanitize blocks formula injection', () => {
    assert(Security.sanitize('=SUM(A1)').startsWith("'"), 'Should prefix =');
    assert(Security.sanitize('Normal') === 'Normal', 'Should not modify normal text');
  }));
  
  results.push(test('Security.validateAI checks structure', () => {
    const valid = [{play: 'test', draft: 'test'}];
    const invalid = [{play: 'test'}];
    assert(Security.validateAI(valid, 1) === true, 'Should validate correct structure');
    assert(Security.validateAI(invalid, 1) === false, 'Should reject invalid structure');
  }));
  
  // Email parsing tests
  results.push(test('Email.extractDomain parses email', () => {
    assert(Email.extractDomain('user@example.com') === 'example.com', 'Should extract domain');
  }));
  
  results.push(test('Email.extractName parses first name', () => {
    const name = Email.extractName('John Doe <john@example.com>');
    assert(name === 'John', 'Should extract first name');
  }));
  
  results.push(test('Email.domainToCompany extracts company', () => {
    assert(Email.domainToCompany('mail.google.com') === 'google', 'Should extract company');
  }));
  
  // Status tests
  results.push(test('Status.compute returns Reply Needed when they replied', () => {
    const status = Status.compute({ fromMe: false, days: 2, isJob: true });
    assert(status.label === 'Reply Needed', 'Should be Reply Needed');
    assert(status.priority === 0, 'Should have highest priority');
  }));
  
  results.push(test('Status.compute returns Follow Up after threshold', () => {
    const status = Status.compute({ fromMe: true, days: 8, isJob: true });
    assert(status.label === 'Follow Up', 'Should be Follow Up');
  }));
  
  results.push(test('Status.compute returns Waiting when recent', () => {
    const status = Status.compute({ fromMe: true, days: 2, isJob: true });
    assert(status.label === 'Waiting', 'Should be Waiting');
  }));
  
  report(results);
}

function testAIFallback() {
  const results = [];
  
  results.push(test('AI.fallback classifies job emails', () => {
    const row = { 
      subject: 'Software Engineer Interview',
      body: 'recruiter role position',
      contact: 'Sarah',
      fromMe: false,
      days: 3
    };
    
    AI.fallback(row);
    assert(row.category === 'JOB', 'Should classify as JOB');
    assert(row.isJob === true, 'Should mark as job');
    assert(row.play.includes('Reply'), 'Should suggest reply');
  }));
  
  results.push(test('AI.fallback generates follow-up suggestions', () => {
    const row = {
      subject: 'Coffee chat',
      body: 'networking alumni',
      contact: 'Mike',
      fromMe: true,
      days: 8,
      category: 'NETWORKING'
    };
    
    AI.fallback(row);
    assert(row.play.includes('Bump'), 'Should suggest bumping');
    assert(row.draft.length > 0, 'Should generate draft');
  }));
  
  report(results);
}

// Test helpers
function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    return { name, passed: true };
  } catch (e) {
    console.log(`✗ ${name}: ${e.message}`);
    return { name, passed: false, error: e.message };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function report(results) {
  const passed = results.filter(r => r.passed).length;
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Tests: ${passed}/${results.length} passed`);
  console.log('═'.repeat(50));
  return results.every(r => r.passed);
}

// Run all tests
function runAllTests() {
  console.log('🧪 Running Core Logic Tests...\n');
  testCoreLogic();
  
  console.log('\n🧪 Running AI Fallback Tests...\n');
  testAIFallback();
  
  console.log('\n🧪 Running UI Tests...\n');
  testSetupUI();
}