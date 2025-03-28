const puppeteer = require('puppeteer');

/**
 * Script to analyze the calendar DOM structure
 */
(async () => {
    // Launch browser
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: null,
        slowMo: 100,
        args: ['--window-size=1200,900']
    });
    
    const page = await browser.newPage();
    const timeout = 30000;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(60000);

    // Helper function for delays
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    try {
        console.log("Navigating to USJ Express Pass page...");
        await page.goto('https://www.usjticketing.com/expressPass', { 
            waitUntil: 'networkidle2',
            timeout: 60000
        });
        
        // Wait for page to load
        console.log("Waiting for products to load...");
        await page.waitForSelector('div.el-card', { timeout });
        
        // Find product cards
        const productCards = await page.$$('div.el-card');
        console.log(`Found ${productCards.length} product cards on the page`);
        
        // Select a specific product (Express Pass 4)
        const productIndex = 3; // 4th product (0-based index)
        
        if (productCards.length > productIndex) {
            const selectedCard = productCards[productIndex];
            
            // Scroll to the product card
            await selectedCard.scrollIntoViewIfNeeded();
            await delay(1000);
            
            // Find and click the "SELECT A DATE" button
            console.log("Looking for 'SELECT A DATE' button...");
            const dateButton = await selectedCard.$('button.el-button > span');
            
            if (dateButton) {
                console.log("Clicking 'SELECT A DATE' button...");
                await dateButton.click();
                
                // Wait for calendar to appear
                await delay(2000);
                console.log("Taking screenshot of calendar...");
                await page.screenshot({ path: './screenshots/calendar_dom_screenshot.png' });
                
                // Now analyze the calendar DOM structure
                console.log("Analyzing calendar DOM structure...");
                
                // Extract DOM of the calendar
                const calendarInfo = await page.evaluate(() => {
                    // Function to get simplified DOM structure
                    const getSimplifiedDOMStructure = (element, depth = 0, maxDepth = 4) => {
                        if (!element || depth > maxDepth) return null;
                        
                        const result = {
                            tag: element.tagName?.toLowerCase(),
                            id: element.id || null,
                            classes: element.className?.split(' ').filter(c => c) || [],
                            text: element.textContent?.trim().substring(0, 50) || null,
                            children: []
                        };
                        
                        // Add attributes that might help with selection
                        const attributesToCapture = ['src', 'alt', 'role', 'aria-label', 'type', 'name'];
                        result.attributes = {};
                        
                        attributesToCapture.forEach(attr => {
                            if (element.hasAttribute(attr)) {
                                result.attributes[attr] = element.getAttribute(attr);
                            }
                        });
                        
                        // Get children
                        if (depth < maxDepth) {
                            Array.from(element.children).forEach(child => {
                                const childStructure = getSimplifiedDOMStructure(child, depth + 1, maxDepth);
                                if (childStructure) {
                                    result.children.push(childStructure);
                                }
                            });
                        }
                        
                        return result;
                    };
                    
                    // Find all potential calendar elements
                    const calendarElements = [
                        ...document.querySelectorAll('.el-date-table, .el-date-picker, .el-picker-panel, [class*="date"], [class*="calendar"]')
                    ];
                    
                    // Get DOM structure for each potential calendar element
                    const domStructures = calendarElements.map(el => getSimplifiedDOMStructure(el));
                    
                    // Look for the next month navigation button
                    const nextMonthButtons = [];
                    
                    // Look for images that might be navigation arrows
                    document.querySelectorAll('img').forEach(img => {
                        const src = img.src || '';
                        const alt = img.alt || '';
                        
                        if (src.includes('right') || src.includes('next') || 
                            alt.includes('right') || alt.includes('next') ||
                            img.parentElement?.querySelector('img') === img.parentElement?.lastElementChild) {
                            nextMonthButtons.push({
                                tag: 'img',
                                src: src,
                                alt: alt,
                                classes: img.className?.split(' ').filter(c => c) || [],
                                parentTag: img.parentElement?.tagName.toLowerCase() || null,
                                parentClasses: img.parentElement?.className?.split(' ').filter(c => c) || [],
                                siblingImages: img.parentElement ? Array.from(img.parentElement.querySelectorAll('img')).length : 0,
                                isLastChild: img.parentElement?.lastElementChild === img
                            });
                        }
                    });
                    
                    // Look for buttons that might be next month navigation
                    document.querySelectorAll('button, [role="button"], .next, .right').forEach(btn => {
                        const text = btn.textContent?.trim();
                        const hasRightIcon = btn.querySelector('.right-icon, .next-icon, [class*="right"], [class*="next"]');
                        
                        if (text?.includes('Next') || text?.includes('next') || hasRightIcon) {
                            nextMonthButtons.push({
                                tag: btn.tagName.toLowerCase(),
                                text: text,
                                classes: btn.className?.split(' ').filter(c => c) || [],
                                hasRightIcon: !!hasRightIcon
                            });
                        }
                    });
                    
                    // Information about calendar header
                    const calendarHeader = document.querySelector('.el-date-picker__header, .el-date-table__header, .calendar-header');
                    const headerInfo = calendarHeader ? {
                        tag: calendarHeader.tagName.toLowerCase(),
                        classes: calendarHeader.className?.split(' ').filter(c => c) || [],
                        children: Array.from(calendarHeader.children).map(child => ({
                            tag: child.tagName.toLowerCase(),
                            classes: child.className?.split(' ').filter(c => c) || [],
                            text: child.textContent?.trim().substring(0, 50) || null,
                            hasImages: child.querySelectorAll('img').length > 0,
                            imagesCount: child.querySelectorAll('img').length
                        }))
                    } : null;
                    
                    return {
                        calendarElements: domStructures,
                        nextMonthButtons,
                        headerInfo,
                        allImages: Array.from(document.querySelectorAll('img')).map(img => ({
                            src: img.src,
                            alt: img.alt || '',
                            width: img.width,
                            height: img.height,
                            classes: img.className?.split(' ').filter(c => c) || [],
                            parentTag: img.parentElement?.tagName.toLowerCase() || null
                        })).filter(img => img.width > 0 && img.height > 0) // Only visible images
                    };
                });
                
                // Log the calendar info
                console.log(JSON.stringify(calendarInfo, null, 2));
                
                // Save the calendar info to a file
                const fs = require('fs');
                fs.writeFileSync('./calendar_dom_info.json', JSON.stringify(calendarInfo, null, 2));
                console.log("Calendar DOM information saved to calendar_dom_info.json");
                
                // Let's also try to directly locate and click the next month button
                console.log("Trying to locate and click the next month button...");
                
                const clicked = await page.evaluate(() => {
                    // Try several strategies to find the next month button
                    
                    // Strategy 1: Look for an element with a next month role or label
                    const nextButton = document.querySelector('[aria-label*="next month"], [role="button"][aria-label*="next"]');
                    if (nextButton) {
                        nextButton.click();
                        return "Strategy 1: Found button with next month label";
                    }
                    
                    // Strategy 2: Look for images in a parent element (like a header)
                    const dateHeader = document.querySelector('.el-date-picker__header, .el-date-table__header, div[class*="header"]');
                    if (dateHeader) {
                        const images = dateHeader.querySelectorAll('img');
                        if (images.length >= 2) {
                            // Typically second image is for next month
                            images[1].click();
                            return "Strategy 2: Clicked second image in header";
                        } else if (images.length === 1) {
                            // If only one image, check its context
                            images[0].click();
                            return "Strategy 2: Clicked single image in header";
                        }
                    }
                    
                    // Strategy 3: Look for images in a paragraph element (common pattern)
                    const paragraphWithImages = Array.from(document.querySelectorAll('p')).find(p => p.querySelectorAll('img').length >= 2);
                    if (paragraphWithImages) {
                        const images = paragraphWithImages.querySelectorAll('img');
                        // Usually second image is "next"
                        images[1].click();
                        return "Strategy 3: Clicked second image in paragraph";
                    }
                    
                    // Strategy 4: Look for any button with arrow class/icon
                    const arrowButton = document.querySelector('.el-icon-arrow-right, .el-icon-d-arrow-right, [class*="arrow-right"]');
                    if (arrowButton) {
                        arrowButton.click();
                        return "Strategy 4: Clicked button with arrow-right class";
                    }
                    
                    // Strategy 5: Look for any img with src/alt hint
                    const arrowImage = Array.from(document.querySelectorAll('img')).find(img => 
                        (img.src && (img.src.includes('right') || img.src.includes('next'))) || 
                        (img.alt && (img.alt.includes('right') || img.alt.includes('next')))
                    );
                    if (arrowImage) {
                        arrowImage.click();
                        return "Strategy 5: Clicked image with right/next in src/alt";
                    }
                    
                    return "No strategy succeeded";
                });
                
                console.log("Click result:", clicked);
                
                // Check if the month changed after clicking
                await delay(2000);
                await page.screenshot({ path: './screenshots/after_month_navigation_attempt.png' });
                
                console.log("Calendar DOM analysis complete.");
            } else {
                console.log("Could not find SELECT A DATE button");
            }
        } else {
            console.log(`Cannot select product #${productIndex+1} - only ${productCards.length} products found`);
        }
        
        console.log("Analysis completed - browser will remain open");
        // Keep browser open
        
    } catch (err) {
        console.error("Error during analysis:", err);
        
        // Take a screenshot of the error state
        try {
            const errorScreenshotPath = `./screenshots/dom_analysis_error-${Date.now()}.png`;
            await page.screenshot({ path: errorScreenshotPath });
            console.log(`Error screenshot saved to: ${errorScreenshotPath}`);
        } catch (screenshotErr) {
            console.error("Failed to take error screenshot:", screenshotErr);
        }
    }
})(); 