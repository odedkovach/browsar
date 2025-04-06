const puppeteer = require('puppeteer');
const { purchaceTikcet } = require('./index3');

async function testQuantity() {
  console.log('Starting quantity test');
  
  // Test direct function call
  try {
    console.log('Testing with direct function call');
    const result = await purchaceTikcet({
      name: 'Universal Express Pass 4: Fun Variety',
      quantity: 3, // Explicitly using number 3
      date: '2025-5-31'
    });
    console.log('Direct call result:', result);
  } catch (error) {
    console.error('Error in direct function call:', error);
  }
}

// Run the test
testQuantity().then(() => {
  console.log('Test completed');
}).catch(err => {
  console.error('Test failed:', err);
}); 