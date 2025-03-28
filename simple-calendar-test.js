const puppeteer = require('puppeteer');

/**
 * Simple script to test calendar interactions on USJ website
 */
(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        slowMo: 20,
        args: ['--window-size=1024,900']
    });
    
    const page = await browser.newPage();
    const timeout = 30000;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(60000);

    // Helper function to delay execution
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
        console.log("Setting viewport...");
        await page.setViewport({
            width: 1024,
            height: 900
        });

        console.log("Navigating to USJ Express Pass page...");
        await page.goto('https://www.usjticketing.com/expressPass', { 
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Wait for page to load properly
        console.log("Waiting for page to load completely...");
        await page.waitForSelector('div.el-card', { timeout: timeout });
        console.log("Page loaded successfully.");

        // Take a screenshot
        await page.screenshot({ path: `./screenshots/test_initial_page.png` });
        
        // Click "SELECT A DATE" button for a specific product (e.g., product #2)
        console.log("Clicking 'SELECT A DATE' button...");
        
        // Get all "SELECT A DATE" buttons
        const dateButtons = await page.$$('button.el-button span');
        console.log(`Found ${dateButtons.length} buttons on the page`);
        
        // Click the date button
        if (dateButtons.length > 0) {
            // Try to click the first one
            const buttonIndex = 0; // Use the first button
            await dateButtons[buttonIndex].click();
            console.log(`Clicked date button at index ${buttonIndex}`);
            await delay(1000);
            
            // Take screenshot after clicking button
            await page.screenshot({ path: `./screenshots/test_calendar_opened.png` });
            
            // Try to find the next month arrow with detailed logs
            console.log("Looking for next month arrow...");
            
            // Try different approaches to find and click the next month arrow
            
            // 1. Try using JavaScript evaluation
            const arrowClicked = await page.evaluate(() => {
                console.log("Inside evaluate function");
                
                // Look for arrows by common attributes
                const rightArrows = Array.from(document.querySelectorAll('img[src*="right"], img[alt*="next"], img:last-child'));
                console.log(`Found ${rightArrows.length} potential arrows`);
                
                if (rightArrows.length > 0) {
                    // Debug attributes of the first arrow
                    const arrow = rightArrows[0];
                    console.log(`Arrow attributes: src=${arrow.src}, alt=${arrow.alt}`);
                    
                    // Click the arrow
                    arrow.click();
                    return true;
                }
                return false;
            });
            
            console.log(`JavaScript arrow click result: ${arrowClicked}`);
            await delay(1000);
            
            // Take screenshot after navigation attempt
            await page.screenshot({ path: `./screenshots/test_after_month_nav.png` });
            
            // 2. If JavaScript method didn't work, try explicit selector
            if (!arrowClicked) {
                console.log("Trying explicit selectors for next month arrow...");
                try {
                    // Try a variety of selectors
                    const selectors = [
                        'div[class*="date"] p img:nth-child(2)',
                        'img[src*="right"]',
                        'img[alt*="next"]',
                        '.el-date-picker img:nth-child(2)',
                        '.el-date-table__header img:nth-child(2)'
                    ];
                    
                    for (const selector of selectors) {
                        console.log(`Trying selector: ${selector}`);
                        const arrows = await page.$$(selector);
                        console.log(`Found ${arrows.length} elements with selector: ${selector}`);
                        
                        if (arrows.length > 0) {
                            await arrows[0].click();
                            console.log(`Clicked arrow using selector: ${selector}`);
                            break;
                        }
                    }
                    
                    await delay(1000);
                    await page.screenshot({ path: `./screenshots/test_after_explicit_nav.png` });
                } catch (navErr) {
                    console.error("Error with explicit navigation:", navErr.message);
                }
            }
            
            // Try to click a date in the calendar
            console.log("Attempting to select a date in the calendar...");
            try {
                // Try to find all date cells
                const dateCells = await page.$$('td:not([class*="disabled"]) div, td div:not(.disabled)');
                console.log(`Found ${dateCells.length} selectable dates`);
                
                if (dateCells.length > 0) {
                    // Click on a date in the middle of the month (adjust index if needed)
                    const dateIndex = Math.min(15, dateCells.length - 1);
                    await dateCells[dateIndex].click();
                    console.log(`Clicked date cell at index ${dateIndex}`);
                    
                    await delay(1000);
                    await page.screenshot({ path: `./screenshots/test_date_selected.png` });
                    
                    // Try to click the NEXT button after date selection
                    console.log("Clicking NEXT button...");
                    const nextButtons = await page.$$('button.el-button--primary span');
                    
                    if (nextButtons.length > 0) {
                        await nextButtons[0].click();
                        console.log("Clicked NEXT button");
                        
                        await delay(1000);
                        await page.screenshot({ path: `./screenshots/test_after_next.png` });
                    } else {
                        console.log("Could not find NEXT button");
                    }
                } else {
                    console.log("No selectable dates found");
                }
            } catch (dateErr) {
                console.error("Error selecting date:", dateErr.message);
            }
        } else {
            console.log("No date buttons found");
        }
        
        console.log("Test completed!");
        
        // Keep browser open to see the results
        console.log("Browser will remain open. Close it manually when ready.");
        
    } catch (err) {
        console.error("Error during testing:", err);
        
        // Take a screenshot of the error state
        try {
            const errorScreenshotPath = `./screenshots/test_error-${Date.now()}.png`;
            await page.screenshot({ path: errorScreenshotPath });
            console.log(`Error screenshot saved to: ${errorScreenshotPath}`);
        } catch (screenshotErr) {
            console.error("Failed to take error screenshot:", screenshotErr);
        }
        
        await browser.close();
        process.exit(1);
    }
})(); 