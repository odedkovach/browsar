# USJ Express Pass Ticket Purchaser

Automated script for purchasing Express Pass tickets from Universal Studios Japan's official ticketing website.

## Features

- Automates the entire Express Pass ticket purchasing flow
- Configurable ticket quantity, date selection, and session time
- Takes screenshots at key steps for monitoring and debugging
- Robust error handling with screenshots of error states
- Multiple selector strategies to ensure reliable operation

## Prerequisites

- Node.js (version 14 or higher)
- npm

## Installation

```bash
# Clone this repository
git clone https://github.com/yourusername/usj-ticket-purchaser.git

# Navigate to the project directory
cd usj-ticket-purchaser

# Install dependencies
npm install
```

## Usage

Run the script with default settings:

```bash
npm start
```

Or directly with Node:

```bash
node index2.js
```

## Configuration

All settings can be configured in the `config.js` file. The configuration is organized into the following sections:

### Browser Settings

```javascript
browser: {
    headless: false,          // Set to true for invisible browser
    slowMo: 20,               // Slow down operations (ms)
    width: 1024,              // Browser window width
    height: 900               // Browser window height
}
```

### Ticket Settings

```javascript
ticket: {
    productIndex: 10,         // Which product to select (div index)
    quantity: 1,              // Number of tickets to purchase
    date: {
        advanceMonths: 1,     // How many months to advance in calendar
        row: 3,               // Which row in the calendar to select
        column: 6             // Which column in the calendar to select
    },
    session: {
        index: 1              // Which session/time slot to select (1 = first)
    }
}
```

### Behavior Settings

```javascript
behavior: {
    timeoutMs: 5000,          // Default timeout for operations
    autoClose: false,         // Auto-close browser after completion
    takeErrorScreenshots: true // Take screenshots on errors
}
```

### Debug Settings

```javascript
debug: {
    saveAllScreenshots: false, // Save screenshots at every step
    screenshotDir: './screenshots' // Directory for screenshots
}
```

## Important Notes

- The script runs in non-headless mode by default so you can see what's happening
- Intentional slowdowns (`slowMo`) are included to make the process visible and more reliable
- Screenshots are saved in the `./screenshots` directory
- If the script fails, check the console output for error messages

## Legal Considerations

This script is provided for educational purposes only. Automating purchases on the USJ website may violate their terms of service. Use at your own risk and responsibility.

## Troubleshooting

If the script fails:

1. Check the console output for error messages
2. Look at the screenshot taken at the time of the error (saved in the screenshots directory)
3. Verify that your internet connection is stable
4. The website's structure may have changed - check the selectors and update if necessary

## License

This project is provided as-is, without warranties or conditions of any kind. 