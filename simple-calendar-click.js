const puppeteer = require('puppeteer');

(async () => {
  // Launch browser with visible window
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    slowMo: 200,  // Slow down operations for visibility
    args: ['--window-size=1200,900']
  });
  
  const page = await browser.newPage();
  const timeout = 30000;
  page.setDefaultTimeout(timeout);
  page.setDefaultNavigationTimeout(60000);

  // Helper function for delays
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  
  try {
    console.log("Navigating to USJ Express Pass page...");
    await page.goto('https://www.usjticketing.com/expressPass', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // Wait for product cards to load
    console.log("Waiting for products to load...");
    await page.waitForSelector('div.el-card', { timeout });
    
    // Take a screenshot of the initial page
    await page.screenshot({ path: './screenshots/simple_1_initial.png' });
    
    // Select a specific product
    const productIndex = 3; // 4th product (0-based index)
    console.log(`Selecting product at index ${productIndex}...`);
    
    // Try to find all product cards
    const productCards = await page.$$('div.el-card');
    console.log(`Found ${productCards.length} product cards`);
    
    if (productCards.length > productIndex) {
      // Get the selected product card
      const selectedCard = productCards[productIndex];
      
      // Scroll to make the product visible
      await selectedCard.scrollIntoViewIfNeeded();
      await delay(1000);
      
      // Find and click the "SELECT A DATE" button
      console.log("Looking for the 'SELECT A DATE' button...");
      const dateButtonSelector = 'button.el-button span';
      const dateButton = await selectedCard.$(dateButtonSelector);
      
      if (dateButton) {
        console.log("Found 'SELECT A DATE' button, clicking it...");
        await dateButton.click();
        await delay(2000);
        
        // Take a screenshot to see if calendar opened
        await page.screenshot({ path: './screenshots/simple_2_calendar.png' });
        
        // Dump the full HTML content after clicking 'SELECT A DATE'
        const pageContent = await page.content();
        require('fs').writeFileSync('./screenshots/pageAfterSelectADate.html', pageContent);
        console.log('Dumped full page HTML to ./screenshots/pageAfterSelectADate.html');
        
        // Wait for any dialog or calendar to appear
        console.log("Waiting for calendar dialog...");
        await delay(1000);
        
        // Dump the HTML of the calendar dialog element if it exists
        const calendarDialogHTML = await page.evaluate(() => {
          const dialog = document.querySelector('.el-dialog, .el-dialog__wrapper, .el-date-picker, .el-dialog__body');
          return dialog ? dialog.outerHTML : null;
        });
        
        if (calendarDialogHTML) {
          require('fs').writeFileSync('./screenshots/calendarDialogDump.html', calendarDialogHTML);
          console.log('Dumped calendar dialog HTML to ./screenshots/calendarDialogDump.html');
        } else {
          console.log('No calendar dialog element found to dump.');
        }
        
        // Direct approach to find dialog
        const dialogVisible = await page.evaluate(() => {
          // Check for modal dialogs
          const dialogs = document.querySelectorAll('.el-dialog, .el-dialog__wrapper, .el-date-picker, .el-dialog__body');
          console.log(`Found ${dialogs.length} potential dialogs`);
          
          // Check for a dialog with a date table
          for (const dialog of dialogs) {
            if (dialog.querySelector('.el-date-table') || dialog.querySelector('[class*="date"]')) {
              return true;
            }
          }
          
          return false;
        });
        
        console.log(`Dialog with calendar found: ${dialogVisible}`);
        
        if (dialogVisible) {
          // Take another screenshot to confirm dialog presence
          await page.screenshot({ path: './screenshots/simple_3_dialog_confirmed.png' });
          
          // Replace the existing multi-strategy next month button search with a simplified approach
          console.log("Trying to click the Next Month button using a simplified selector...");
          await page.evaluate(() => {
            const nextMonthButton = document.querySelector('.el-calendar__button-group button:nth-child(3)');
            if (nextMonthButton && nextMonthButton.textContent.trim().toLowerCase() === "next month") {
              console.log("Found Next Month button, clicking it...");
              nextMonthButton.click();
            } else {
              console.log("Next Month button not found using simplified selector.");
            }
          });
          
          // Wait to see the result
          await delay(2000);
          await page.screenshot({ path: './screenshots/simple_4_after_next_month_attempt.png' });
          
          // Try a direct click on element based on specific coordinates if dialog is visible
          console.log("Trying direct click on expected next month button position...");
          
          // Try to locate the dialog first to get relative coordinates
          const dialogBox = await page.evaluate(() => {
            const dialog = document.querySelector('.el-dialog__wrapper, .el-dialog, .el-date-picker');
            if (!dialog) return null;
            
            const rect = dialog.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height
            };
          });
          
          if (dialogBox) {
            console.log("Dialog found at position:", dialogBox);
            
            // Estimate where the next month button should be (usually top right)
            // These coordinates are approximate and may need adjustment
            const x = dialogBox.x + dialogBox.width * 0.75; // 75% from left 
            const y = dialogBox.y + 30; // Assuming header is about 30px from top
            
            console.log(`Clicking at position x=${x}, y=${y}`);
            await page.mouse.click(x, y);
            
            // Wait to see if click had an effect
            await delay(2000);
            await page.screenshot({ path: './screenshots/simple_5_after_position_click.png' });
            
            // Look for date cells and try to click one
            console.log("Looking for available dates to select...");
            
            // Now try to click a date
            const dateSelected = await page.evaluate(() => {
              const dateCells = document.querySelectorAll('td:not(.disabled) > div, td:not([class*="disabled"]) > div');
              console.log(`Found ${dateCells.length} selectable dates`);
              
              if (dateCells.length > 0) {
                // Choose a date in the middle of the month
                const middleIndex = Math.floor(dateCells.length / 2);
                console.log(`Clicking date at index ${middleIndex}`);
                dateCells[middleIndex].click();
                return true;
              }
              return false;
            });
            
            console.log(`Date selected: ${dateSelected}`);
            await delay(2000);
            await page.screenshot({ path: './screenshots/simple_6_date_selected.png' });
            
            // Try to click the NEXT button to confirm date selection
            console.log("Looking for NEXT button to confirm date...");
            const nextButtonClicked = await page.evaluate(() => {
              const nextButtons = [
                ...document.querySelectorAll('button.el-button--primary, button.primary, .el-button--primary'),
                ...document.querySelectorAll('button span:not([class])')
              ].filter(el => {
                const text = el.textContent?.trim().toUpperCase();
                return text === 'NEXT' || text === 'CONTINUE' || text === 'OK';
              });
              
              console.log(`Found ${nextButtons.length} potential NEXT buttons`);
              if (nextButtons.length > 0) {
                nextButtons[0].click();
                return true;
              }
              return false;
            });
            
            console.log(`NEXT button clicked: ${nextButtonClicked}`);
            await delay(2000);
            await page.screenshot({ path: './screenshots/simple_7_after_next_button.png' });
            
            console.log("Calendar interaction completed.");
          } else {
            console.log("Could not determine dialog position for direct click");
          }
        } else {
          console.log("No calendar dialog found after clicking 'SELECT A DATE'");
        }
      } else {
        console.log("Could not find 'SELECT A DATE' button");
      }
    } else {
      console.log(`Product index ${productIndex} is out of range (found ${productCards.length} products)`);
    }
    
    console.log("Test completed - browser will remain open");
    // Keep browser open for inspection
    
  } catch (err) {
    console.error("Error during test:", err);
    
    // Take a screenshot of the error state
    try {
      const errorScreenshotPath = `./screenshots/simple_error-${Date.now()}.png`;
      await page.screenshot({ path: errorScreenshotPath });
      console.log(`Error screenshot saved to: ${errorScreenshotPath}`);
    } catch (screenshotErr) {
      console.error("Failed to take error screenshot:", screenshotErr);
    }
  }
})(); 