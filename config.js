/**
 * Configuration for USJ Express Pass Ticket Purchaser
 */
module.exports = {
  // Browser settings
  browser: {
    headless: false,      // Set to true to run in headless mode (no visible browser)
    slowMo: 20,           // Milliseconds to wait between actions (set higher for slower execution)
    width: 1024,          // Browser window width
    height: 900           // Browser window height
  },
  
  // Ticket settings
  ticket: {
    productIndex: 10,     // The product index on the page (10 = Express Pass 4 4D & Choice)
    quantity: 1,          // Number of tickets to purchase
    
    // Date selection settings
    date: {
      advanceMonths: 1,   // How many months to navigate forward
      row: 3,             // Row in the calendar (1-based index)
      column: 6           // Column in the calendar (1-based index)
    },
    
    // Session settings
    session: {
      index: 1            // Which session to select (1 = first available)
    }
  },
  
  // Behavior settings
  behavior: {
    autoClose: false,     // Whether to automatically close the browser when done
    timeoutMs: 30000,     // Default timeout for actions (increased to 30 seconds)
    navigationTimeoutMs: 60000, // Navigation timeout (60 seconds)
    takeErrorScreenshots: true, // Whether to take screenshots on errors
    retryCount: 3         // Number of times to retry failed actions
  },
  
  // Debug settings
  debug: {
    logSelectors: false,   // Log selector details for debugging
    saveAllScreenshots: true, // Save screenshots at each step
    screenshotDir: './screenshots' // Directory to save screenshots
  }
}; 