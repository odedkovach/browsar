const puppeteer = require('puppeteer');
const fs = require('fs');
// Load environment variables from .env file
require('dotenv').config();
const OpenAI = require('openai');

// Add enhanced logging functionality
const logFile = fs.createWriteStream('script_logs.txt', { flags: 'a' });
const originalConsoleLog = console.log;
console.log = function() {
  const timestamp = new Date().toISOString();
  const args = Array.from(arguments);
  const message = `[${timestamp}] ${args.join(' ')}`;
  
  // Write to log file
  logFile.write(message + '\n');
  
  // Also log to console as normal
  originalConsoleLog.apply(console, arguments);
};

// Check if a URL was provided as a command-line argument
const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error("Usage: node script.js <target-website-url>");
  process.exit(1);
}

// Helper function to replace the deprecated page.waitForTimeout
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Function to process AI instructions based on current API details
async function processAIInstructions(apiDetails, openai, page) {
  // Check if OpenAI client is valid
  if (!openai || !process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
    console.log('Warning: Valid OpenAI API key not found. Skipping AI analysis and continuing by default.');
    return { action: "CONTINUE", nextElement: null };
  }
  
  // Create a limited version of the API details to prevent token limit issues
  let maxDataLength = 500; // Start with this limit
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount <= maxRetries) {
    try {
      // Filter out analytics requests to focus on important API calls
      const filteredApiDetails = apiDetails.filter(detail => {
        return !detail.url.includes('analytics.google.com') && 
               !detail.url.includes('google-analytics.com') &&
               !detail.url.includes('collect');
      });
      
      const limitedApiDetails = filteredApiDetails.map(detail => {
        const limitedDetail = { ...detail };
        
        // Limit response data size
        if (detail.responseData) {
          if (typeof detail.responseData === 'string' && detail.responseData.length > maxDataLength) {
            limitedDetail.responseData = detail.responseData.substring(0, maxDataLength) + '... [truncated]';
          } else if (typeof detail.responseData === 'object') {
            // Convert to string, then limit if needed
            const responseStr = JSON.stringify(detail.responseData);
            if (responseStr.length > maxDataLength) {
              limitedDetail.responseData = JSON.stringify(detail.responseData, null, 2).substring(0, maxDataLength) + '... [truncated]';
            }
          }
        }
        
        // Only include essential information
        return {
          type: detail.type,
          method: detail.method,
          url: detail.url,
          status: detail.status,
          responseData: limitedDetail.responseData,
        };
      });
      
      // Further reduce the number of entries if we're on a retry
      const maxEntries = Math.max(10, 50 - (retryCount * 15)); // Reduce by 15 entries per retry
      const reducedDetails = limitedApiDetails.slice(-maxEntries); // Keep only the most recent entries
      
      // Get the current page's DOM information to help AI make better decisions
      const domInfo = await page.evaluate(() => {
        // Find all potential interactive elements in the checkout flow
        const interactiveElements = Array.from(document.querySelectorAll('button, a, input, select, .el-button, [role="button"], [class*="product"], [class*="item"], [class*="quantity"], [class*="date"], [class*="add-to-cart"]'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            // Filter elements that are visible on screen
            return rect.width > 0 && 
                   rect.height > 0 && 
                   window.getComputedStyle(el).display !== 'none' && 
                   window.getComputedStyle(el).visibility !== 'hidden';
          })
          .map(el => {
            // Get useful information about each element
            const text = el.innerText || el.textContent || '';
            const id = el.id || '';
            const className = el.className || '';
            const tagName = el.tagName || '';
            const type = el.type || '';
            const value = el.value || '';
            const placeholder = el.placeholder || '';
            const href = el.href || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const title = el.getAttribute('title') || '';
            const hasProductInfo = 
              className.toLowerCase().includes('product') || 
              className.toLowerCase().includes('item') || 
              id.toLowerCase().includes('product') || 
              id.toLowerCase().includes('item');
            
            return {
              text: text.trim(),
              id,
              className,
              tagName,
              type,
              value,
              placeholder,
              href,
              ariaLabel,
              title,
              hasProductInfo
            };
          });
          
        // Get product information (looking for product containers and their selectable options)
        const productElements = Array.from(document.querySelectorAll('[class*="product"], [class*="item"], [id*="product"], [id*="item"]'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(el => {
            // Try to extract product name, price, and any selectable options
            const name = el.querySelector('[class*="name"], [class*="title"]')?.innerText || '';
            const price = el.querySelector('[class*="price"]')?.innerText || '';
            const description = el.querySelector('[class*="description"], [class*="desc"]')?.innerText || '';
            const selectableOptions = Array.from(el.querySelectorAll('button, select, input[type="radio"], input[type="checkbox"]'))
              .map(opt => ({
                type: opt.tagName.toLowerCase(),
                text: opt.innerText || opt.value || '',
                isEnabled: !opt.disabled
              }));
              
            return {
              name,
              price,
              description,
              selectableOptions,
              element: {
                id: el.id || '',
                className: el.className || ''
              }
            };
          });
          
        // Check for date pickers, quantity adjusters, and other common e-commerce inputs
        const dateInputs = Array.from(document.querySelectorAll('[type="date"], [class*="date-picker"], [id*="date"], .calendar'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(el => ({
            id: el.id || '',
            className: el.className || '',
            isEnabled: !el.disabled
          }));
          
        const quantityAdjusters = Array.from(document.querySelectorAll('[class*="quantity"], input[type="number"], [aria-label*="quantity"], [title*="quantity"]'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(el => ({
            id: el.id || '',
            className: el.className || '',
            value: el.value || '',
            isEnabled: !el.disabled
          }));
          
        // Look for cart buttons and checkout buttons
        const cartButtons = Array.from(document.querySelectorAll('[class*="cart"], [id*="cart"], [aria-label*="cart"], [title*="cart"]'))
          .filter(el => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map(el => ({
            text: el.innerText || el.textContent || '',
            id: el.id || '',
            className: el.className || '',
            isEnabled: !el.disabled
          }));

        // Get current page URL and title
        return {
          url: window.location.href,
          title: document.title,
          interactiveElements,
          productElements,
          dateInputs,
          quantityAdjusters,
          cartButtons
        };
      });
      
      const prompt = `
I have collected the following API call details from the USJ Express Pass ticketing flow:
${JSON.stringify(reducedDetails, null, 2)}

Current page DOM information:
${JSON.stringify(domInfo, null, 2)}

You're analyzing the USJ Express Pass ticketing flow. Your goal is to provide detailed analysis and precise instructions for navigating through this specific ticketing process.

## Part 1: Site Analysis
1. Analyze the current stage in the USJ ticketing process by examining both the DOM and recent API calls
2. Identify which specific screen we're on (product selection, quantity selection, date selection, checkout, etc.)
3. Determine if any elements are disabled and what conditions might be needed to enable them

## Part 2: Interaction Strategy
1. Describe in detail the exact sequence of interactions required to progress through this specific screen
2. Specifically mention if:
   - We need to select a ticket type first (which specific ticket type text/ID/class to target)
   - We need to adjust quantity (which specific quantity input to modify, and the exact value to set)
   - We need to select a date (note that date selection is often disabled until quantity is set)
   - We need to select any other options
   
## Part 3: DOM Element Selection
1. For EACH action you recommend, provide the EXACT selector strategy:
   - Exact text content (if the element contains text)
   - CSS class name (prefer full exact class name)
   - ID (if available)
   - Element type and attributes (like 'input[type="number"]')
   - XPath as a last resort
   
2. Make your selectors as specific as possible, but avoid using complex pseudo-selectors like :contains()
   which aren't supported by querySelectorAll

## Part 4: USJ-Specific Instructions
The USJ Express Pass flow typically requires these steps:
1. Product selection (Universal Express Pass 4, 7, etc.)
2. Quantity selection (Must be set before date selection becomes available)
3. Date selection (Only becomes active after a product and quantity are selected)
4. Cart/checkout
5. Payment

In your analysis, determine which step we're on and what is blocking progress to the next step.
Pay special attention to disabled buttons and what might be required to enable them.

## Finally, provide your recommendation in this exact format:
1. **Current Screen**: [Identify the exact screen/step]
2. **Blocking Issues**: [Any elements that are disabled or preventing progress]
3. **Next Actions in Sequence**:
   - Action 1: [Detailed description] → Selector: "[exact DOM selector]"
   - Action 2: [Detailed description] → Selector: "[exact DOM selector]"
   - ...
4. **Decision**: [CONTINUE or STOP with detailed reasoning]

Be extremely precise and explicit about what to click and in what order.
      `;
      
      const aiResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are an expert in web automation, API analysis, and e-commerce checkout flows." },
          { role: "user", content: prompt }
        ]
      });
      
      const instructions = aiResponse.choices[0].message.content;
      console.log('AI instructions:', instructions);
      
      // Parse next element to click from AI response
      let nextElement = null;
      let actionDecision = "CONTINUE";
      
      // If AI says STOP, we should stop
      if (instructions.trim().toUpperCase().includes("DECISION: STOP") || 
          instructions.trim().toUpperCase().includes("DECISION**: STOP")) {
        actionDecision = "STOP";
      }
      
      // Enhanced parsing to extract selectors from the new formatted response
      // First try to extract specific action selectors
      const actionRegex = /Action \d+:.*→\s*Selector:\s*"([^"]+)"/gi;
      const actionMatches = [...instructions.matchAll(actionRegex)];
      
      if (actionMatches.length > 0) {
        // Use the first action's selector
        nextElement = actionMatches[0][1].trim();
      } else {
        // Fall back to older patterns
        const elementMatch = instructions.match(/selector:\s*["']?([^"'\n]+)["']?/i) ||
                            instructions.match(/next element to click:?\s*["']?([^"'\n]+)["']?/i) ||
                            instructions.match(/click\s+(?:on|the)?\s*["']?([^"'\n.,]+)["']?/i) ||
                            instructions.match(/element with text\s*["']?([^"'\n]+)["']?/i) ||
                            instructions.match(/element with id\s*["']?([^"'\n]+)["']?/i) ||
                            instructions.match(/element with class\s*["']?([^"'\n]+)["']?/i);
                            
        if (elementMatch && elementMatch[1]) {
          nextElement = elementMatch[1].trim();
        }
      }
      
      // Clean up the element text by removing any asterisks or quotes
      if (nextElement) {
        nextElement = nextElement.replace(/\*/g, '').replace(/"/g, '').replace(/'/g, '');
      }
      
      console.log('Next element to interact with:', nextElement);
      
      // Return structured response with action and next element
      return { 
        action: actionDecision, 
        nextElement 
      };
    } catch (error) {
      if (error.code === 'context_length_exceeded' && retryCount < maxRetries) {
        console.log(`Token limit exceeded. Retrying with smaller data (Attempt ${retryCount + 1}/${maxRetries})`);
        maxDataLength = Math.floor(maxDataLength / 2); // Cut the data length in half
        retryCount++;
      } else {
        console.error('Error with OpenAI API call:', error.message);
        // If we've exhausted retries or it's a different error, return CONTINUE as default
        return { action: "CONTINUE", nextElement: null };
      }
    }
  }
  
  // If we've exhausted all retries, return CONTINUE as default
  console.log('Exhausted all retry attempts. Continuing by default.');
  return { action: "CONTINUE", nextElement: null };
}

// Helper function: attempt to click ordering-related elements on the page.
// Returns true if a click occurred, false otherwise.
async function deepDiveInteractions(page, aiSuggestedElement = null) {
  // First try to click the element suggested by AI if available
  if (aiSuggestedElement) {
    console.log(`Trying to click AI-suggested element: "${aiSuggestedElement}"`);
    
    // Try multiple strategies to find the element
    try {
      // Try direct querySelector if it looks like a CSS selector
      if (aiSuggestedElement.includes('.') || aiSuggestedElement.includes('#') || 
          aiSuggestedElement.includes('[') || aiSuggestedElement.includes('>')) {
        try {
          const element = await page.$(aiSuggestedElement);
          if (element) {
            await element.click();
            console.log(`Successfully clicked element with selector: "${aiSuggestedElement}"`);
            await wait(3000);
            return true;
          }
        } catch (err) {
          console.log(`Error with direct selector "${aiSuggestedElement}": ${err.message}`);
        }
      }
      
      // First try to find by text content - using evaluate for more flexibility
      const clickedByText = await page.evaluate((elementText) => {
        // Find all elements containing this text
        const elements = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"], [class*="product"], [class*="item"], [class*="add-to-cart"], input[type="number"], select, [class*="quantity"]'));
        const matchingElement = elements.find(el => {
          const text = el.innerText || el.textContent || el.value || '';
          return text.trim().includes(elementText);
        });
        
        if (matchingElement) {
          matchingElement.click();
          return true;
        }
        return false;
      }, aiSuggestedElement);
      
      if (clickedByText) {
        console.log(`Successfully clicked element with text: "${aiSuggestedElement}"`);
        await wait(3000);
        return true;
      }
      
      // Try to find by ID
      if (!aiSuggestedElement.includes(' ') && !aiSuggestedElement.startsWith('.') && !aiSuggestedElement.startsWith('#')) {
        // Try with # prefix (for IDs)
        try {
          const elementById = await page.$(`#${aiSuggestedElement}`);
          if (elementById) {
            await elementById.click();
            console.log(`Successfully clicked element with ID: "${aiSuggestedElement}"`);
            await wait(3000);
            return true;
          }
        } catch (err) {
          console.log(`Error with ID selector "#${aiSuggestedElement}": ${err.message}`);
        }
      }
      
      // Try to find by class
      if (!aiSuggestedElement.includes(' ') && !aiSuggestedElement.startsWith('.') && !aiSuggestedElement.startsWith('#')) {
        // Try with . prefix (for classes)
        try {
          const elementByClass = await page.$(`.${aiSuggestedElement}`);
          if (elementByClass) {
            await elementByClass.click();
            console.log(`Successfully clicked element with class: "${aiSuggestedElement}"`);
            await wait(3000);
            return true;
          }
        } catch (err) {
          console.log(`Error with class selector ".${aiSuggestedElement}": ${err.message}`);
        }
      }
      
      // Try to find quantity input or select by containing the suggested text in attributes
      if (aiSuggestedElement.toLowerCase().includes('quantity') || 
          aiSuggestedElement.toLowerCase().includes('qty') ||
          aiSuggestedElement.toLowerCase().includes('amount') ||
          aiSuggestedElement.toLowerCase().includes('number')) {
        
        console.log('Looking for quantity elements...');
        const quantityElements = await page.$$('input[type="number"], select, [class*="quantity"], [id*="quantity"], [aria-label*="quantity"], .el-input-number, [id*="qty"], [class*="qty"], .NumberInput, [class*="counter"]');
        
        if (quantityElements.length > 0) {
          console.log(`Found ${quantityElements.length} quantity elements`);
          await quantityElements[0].click();
          // Try to enter a value
          try {
            await wait(500);
            // Clear existing value using keyboard shortcuts
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            
            // Enter a value of 2 (important for USJ site)
            await page.keyboard.type('2');
            console.log('Set quantity to 2');
            
            // Try clicking somewhere else to confirm
            await page.evaluate(() => {
              document.body.click();
            });
            
            await wait(2000);
            return true;
          } catch (err) {
            console.log(`Error setting quantity value: ${err.message}`);
            
            // Try clicking increment button instead
            try {
              const incrementButtons = await page.$$('[class*="increase"], [class*="increment"], [class*="plus"], [class*="up"]');
              if (incrementButtons.length > 0) {
                // Click twice to make sure we get to 2
                await incrementButtons[0].click();
                await wait(500);
                await incrementButtons[0].click();
                console.log('Clicked quantity increment button twice');
                await wait(1000);
                return true;
              }
            } catch (incrErr) {
              console.log(`Error clicking increment button: ${incrErr.message}`);
            }
          }
        }
      }
      
      // Try to find by partial match of classes
      const clickedByPartialClass = await page.evaluate((className) => {
        const elements = Array.from(document.querySelectorAll('*'));
        const matchingElement = elements.find(el => {
          return el.className && el.className.includes(className);
        });
        
        if (matchingElement) {
          matchingElement.click();
          return true;
        }
        return false;
      }, aiSuggestedElement);
      
      if (clickedByPartialClass) {
        console.log(`Successfully clicked element with partial class match: "${aiSuggestedElement}"`);
        await wait(3000);
        return true;
      }
    } catch (err) {
      console.log(`Error clicking AI-suggested element "${aiSuggestedElement}": ${err.message}`);
    }
  }
  
  // USJ specific: check for quantity elements before attempting date selection
  try {
    // First, check if we're on the USJ site
    const isUSJ = await page.evaluate(() => {
      return window.location.href.includes('usj') || 
             document.title.includes('USJ') || 
             document.querySelector('img[src*="usj"]') !== null;
    });
    
    if (isUSJ) {
      console.log('Detected USJ ticketing site - checking for product selection and quantity before date selection');
      
      // First, check if we need to select a product category (Express Pass, etc.)
      const productCategories = await page.$$('.card-body-item-base, .card-body-item, [class*="card"], [class*="product-category"]');
      let categoryClicked = false;
      
      for (const category of productCategories) {
        const isVisible = await page.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && 
                 rect.height > 0 && 
                 window.getComputedStyle(el).display !== 'none' && 
                 window.getComputedStyle(el).visibility !== 'hidden';
        }, category);
        
        if (isVisible) {
          const text = await page.evaluate(el => el.innerText || el.textContent || '', category);
          // Check if it's a product category and not already selected
          const isActive = await page.evaluate(el => el.className.includes('active'), category);
          
          if (text && text.includes('EXPRESS') && !isActive) {
            console.log(`Clicking product category: "${text.trim()}"`);
            await category.click();
            console.log('Clicked product category');
            await wait(2000);
            categoryClicked = true;
            break;
          }
        }
      }
      
      // After selecting a category, look for "View Details" buttons
      const viewDetailsButtons = await page.$$('a, button, [role="button"]');
      let viewDetailsClicked = false;
      
      for (const button of viewDetailsButtons) {
        const isVisible = await page.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && 
                 rect.height > 0 && 
                 window.getComputedStyle(el).display !== 'none' && 
                 window.getComputedStyle(el).visibility !== 'hidden';
        }, button);
        
        if (isVisible) {
          // Get text and check if it's a "View Details" link
          const text = await page.evaluate(el => {
            return el.innerText || el.textContent || el.value || '';
          }, button);
          
          if (text && (text.toLowerCase().includes('view details') || text.toLowerCase().includes('details'))) {
            console.log(`Clicking "View Details" button: "${text.trim()}"`);
            await button.click();
            console.log('Clicked View Details button');
            await wait(2000);
            viewDetailsClicked = true;
            break;
          }
        }
      }
      
      // Try to find and interact with any visible quantity inputs
      console.log('Looking for quantity inputs...');
      let quantityFound = false;
      
      // Inject helper script to find visible quantity inputs by style and attributes
      const findVisibleQuantityInputs = await page.evaluate(() => {
        // Common quantity-related classes and attributes in various websites
        const quantitySelectors = [
          'input[type="number"]',
          'select[name*="quantity"]',
          'select[id*="quantity"]',
          'input[name*="quantity"]',
          'input[id*="quantity"]',
          '.NumberInput',
          '.el-input-number',
          '[class*="quantity"]',
          '[class*="qty"]',
          '[class*="counter"]'
        ];
        
        // Try each selector
        const results = [];
        for (const selector of quantitySelectors) {
          try {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0 && 
                  window.getComputedStyle(el).display !== 'none' && 
                  window.getComputedStyle(el).visibility !== 'hidden') {
                
                results.push({
                  selector: selector,
                  tagName: el.tagName,
                  type: el.type,
                  id: el.id,
                  className: el.className,
                  numericInput: el.tagName === 'INPUT' && el.type === 'number'
                });
              }
            }
          } catch (e) {
            // Ignore errors from invalid selectors
          }
        }
        return results;
      });
      
      console.log('Found quantity elements:', findVisibleQuantityInputs);
      
      if (findVisibleQuantityInputs.length > 0) {
        // Focus on the first found quantity input
        for (const qtyInfo of findVisibleQuantityInputs) {
          let qtySelector;
          
          if (qtyInfo.id) {
            qtySelector = `#${qtyInfo.id}`;
          } else if (qtyInfo.className) {
            // Take first class if multiple
            const firstClass = qtyInfo.className.split(' ')[0];
            qtySelector = `.${firstClass}`;
          } else {
            qtySelector = qtyInfo.selector;
          }
          
          try {
            const quantityElement = await page.$(qtySelector);
            if (quantityElement) {
              await quantityElement.click();
              console.log(`Clicked quantity element: ${qtySelector}`);
              await wait(1000);
              
              // Set quantity to 2 - crucial for USJ site
              try {
                await page.keyboard.down('Control');
                await page.keyboard.press('a');
                await page.keyboard.up('Control');
                await page.keyboard.press('Backspace');
                await page.keyboard.type('2');
                console.log('Set quantity to 2');
                
                // Try clicking elsewhere to confirm
                await page.evaluate(() => {
                  document.body.click();
                });
                
                await wait(2000);
                quantityFound = true;
                break;
              } catch (err) {
                console.log(`Error setting quantity: ${err.message}`);
                
                // Try to find increment buttons
                const incrementButtons = await page.$$('[class*="increase"], [class*="increment"], [class*="plus"], [class*="up"]');
                if (incrementButtons.length > 0) {
                  await incrementButtons[0].click();
                  await wait(500);
                  await incrementButtons[0].click();
                  console.log('Clicked increment buttons twice');
                  await wait(1000);
                  quantityFound = true;
                  break;
                }
              }
            }
          } catch (err) {
            console.log(`Error with quantity selector ${qtySelector}: ${err.message}`);
          }
        }
      }
      
      // After setting quantity, check if date buttons are now enabled
      if (quantityFound || viewDetailsClicked || categoryClicked) {
        // Wait a moment for any page updates to settle
        await wait(2000);
        
        // Check for date buttons
        const allButtons = await page.$$('button, [role="button"], [class*="button"]');
        const dateButtons = [];
        
        // Filter buttons related to date selection
        for (const btn of allButtons) {
          try {
            const btnText = await page.evaluate(el => el.innerText || el.textContent || '', btn);
            const isVisible = await page.evaluate(el => {
              const rect = el.getBoundingClientRect();
              return rect.width > 0 && 
                     rect.height > 0 && 
                     window.getComputedStyle(el).display !== 'none' && 
                     window.getComputedStyle(el).visibility !== 'hidden';
            }, btn);
            
            if (isVisible && btnText && 
                (btnText.toLowerCase().includes('date') || 
                 btnText.includes('SELECT A DATE'))) {
              
              // Check if the button is now enabled
              const isDisabled = await page.evaluate(el => {
                return el.disabled || 
                       el.classList.contains('disabled') || 
                       el.getAttribute('aria-disabled') === 'true' ||
                       el.parentElement.classList.contains('disabled');
              }, btn);
              
              dateButtons.push({
                button: btn,
                text: btnText,
                isDisabled: isDisabled
              });
            }
          } catch (err) {
            // Skip buttons with errors
          }
        }
        
        console.log(`Found ${dateButtons.length} date-related buttons`);
        
        // Try to click the first enabled date button
        for (const { button, text, isDisabled } of dateButtons) {
          if (!isDisabled) {
            console.log(`Clicking enabled date button: "${text}"`);
            await button.click();
            console.log('Clicked date selection button');
            await wait(2000);
            return true;
          } else {
            console.log(`Date button "${text}" is still disabled`);
          }
        }
        
        // If we found date buttons but they're all disabled, return true
        // so the AI can analyze why they're still disabled
        if (dateButtons.length > 0) {
          console.log('All date buttons are still disabled after setting quantity');
          return true;
        }
      }
      
      // If we made it here, we need to try more interactions
      return viewDetailsClicked || categoryClicked || quantityFound;
    }
  } catch (err) {
    console.log(`Error with USJ-specific interactions: ${err.message}`);
  }
  
  // If AI-suggested element was not found or not available, fall back to default behavior
  // Enhanced list of checkout-related elements
  const checkoutRelatedSelectors = [
    'button', 'a', 'input[type="submit"]', 'input[type="button"]', 
    '.btn', '.button', '.el-button', '[role="button"]',
    '[class*="product"]', '[class*="item"]', '[class*="add-to-cart"]', 
    '[class*="date-picker"]', '[class*="quantity"]', '[class*="counter"]', '.el-input-number'
  ];
  
  // Check for quantity elements first if we haven't yet focused on them
  if (!aiSuggestedElement || !aiSuggestedElement.toLowerCase().includes('quant')) {
    const quantitySelectors = [
      'input[type="number"]', 
      'select[id*="quantity"]', 
      '[class*="quantity"]', 
      '[id*="quantity"]', 
      '[class*="counter"]',
      '.el-input-number', 
      '[class*="qty"]'
    ];
    
    for (const selector of quantitySelectors) {
      const elements = await page.$$(selector);
      
      for (let element of elements) {
        const isVisible = await page.evaluate(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && 
                 rect.height > 0 && 
                 window.getComputedStyle(el).display !== 'none' && 
                 window.getComputedStyle(el).visibility !== 'hidden';
        }, element);
        
        if (isVisible) {
          try {
            await element.click();
            console.log('Clicked on quantity input/selector');
            await wait(1000);
            
            // Try to set a quantity
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.type('2');
            console.log('Set quantity to 2');
            await wait(1500);
            return true;
          } catch (err) {
            console.log(`Error setting quantity: ${err.message}`);
          }
        }
      }
    }
  }
  
  for (const selector of checkoutRelatedSelectors) {
    const elements = await page.$$(selector);
    
    for (let element of elements) {
      const isVisible = await page.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && 
               rect.height > 0 && 
               window.getComputedStyle(el).display !== 'none' && 
               window.getComputedStyle(el).visibility !== 'hidden';
      }, element);
      
      if (!isVisible) continue;
      
      const text = await page.evaluate(el => el.innerText || el.textContent || el.value || '', element);
      if (text && text.trim().length > 0) {
        // Enhanced regex to match more checkout-related terms
        if (/next|continue|order|checkout|complete|purchase|buy|confirm|submit|proceed|pay|book|reserve|add|select|choose|date|quantity/i.test(text)) {
          console.log(`Clicking element with text: "${text.trim()}"`);
          try {
            await element.click();
            await wait(3000); // Wait for page updates/API calls
            return true;
          } catch (err) {
            console.log(`Error clicking "${text.trim()}": ${err.message}`);
          }
        }
      }
    }
  }
  
  // Enhanced date picker interaction
  try {
    // Try interacting with date pickers if available
    const datePickers = await page.$$('.el-date-picker, .date-picker, [type="date"], [class*="date"], [id*="date"], .calendar, [aria-label*="date"]');
    if (datePickers.length > 0) {
      await datePickers[0].click();
      console.log('Clicked on date picker');
      
      // Wait for date picker to open
      await wait(1000);
      
      // Try to click on a date (usually a valid date in the current month)
      const dateElements = await page.$$('.el-date-table__row td:not(.disabled), .el-date-table__row td.available, .calendar-day:not(.disabled), [class*="calendar"] [class*="day"]:not(.disabled)');
      if (dateElements.length > 0) {
        await dateElements[Math.floor(dateElements.length / 2)].click(); // Click a date in the middle
        console.log('Selected a date');
        await wait(1000);
        return true;
      }
    }
  
    // Try interacting with product selection elements
    const productElements = await page.$$('[class*="product"]:not(.disabled), [class*="item"]:not(.disabled), [class*="ticket"]:not(.disabled)');
    if (productElements.length > 0) {
      // Click on the first product
      await productElements[0].click();
      console.log('Selected a product');
      await wait(1000);
      
      // Look for quantity adjusters
      const quantityAdjusters = await page.$$('[class*="quantity"] input, input[type="number"], [aria-label*="quantity"]');
      if (quantityAdjusters.length > 0) {
        await quantityAdjusters[0].click();
        // Clear the field
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        // Set quantity to 1
        await quantityAdjusters[0].type('1');
        console.log('Set quantity to 1');
        await wait(500);
      }
      
      // Look for add to cart buttons
      const addToCartButtons = await page.$$('[class*="add-to-cart"], [class*="add"], button:contains("Add"), [aria-label*="add to cart"]');
      if (addToCartButtons.length > 0) {
        await addToCartButtons[0].click();
        console.log('Clicked Add to Cart');
        await wait(1000);
      }
      
      return true;
    }

    // Try to fill out any visible text fields with some content
    const textInputs = await page.$$('input[type="text"]:not([disabled]):not([readonly]), input[type="email"], input[type="tel"], input[type="number"], textarea');
    for (let input of textInputs) {
      const isVisible = await page.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && 
               rect.height > 0 && 
               window.getComputedStyle(el).display !== 'none' && 
               window.getComputedStyle(el).visibility !== 'hidden';
      }, input);
      
      if (isVisible) {
        const inputInfo = await page.evaluate(el => {
          return {
            placeholder: el.placeholder || '',
            type: el.type || '',
            id: el.id || '',
            name: el.name || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            className: el.className || ''
          };
        }, input);
        
        // Check various attributes to determine what kind of field this is
        let value = '';
        
        const attrs = [inputInfo.placeholder.toLowerCase(), 
                      inputInfo.id.toLowerCase(), 
                      inputInfo.name.toLowerCase(), 
                      inputInfo.ariaLabel.toLowerCase()];
        
        if (attrs.some(attr => attr.includes('email'))) {
          value = 'test@example.com';
          console.log('Filled email field');
        } else if (attrs.some(attr => attr.includes('name') && attr.includes('first'))) {
          value = 'John';
          console.log('Filled first name field');
        } else if (attrs.some(attr => attr.includes('name') && attr.includes('last'))) {
          value = 'Doe';
          console.log('Filled last name field');
        } else if (attrs.some(attr => attr.includes('name') && !attr.includes('first') && !attr.includes('last'))) {
          value = 'John Doe';
          console.log('Filled name field');
        } else if (attrs.some(attr => attr.includes('phone') || attr.includes('tel'))) {
          value = '1234567890';
          console.log('Filled phone field');
        } else if (attrs.some(attr => attr.includes('zip') || attr.includes('postal'))) {
          value = '12345';
          console.log('Filled postal code field');
        } else if (attrs.some(attr => attr.includes('address'))) {
          value = '123 Main St';
          console.log('Filled address field');
        } else if (attrs.some(attr => attr.includes('city'))) {
          value = 'New York';
          console.log('Filled city field');
        } else if (attrs.some(attr => attr.includes('state'))) {
          value = 'NY';
          console.log('Filled state field');
        } else if (attrs.some(attr => attr.includes('country'))) {
          value = 'United States';
          console.log('Filled country field');
        } else if (inputInfo.type === 'email') {
          value = 'test@example.com';
          console.log('Filled email field (based on type)');
        } else if (inputInfo.type === 'tel') {
          value = '1234567890';
          console.log('Filled phone field (based on type)');
        } else {
          value = 'Test input';
          console.log('Filled text field with default value');
        }
        
        await input.click();
        await input.type(value);
        await wait(500);
      }
    }

    // Try to interact with checkboxes
    const checkboxes = await page.$$('input[type="checkbox"]:not([disabled]):not([checked])');
    for (let checkbox of checkboxes) {
      const isVisible = await page.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && 
               rect.height > 0 && 
               window.getComputedStyle(el).display !== 'none' && 
               window.getComputedStyle(el).visibility !== 'hidden';
      }, checkbox);
      
      if (isVisible) {
        await checkbox.click();
        console.log('Checked a checkbox');
        await wait(300);
      }
    }

    // Also try to select an option from dropdown menus if present
    const selects = await page.$$('select:not([disabled])');
    for (let select of selects) {
      const isVisible = await page.evaluate(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && 
               rect.height > 0 && 
               window.getComputedStyle(el).display !== 'none' && 
               window.getComputedStyle(el).visibility !== 'hidden';
      }, select);
      
      if (isVisible) {
        // Get all option values
        const options = await page.evaluate(el => {
          return Array.from(el.options).map(option => option.value).filter(value => value);
        }, select);
        
        if (options.length > 0) {
          // Select the second option or the first if only one exists
          const optionIndex = options.length > 1 ? 1 : 0;
          await select.select(options[optionIndex]);
          console.log('Selected an option from dropdown');
          await wait(300);
        }
      }
    }
  } catch (err) {
    console.log(`Error interacting with product or form elements: ${err.message}`);
  }
  
  return false;
}

(async () => {
  // Setup OpenAI client, with graceful fallback if API key is missing
  let openai = null;
  try {
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
      // Setup OpenAI client (using API key from environment variables)
      openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log('OpenAI client initialized successfully.');
    } else {
      console.log('No valid OpenAI API key found in .env file. The script will run without AI guidance.');
      console.log('To enable AI guidance, add your API key to the .env file: OPENAI_API_KEY=your_key_here');
    }
  } catch (error) {
    console.error('Error initializing OpenAI client:', error.message);
    console.log('The script will continue without AI guidance.');
  }

  // Launch Puppeteer
  const browser = await puppeteer.launch({ 
    headless: false, // Set to false to see the browser in action
    defaultViewport: { width: 1280, height: 800 }
  });
  const page = await browser.newPage();

  // Array to store API call details
  const apiDetails = [];

  // Capture outgoing XHR/fetch requests
  page.on('request', request => {
    const resourceType = request.resourceType();
    if (resourceType === 'xhr' || resourceType === 'fetch') {
      const url = request.url();
      
      // Skip analytics requests
      if (url.includes('analytics.google.com') || 
          url.includes('google-analytics.com') || 
          url.includes('collect')) {
        return;
      }
      
      const method = request.method();
      const postData = request.postData();
      console.log(`Captured Request: ${method} ${url}`);
      apiDetails.push({
         type: 'request',
         method,
         url,
         postData: postData || null,
         timestamp: new Date().toISOString()
      });
    }
  });

  // Capture responses corresponding to XHR/fetch requests
  page.on('response', async response => {
    const request = response.request();
    const resourceType = request.resourceType();
    if (resourceType === 'xhr' || resourceType === 'fetch') {
      const url = response.url();
      
      // Skip analytics responses
      if (url.includes('analytics.google.com') || 
          url.includes('google-analytics.com') || 
          url.includes('collect')) {
        return;
      }
      
      const status = response.status();
      console.log(`Captured Response: ${status} ${url}`);
      let responseData = null;
      try {
        const headers = response.headers();
        if (headers['content-type'] && headers['content-type'].includes('application/json')) {
          responseData = await response.json();
        } else {
          responseData = await response.text();
        }
      } catch (error) {
        responseData = 'Error retrieving response data';
      }
      apiDetails.push({
         type: 'response',
         url,
         status,
         responseData,
         timestamp: new Date().toISOString()
      });
    }
  });

  // Specific ticket details to purchase
  const targetDetails = {
    productName: "Universal Express Pass 4:4-D & Choice",
    productId: "10009980",
    quantity: 1,
    date: "2025-04-29" // Format: YYYY-MM-DD
  };
  
  console.log(`Starting purchase process for: ${targetDetails.productName}`);
  console.log(`ProductID: ${targetDetails.productId}, Quantity: ${targetDetails.quantity}, Date: ${targetDetails.date}`);
  
  try {
    // Navigate to the USJ Express Pass page
    console.log(`Navigating to ${targetUrl} ...`);
    await page.goto(targetUrl, { waitUntil: 'networkidle2' });
    console.log('Page loaded, waiting for content to stabilize...');
    await wait(5000); // Wait longer for page to fully load

    // 1. First step: Select EXPRESS PASSES category (if not already selected)
    console.log('Looking for EXPRESS PASSES category...');
    
    const categories = await page.$$('.card-body-item-base');
    let expressPassFound = false;
    
    for (const category of categories) {
      const text = await page.evaluate(el => el.innerText || el.textContent || '', category);
      if (text && text.includes('EXPRESS PASSES')) {
        console.log('Found EXPRESS PASSES category, clicking it...');
        await category.click();
        expressPassFound = true;
        await wait(3000);
        break;
      }
    }
    
    if (!expressPassFound) {
      console.log('EXPRESS PASSES category not found or already selected.');
    }
    
    // 2. Find and click "View Details" for our specific product
    console.log(`Looking for product: ${targetDetails.productName}...`);
    
    // Try to find the product card first
    const productFound = await page.evaluate((productName, productId) => {
      const productCards = Array.from(document.querySelectorAll('.product-card, .ticket-card, [class*="product"], [class*="ticket"]'));
      
      for (const card of productCards) {
        const cardText = card.innerText || card.textContent || '';
        // Check if this card contains our target product name
        if (cardText.includes(productName) || 
            cardText.includes(productId) || 
            card.innerHTML.includes(productId)) {
          
          // Find the View Details button within this card and click it
          const detailsLink = card.querySelector('a, button');
          if (detailsLink) {
            detailsLink.click();
            return true;
          }
        }
      }
      
      // Try finding a "View Details" link near our product name
      const allLinks = Array.from(document.querySelectorAll('a, button, [role="button"]'));
      const viewDetailsLink = allLinks.find(link => {
        const linkText = link.innerText || link.textContent || '';
        return linkText.includes('View Details') || linkText.includes('Details');
      });
      
      if (viewDetailsLink) {
        viewDetailsLink.click();
        return true;
      }
      
      return false;
    }, targetDetails.productName, targetDetails.productId);
    
    if (productFound) {
      console.log('Found and clicked product or view details button, waiting...');
      await wait(5000);
    } else {
      console.log('Product not found by name/ID, trying alternative approaches...');
      
      // Try clicking any "View Details" button as a fallback
      const viewDetailsButtons = await page.$$('a, button');
      let viewDetailsClicked = false;
      
      for (const button of viewDetailsButtons) {
        const buttonText = await page.evaluate(el => el.innerText || el.textContent || '', button);
        if (buttonText && (buttonText.includes('View Details') || buttonText.includes('details'))) {
          console.log(`Clicking button with text: "${buttonText.trim()}"`);
          await button.click();
          viewDetailsClicked = true;
          await wait(3000);
          break;
        }
      }
      
      if (!viewDetailsClicked) {
        console.log('No View Details button found, proceeding to next step...');
      }
    }
    
    // 3. Set quantity to the specified value (1)
    console.log(`Setting quantity to ${targetDetails.quantity}...`);
    
    const quantitySet = await page.evaluate((targetQuantity) => {
      // Look for quantity inputs first
      const qtyInputs = document.querySelectorAll('input[type="number"], [class*="quantity-input"], [class*="NumberInput"]');
      
      if (qtyInputs.length > 0) {
        // Set the quantity value
        const input = qtyInputs[0];
        input.value = targetQuantity;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      
      // If no direct inputs found, try increment/decrement buttons
      const qtyContainer = document.querySelector('[class*="quantity"], [class*="NumberInput"], [class*="counter"]');
      if (qtyContainer) {
        // First reset to 1 if needed
        const decrementBtn = qtyContainer.querySelector('[class*="decrease"], [class*="decrement"], [class*="minus"]');
        if (decrementBtn) {
          // Click decrement until we reach minimum (usually 1)
          const currentValue = parseInt(qtyContainer.querySelector('input')?.value || '0');
          for (let i = currentValue; i > 1; i--) {
            decrementBtn.click();
          }
        }
        
        return true;
      }
      
      return false;
    }, targetDetails.quantity);
    
    if (quantitySet) {
      console.log('Quantity set successfully.');
      await wait(2000);
    } else {
      console.log('Could not find quantity input, trying alternative approaches...');
      
      // Try direct selector approaches
      try {
        const quantityInputs = await page.$$('input[type="number"], [class*="quantity"], [class*="NumberInput"]');
        if (quantityInputs.length > 0) {
          await quantityInputs[0].click();
          await wait(500);
          
          // Clear existing value
          await page.keyboard.down('Control');
          await page.keyboard.press('a');
          await page.keyboard.up('Control');
          await page.keyboard.press('Backspace');
          
          // Set quantity
          await page.keyboard.type(targetDetails.quantity.toString());
          console.log(`Set quantity to ${targetDetails.quantity}`);
          
          // Click elsewhere to confirm
          await page.evaluate(() => {
            document.body.click();
          });
          
          await wait(2000);
        } else {
          console.log('No quantity inputs found.');
        }
      } catch (err) {
        console.log(`Error setting quantity: ${err.message}`);
      }
    }
    
    // 4. Try to select a date button (which should now be enabled)
    console.log('Looking for date selection button...');
    
    const dateButtonClicked = await page.evaluate(() => {
      const dateButtons = Array.from(document.querySelectorAll('button, [role="button"]')).filter(btn => {
        const text = btn.innerText || btn.textContent || '';
        return text.includes('SELECT A DATE') || text.toLowerCase().includes('date');
      });
      
      // Find an enabled date button
      const enabledButton = dateButtons.find(btn => {
        return !btn.disabled && 
               !btn.classList.contains('disabled') && 
               btn.getAttribute('aria-disabled') !== 'true' &&
               !btn.parentElement.classList.contains('disabled');
      });
      
      if (enabledButton) {
        enabledButton.click();
        return true;
      }
      
      return false;
    });
    
    if (dateButtonClicked) {
      console.log('Date selection button clicked successfully, waiting for calendar...');
      await wait(3000);
    } else {
      console.log('No enabled date button found, trying forced click approach...');
      
      // Try to force-click date buttons even if they appear disabled
      const allButtons = await page.$$('button, [role="button"]');
      
      for (const btn of allButtons) {
        const btnText = await page.evaluate(el => el.innerText || el.textContent || '', btn);
        
        if (btnText && (btnText.includes('SELECT A DATE') || btnText.toLowerCase().includes('date'))) {
          // Try to click it anyway
          try {
            await btn.click({ force: true });
            console.log(`Force-clicked date button with text: "${btnText.trim()}""`);
            await wait(3000);
            break;
          } catch (err) {
            console.log(`Could not force-click date button: ${err.message}`);
          }
        }
      }
    }
    
    // 5. Try to select the specific date from the calendar (2025-04-29)
    console.log(`Attempting to select date: ${targetDetails.date}...`);
    
    const dateParts = targetDetails.date.split('-');
    const targetYear = parseInt(dateParts[0]);
    const targetMonth = parseInt(dateParts[1]) - 1; // JavaScript months are 0-based
    const targetDay = parseInt(dateParts[2]);
    
    // First, navigate to the correct month/year
    const dateNavigated = await page.evaluate((targetYear, targetMonth, targetDay) => {
      // Check if calendar is present
      const calendar = document.querySelector('.el-date-picker, .calendar, [class*="calendar"], [class*="datepicker"]');
      if (!calendar) return false;
      
      // Try to navigate to the right year/month
      const nextMonthButton = calendar.querySelector('[class*="next"], [aria-label*="next month"], [class*="arrow-right"]');
      const prevMonthButton = calendar.querySelector('[class*="prev"], [aria-label*="previous month"], [class*="arrow-left"]');
      
      // Try to find current month/year indicator
      const monthYearDisplay = calendar.querySelector('[class*="header"], [class*="current-month"]');
      const currentMonthYearText = monthYearDisplay ? (monthYearDisplay.innerText || monthYearDisplay.textContent || '') : '';
      
      // Rough logic to navigate to target date
      // This is simplified - real calendar navigation would need more complex logic
      if (nextMonthButton && currentMonthYearText) {
        const currentYear = new Date().getFullYear();
        const yearsToAdvance = targetYear - currentYear;
        
        // Click next month button to advance to target month
        // This is a simplistic approach - real calendars may have year/month dropdowns
        for (let i = 0; i < yearsToAdvance * 12 + targetMonth; i++) {
          nextMonthButton.click();
        }
      }
      
      // Now try to select the target day
      const dayElements = Array.from(calendar.querySelectorAll('td, [class*="day"]'));
      const targetDayElement = dayElements.find(day => {
        const dayText = day.innerText || day.textContent || '';
        return dayText === targetDay.toString() && !day.classList.contains('disabled');
      });
      
      if (targetDayElement) {
        targetDayElement.click();
        return true;
      }
      
      return false;
    }, targetYear, targetMonth, targetDay);
    
    if (dateNavigated) {
      console.log(`Successfully selected date: ${targetDetails.date}`);
      await wait(3000);
    } else {
      console.log('Could not navigate to or select the target date.');
      console.log('Looking for any available date as a fallback...');
      
      // Try to click any available date
      const dateClicked = await page.evaluate(() => {
        const calendar = document.querySelector('.el-date-picker, .calendar, [class*="calendar"], [class*="datepicker"]');
        if (!calendar) return false;
        
        const availableDays = Array.from(calendar.querySelectorAll('td, [class*="day"]:not(.disabled)')).filter(day => {
          return !day.classList.contains('disabled') && 
                 !day.getAttribute('aria-disabled') === 'true' &&
                 day.innerText.trim() !== '';
        });
        
        if (availableDays.length > 0) {
          // Click an available date in the middle of the list
          availableDays[Math.floor(availableDays.length / 2)].click();
          return true;
        }
        
        return false;
      });
      
      if (dateClicked) {
        console.log('Clicked on an available date as fallback');
        await wait(3000);
      } else {
        console.log('Could not find any available dates');
      }
    }
    
    // 6. NEW STEP: Select the first available time option
    console.log('Looking for time selection options...');
    
    const timeSelected = await page.evaluate(() => {
      // Look for time selection containers/elements
      const timeOptions = Array.from(document.querySelectorAll(
        '[class*="time-slot"], [class*="time-option"], [class*="timeSlot"], select[name*="time"], [id*="time"], [aria-label*="time"], [class*="time"]'
      )).filter(el => {
        // Ensure the element is visible and enabled
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && 
               style.visibility !== 'hidden' && 
               !el.disabled && 
               !el.classList.contains('disabled') && 
               el.getAttribute('aria-disabled') !== 'true';
      });
      
      if (timeOptions.length > 0) {
        // If it's a select dropdown
        if (timeOptions[0].tagName === 'SELECT') {
          const select = timeOptions[0];
          // Get all available options
          const options = Array.from(select.options);
          // Find first non-disabled option after the default/placeholder option
          const firstValidOption = options.find((opt, index) => {
            return index > 0 && !opt.disabled && opt.value;
          }) || options[0]; // Fallback to first option if no valid ones found
          
          select.value = firstValidOption.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          return { selected: true, type: 'dropdown', value: firstValidOption.value };
        }
        
        // If it's a list of time slots (like buttons or divs)
        const firstAvailableSlot = timeOptions[0];
        firstAvailableSlot.click();
        return { selected: true, type: 'slot', text: firstAvailableSlot.innerText || 'Time slot' };
      }
      
      // If time selection is a radio button group
      const timeRadios = Array.from(document.querySelectorAll(
        'input[type="radio"][name*="time"], [role="radio"][aria-label*="time"]'
      )).filter(el => !el.disabled && !el.checked);
      
      if (timeRadios.length > 0) {
        timeRadios[0].click();
        return { selected: true, type: 'radio' };
      }
      
      // If time selection is embedded in a calendar-like interface
      const timeElements = Array.from(document.querySelectorAll(
        'td[data-time], [data-slot], [data-time], button[aria-label*="time"]'
      )).filter(el => {
        return !el.classList.contains('disabled') && 
               !el.getAttribute('aria-disabled') === 'true';
      });
      
      if (timeElements.length > 0) {
        timeElements[0].click();
        return { selected: true, type: 'calendar element' };
      }
      
      return { selected: false };
    });
    
    if (timeSelected.selected) {
      console.log(`Successfully selected time (${timeSelected.type}${timeSelected.value ? ': ' + timeSelected.value : ''}${timeSelected.text ? ': ' + timeSelected.text : ''})`);
      await wait(3000);
    } else {
      console.log('No time selection options found or time selection not required');
    }
    
    // 7. Look for and click any ADD TO CART or CHECKOUT buttons
    console.log('Looking for ADD TO CART or CHECKOUT button...');
    
    const checkoutClicked = await page.evaluate(() => {
      const checkoutButtons = Array.from(document.querySelectorAll('button, a, [role="button"]')).filter(btn => {
        const text = btn.innerText || btn.textContent || '';
        return text.includes('ADD TO CART') || 
               text.includes('CHECKOUT') || 
               text.includes('BUY NOW') || 
               text.includes('PURCHASE') ||
               text.includes('PROCEED');
      });
      
      // Find an enabled checkout button
      const enabledButton = checkoutButtons.find(btn => {
        return !btn.disabled && 
               !btn.classList.contains('disabled') && 
               btn.getAttribute('aria-disabled') !== 'true';
      });
      
      if (enabledButton) {
        enabledButton.click();
        return true;
      }
      
      return false;
    });
    
    if (checkoutClicked) {
      console.log('Checkout button clicked successfully!');
      await wait(5000);
      console.log('Purchase process completed up to checkout stage.');
    } else {
      console.log('No enabled checkout button found.');
      console.log('Purchase process completed up to date selection stage.');
    }
    
    // Save the API details captured during the process
    fs.writeFileSync('api_details.json', JSON.stringify(apiDetails, null, 2));
    console.log('API call details saved to api_details.json');
    
    // Keep the browser open for manual inspection
    console.log('Process complete! Browser will remain open for manual inspection.');
    // Remove this line if you want the browser to close automatically:
    // await browser.close();
    
  } catch (error) {
    console.error('Error during purchase process:', error);
    fs.writeFileSync('api_details.json', JSON.stringify(apiDetails, null, 2));
    console.log('API call details saved to api_details.json despite error');
  }
})();
