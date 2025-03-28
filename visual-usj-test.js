const puppeteer = require('puppeteer');

/**
 * Simplified USJ Express Pass Purchase Test
 * This script has intentional delays and screenshots to help troubleshoot
 * the ticket purchasing process
 */
(async () => {
    // Use a longer slowMo value to make actions more visible
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        slowMo: 200, // Much slower execution for visibility
        args: ['--window-size=1200,900']
    });
    
    const page = await browser.newPage();
    const timeout = 30000;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(60000);

    // Helper function for explicit delays
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    try {
        console.log("Starting test of USJ ticket purchase");
        
        // Navigate to the website
        console.log("Navigating to USJ Express Pass page...");
        await page.goto('https://www.usjticketing.com/expressPass', { 
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Wait for page to load
        console.log("Waiting for products to load...");
        await page.waitForSelector('div.el-card', { timeout });
        
        // Take a screenshot of the initial page
        await page.screenshot({ path: './screenshots/visual_1_initial.png' });
        console.log("Page loaded - screenshot saved");
        await delay(2000);
        
        // Find all product cards and log them
        const productCards = await page.$$('div.el-card');
        console.log(`Found ${productCards.length} product cards on the page`);
        
        // Select a specific product (Express Pass 4)
        const productIndex = 3; // Try product #4 (0-based index, so this is actually the 4th product)
        
        if (productCards.length > productIndex) {
            const selectedCard = productCards[productIndex];
            
            // Scroll to the product card
            await selectedCard.scrollIntoViewIfNeeded();
            await delay(1000);
            
            // Extract product name for better logging
            const productName = await selectedCard.$eval('div.name', el => el.textContent.trim())
                .catch(() => `Product ${productIndex+1}`);
            
            console.log(`Selected product: ${productName}`);
            await page.screenshot({ path: './screenshots/visual_1b_product_selected.png' });
            await delay(1000);
            
            // Find the quantity controls
            console.log("Finding quantity controls...");
            const plusButton = await selectedCard.$('span.plus');
            
            if (plusButton) {
                console.log("Found quantity plus button");
                
                // Click to increase quantity to 2
                console.log("Increasing quantity to 2...");
                await plusButton.click();
                
                // Give some time to see the change
                await delay(2000);
                
                // Take a screenshot after setting quantity
                await page.screenshot({ path: './screenshots/visual_2_quantity_set.png' });
                console.log("Quantity set - screenshot saved");
                
                // Now find and click the "SELECT A DATE" button
                console.log("Looking for 'SELECT A DATE' button...");
                const dateButton = await selectedCard.$('button.el-button > span');
                
                if (dateButton) {
                    console.log("Found 'SELECT A DATE' button");
                    await delay(1000);
                    
                    console.log("Clicking 'SELECT A DATE' button...");
                    await dateButton.click();
                    
                    // Wait for calendar to appear
                    await delay(2000);
                    await page.screenshot({ path: './screenshots/visual_3_calendar.png' });
                    console.log("Calendar opened - screenshot saved");
                    
                    // Check if the calendar appeared
                    const calendar = await page.$('.el-date-table');
                    if (calendar) {
                        console.log("Calendar opened successfully");
                        
                        // First, let's try to navigate to the next month
                        console.log("Attempting to navigate to next month...");
                        
                        // Try to find the next month navigation arrow with various selectors
                        let nextMonthClicked = false;
                        
                        // Method 1: Try to find any image that might be a right arrow
                        try {
                            console.log("Looking for next month arrow (method 1)...");
                            const arrowImages = await page.$$('img[src*="right"], img[src*="next"], img[alt*="right"], img[alt*="next"], div.el-date-picker p > img:nth-child(2)');
                            
                            if (arrowImages && arrowImages.length > 0) {
                                console.log(`Found ${arrowImages.length} potential arrow images`);
                                
                                // Click the most likely arrow (second image in many cases)
                                const arrowToClick = arrowImages.length > 1 ? arrowImages[1] : arrowImages[0];
                                console.log("Clicking a potential next month arrow...");
                                await arrowToClick.click();
                                await delay(2000);
                                await page.screenshot({ path: './screenshots/visual_3b_after_arrow_click.png' });
                                console.log("Clicked next month arrow - screenshot saved");
                                nextMonthClicked = true;
                            }
                        } catch (arrowErr) {
                            console.log("Method 1 failed:", arrowErr.message);
                        }
                        
                        // Method 2: Use evaluate to find and click the arrow if method 1 failed
                        if (!nextMonthClicked) {
                            try {
                                console.log("Looking for next month arrow (method 2)...");
                                await page.screenshot({ path: './screenshots/visual_3c_before_js_arrow.png' });
                                
                                const arrowClicked = await page.evaluate(() => {
                                    // Try to find all potential next month arrows
                                    const arrows = [];
                                    
                                    // Look for images in date picker header
                                    document.querySelectorAll('div[class*="date"] p img').forEach(img => arrows.push(img));
                                    
                                    // Look for right/next arrows by image source or alt text
                                    document.querySelectorAll('img').forEach(img => {
                                        const src = img.src.toLowerCase();
                                        const alt = (img.alt || '').toLowerCase();
                                        if (src.includes('right') || src.includes('next') || 
                                            alt.includes('right') || alt.includes('next')) {
                                            arrows.push(img);
                                        }
                                    });
                                    
                                    console.log(`Found ${arrows.length} potential arrows in JavaScript`);
                                    
                                    // If we found potential arrows, click the most likely one
                                    // (usually the right-most one or second one in a date picker header)
                                    if (arrows.length > 0) {
                                        // If we have multiple arrows, try to get the one that's the next month button
                                        let arrowToClick = arrows[0];
                                        
                                        if (arrows.length > 1) {
                                            // Try to find the arrow in the date picker header
                                            for (const arrow of arrows) {
                                                const parent = arrow.parentElement;
                                                if (parent && parent.tagName.toLowerCase() === 'p') {
                                                    // If this is in a paragraph, likely the date picker header
                                                    // Get the second image (first is usually prev month, second is next month)
                                                    const images = Array.from(parent.querySelectorAll('img'));
                                                    if (images.length > 1) {
                                                        arrowToClick = images[1]; // Second image is typically next month
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                        
                                        // Click the arrow
                                        arrowToClick.click();
                                        return true;
                                    }
                                    return false;
                                });
                                
                                await delay(2000);
                                await page.screenshot({ path: './screenshots/visual_3d_after_js_arrow.png' });
                                
                                if (arrowClicked) {
                                    console.log("Successfully clicked next month arrow using JavaScript");
                                    nextMonthClicked = true;
                                } else {
                                    console.log("JavaScript click method didn't find an arrow to click");
                                }
                            } catch (jsErr) {
                                console.log("Method 2 failed:", jsErr.message);
                            }
                        }
                        
                        // Method 3: Try direct CSS selector if methods 1 and 2 failed
                        if (!nextMonthClicked) {
                            try {
                                console.log("Looking for next month arrow (method 3)...");
                                const directSelectors = [
                                    'div.el-date-picker__header p img:nth-child(2)',
                                    'div.el-date-picker div[class*="header"] p img:nth-child(2)',
                                    'button.el-picker-panel__icon-btn.el-date-picker__next-btn',
                                    '.el-date-table__header + * .next',
                                    'p:has(img:nth-child(1)) > img:nth-child(2)'
                                ];
                                
                                for (const selector of directSelectors) {
                                    const arrowElement = await page.$(selector);
                                    if (arrowElement) {
                                        console.log(`Found arrow with selector: ${selector}`);
                                        await arrowElement.click();
                                        await delay(2000);
                                        await page.screenshot({ path: './screenshots/visual_3e_after_direct_arrow.png' });
                                        console.log("Clicked next month arrow with direct selector");
                                        nextMonthClicked = true;
                                        break;
                                    }
                                }
                            } catch (directErr) {
                                console.log("Method 3 failed:", directErr.message);
                            }
                        }
                        
                        // Now try to select a date, whether or not we navigated to the next month
                        console.log("Looking for available dates...");
                        
                        // Get all date cells that aren't disabled
                        const dateCells = await page.$$('td:not(.disabled) > div');
                        console.log(`Found ${dateCells.length} available dates`);
                        
                        if (dateCells.length > 0) {
                            // Select a date in the middle of the available dates
                            const dateIndex = Math.min(Math.floor(dateCells.length / 2), dateCells.length - 1);
                            const dateCell = dateCells[dateIndex];
                            
                            console.log(`Selecting date #${dateIndex+1}...`);
                            await delay(1000);
                            
                            await dateCell.click();
                            await delay(2000);
                            await page.screenshot({ path: './screenshots/visual_4_date_selected.png' });
                            console.log("Date selected - screenshot saved");
                            
                            // Click the NEXT button
                            console.log("Looking for NEXT button...");
                            const nextButton = await page.$('button.el-button--primary > span');
                            
                            if (nextButton) {
                                console.log("Found NEXT button");
                                await delay(1000);
                                
                                console.log("Clicking NEXT button...");
                                await nextButton.click();
                                await delay(2000);
                                
                                // Look for session selection
                                console.log("Looking for session options...");
                                const sessionRadios = await page.$$('.el-radio__input');
                                console.log(`Found ${sessionRadios.length} session options`);
                                
                                if (sessionRadios.length > 0) {
                                    // Select the first session
                                    const sessionRadio = sessionRadios[0];
                                    console.log("Selecting first session...");
                                    await delay(1000);
                                    
                                    await sessionRadio.click();
                                    await delay(2000);
                                    await page.screenshot({ path: './screenshots/visual_5_session_selected.png' });
                                    console.log("Session selected - screenshot saved");
                                    
                                    // Click ADD TO CART button
                                    console.log("Looking for ADD TO CART button...");
                                    const addToCartButton = await page.$('button.el-button--success > span');
                                    
                                    if (addToCartButton) {
                                        console.log("Found ADD TO CART button");
                                        await delay(1000);
                                        
                                        console.log("Clicking ADD TO CART button...");
                                        
                                        // Set up navigation wait
                                        const navPromise = page.waitForNavigation({ 
                                            timeout: 30000,
                                            waitUntil: 'networkidle2'
                                        });
                                        
                                        // Click the button
                                        await addToCartButton.click();
                                        
                                        // Wait for navigation
                                        console.log("Waiting for page to navigate to cart...");
                                        await navPromise;
                                        
                                        await delay(2000);
                                        await page.screenshot({ path: './screenshots/visual_6_cart.png' });
                                        console.log("Cart page loaded - screenshot saved");
                                        
                                        // Check if we're on the cart page
                                        const cartTitle = await page.$('h1.title');
                                        if (cartTitle) {
                                            const titleText = await cartTitle.evaluate(el => el.textContent.trim());
                                            console.log(`Current page: ${titleText}`);
                                        }
                                        
                                        // Check the cart subtotal
                                        console.log("Checking cart subtotal...");
                                        const subtotalElement = await page.$('.subtotal-amount');
                                        
                                        if (subtotalElement) {
                                            const subtotal = await subtotalElement.evaluate(el => el.textContent.trim());
                                            console.log(`Cart subtotal: ${subtotal}`);
                                            
                                            if (subtotal === '0' || subtotal === '¥0') {
                                                console.log("ERROR: Cart subtotal is zero - the item was not added correctly");
                                            } else {
                                                console.log("SUCCESS: Item was successfully added to cart");
                                            }
                                        } else {
                                            console.log("Could not find cart subtotal element");
                                        }
                                    } else {
                                        console.log("Could not find ADD TO CART button");
                                    }
                                } else {
                                    console.log("No session options found");
                                }
                            } else {
                                console.log("Could not find NEXT button");
                            }
                        } else {
                            console.log("No available dates found in the current month");
                            
                            // Try to navigate to next month
                            console.log("Looking for next month button...");
                            const nextMonthButton = await page.$('p > img:last-child');
                            
                            if (nextMonthButton) {
                                console.log("Found next month button");
                                await delay(1000);
                                
                                console.log("Clicking next month button...");
                                await nextMonthButton.click();
                                await delay(2000);
                                
                                // Try again with next month dates
                                const nextMonthDateCells = await page.$$('td:not(.disabled) > div');
                                console.log(`Found ${nextMonthDateCells.length} available dates in next month`);
                                
                                if (nextMonthDateCells.length > 0) {
                                    // Select a date
                                    const dateIndex = Math.min(Math.floor(nextMonthDateCells.length / 2), nextMonthDateCells.length - 1);
                                    const dateCell = nextMonthDateCells[dateIndex];
                                    
                                    console.log(`Selecting date #${dateIndex+1} from next month...`);
                                    await delay(1000);
                                    
                                    await dateCell.click();
                                    // continue with the flow...
                                } else {
                                    console.log("No available dates found in next month either");
                                }
                            } else {
                                console.log("Could not find next month button");
                            }
                        }
                    } else {
                        console.log("Calendar did not appear after clicking button");
                    }
                } else {
                    console.log("Could not find SELECT A DATE button");
                }
            } else {
                console.log("Could not find quantity plus button");
            }
        } else {
            console.log(`Cannot select product #${productIndex+1} - only ${productCards.length} products found`);
        }

        console.log("Test completed - browser will remain open");
        // Keep browser open to see the results
        
    } catch (err) {
        console.error("Error during test:", err);
        
        // Take a screenshot of the error state
        try {
            const errorScreenshotPath = `./screenshots/visual_error-${Date.now()}.png`;
            await page.screenshot({ path: errorScreenshotPath });
            console.log(`Error screenshot saved to: ${errorScreenshotPath}`);
        } catch (screenshotErr) {
            console.error("Failed to take error screenshot:", screenshotErr);
        }
    }
})(); 