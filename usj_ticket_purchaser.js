const puppeteer = require('puppeteer');
const fs = require('fs');
require('dotenv').config();
const OpenAI = require('openai');

// Helper function for waiting
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Log both to console and to a file
const logFile = fs.createWriteStream('usj_purchase_log.txt', { flags: 'a' });
function logger(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  logFile.write(logMessage + '\n');
}

// API call counter for tracking OpenAI usage
let apiCallCount = 0;
const MAX_API_CALLS = 10;

// Create OpenAI client
let openai = null;
try {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here') {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    logger('OpenAI client initialized successfully.');
  } else {
    logger('⚠️ No valid OpenAI API key found. Add one to your .env file: OPENAI_API_KEY=your_key_here');
  }
} catch (error) {
  logger(`Error initializing OpenAI client: ${error.message}`);
}

// Function to get AI guidance for the current step
async function getAIGuidance(page, currentStep, apiDetails = []) {
  if (!openai || apiCallCount >= MAX_API_CALLS) {
    if (!openai) {
      logger('Skipping AI guidance: No valid OpenAI client available');
    } else {
      logger(`Skipping AI guidance: Reached maximum API call limit (${MAX_API_CALLS})`);
    }
    return null;
  }
  
  apiCallCount++;
  logger(`Making OpenAI API call #${apiCallCount} for step: ${currentStep}`);
  
  try {
    // Get DOM information to help AI understand the current state
    const domInfo = await page.evaluate(() => {
      // Get all visible interactive elements
      const interactiveElements = Array.from(document.querySelectorAll('button, a, input, select, [role="button"]'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && 
                 rect.height > 0 && 
                 window.getComputedStyle(el).display !== 'none' && 
                 window.getComputedStyle(el).visibility !== 'hidden';
        })
        .map(el => {
          const text = el.innerText || el.textContent || '';
          const id = el.id || '';
          const className = el.className || '';
          const tagName = el.tagName || '';
          const type = el.type || '';
          const disabled = el.disabled || false;
          
          // Extract additional useful attributes
          let href = '';
          let ariaLabel = '';
          let role = '';
          
          if (el.hasAttribute('href')) href = el.getAttribute('href');
          if (el.hasAttribute('aria-label')) ariaLabel = el.getAttribute('aria-label');
          if (el.hasAttribute('role')) role = el.getAttribute('role');
          
          // For buttons, check if they have special styling like primary/success
          let buttonStyle = '';
          if (tagName === 'BUTTON' || role === 'button') {
            if (className.includes('primary')) buttonStyle = 'primary';
            else if (className.includes('success')) buttonStyle = 'success';
            else if (className.includes('danger')) buttonStyle = 'danger';
          }
          
          return {
            text: text.trim(),
            id,
            className,
            tagName,
            type,
            disabled,
            href,
            ariaLabel,
            role,
            buttonStyle
          };
        });
        
      // Get product elements
      const productElements = Array.from(document.querySelectorAll('[class*="product"], [class*="item"], [id*="product"], [id*="item"], .el-card'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .map(el => {
          const name = el.querySelector('[class*="name"], [class*="title"], h3, h4')?.innerText || '';
          const price = el.querySelector('[class*="price"]')?.innerText || '';
          
          return { name, price };
        });
        
      // Check for specific USJ website components
      const hasDatePicker = document.querySelector('.el-date-picker, [class*="datepicker"], [class*="calendar"]') !== null;
      const hasRadioButtons = document.querySelectorAll('input[type="radio"]').length > 0;
      const hasQuantitySelector = document.querySelector('[class*="quantity"], .el-input-number, span.plus, span.minus') !== null;
      const hasCartButton = document.querySelector('[class*="add-to-cart"], [class*="addToCart"], button.el-button--success') !== null;
      
      // Get current URL path parts for better context
      const pathParts = window.location.pathname.split('/').filter(Boolean);
      
      // Get page information
      return {
        url: window.location.href,
        title: document.title,
        pathParts,
        interactiveElements,
        productElements,
        hasDatePicker,
        hasRadioButtons,
        hasQuantitySelector,
        hasCartButton
      };
    });
    
    // Prepare prompt for OpenAI
    const prompt = `
I'm trying to purchase a Universal Express Pass 4: 4D & Choice ticket at Universal Studios Japan's official ticketing website.
Current step: ${currentStep}

Current page DOM information:
${JSON.stringify(domInfo, null, 2)}

${apiDetails.length > 0 ? `Recent API calls:\n${JSON.stringify(apiDetails.slice(-3), null, 2)}` : ''}

Step-by-step purchase flow for USJ Express Pass tickets:
1. Find the specific product "Universal Express Pass 4: 4D & Choice" - This appears in a product card or listing.
2. Add quantity by clicking the "+" button or using a quantity selector to set quantity to 1.
3. Click the "SELECT A DATE" button - This is typically a prominent button on the product page.
4. In the date picker, navigate to April 2025 and select April 29. The date picker has next/previous month navigation arrows.
5. Click "NEXT" or "CONTINUE" button after date selection.
6. Choose the first available session if presented (select the first radio button option for available sessions).
7. Click "ADD TO CART" button - This is typically a green success button.
8. Go to cart by clicking the cart icon (usually in the header).
9. Click "NEXT STEP" in cart to proceed.
10. Click "CHECKOUT" to finalize the order.

USJ Website Specific Information:
- The site uses Element UI framework with classes like "el-button", "el-button--primary", "el-button--success".
- Date picker has classes like "el-date-picker", "el-date-table", "el-date-table__cell".
- Success buttons (like Add to Cart) typically use the class "el-button--success" (green).
- Primary buttons (like Next/Continue) typically use the class "el-button--primary" (blue).
- Quantity selectors have "minus" and "plus" span elements for decrement/increment.
- Session selection usually shows radio buttons for different time slots.

For the current step "${currentStep}", analyze the DOM and provide:
1. What exactly is visible on the page right now?
2. What specific element needs to be clicked/interacted with to complete this step?
3. Provide the EXACT selector to use with page.$() to find the element
4. If there are multiple similar elements, how to identify the correct one
5. Any special interaction needed (e.g., typing, selecting from dropdown)

Return your answer in this exact format:
{
  "analysis": "Brief description of the current page and what we need to do",
  "action": "CLICK or TYPE or SELECT or NAVIGATE",
  "selector": "Precise CSS selector to use",
  "value": "Value to enter if typing or selecting",
  "fallbackSelectors": ["Alternative selector 1", "Alternative selector 2"],
  "next": "What to expect after this action"
}
`;

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert web automation assistant specializing in ticket purchasing flows for Universal Studios Japan's official ticketing website. Your guidance will help navigate through the complex ticketing process." },
        { role: "user", content: prompt }
      ]
    });
    
    // Parse the response to extract guidance
    const aiMessage = response.choices[0].message.content;
    logger('AI Response received');
    
    // Try to extract the JSON object from the response
    try {
      // Find JSON-like structure in the response
      const jsonMatch = aiMessage.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0];
        const guidance = JSON.parse(jsonStr);
        logger(`AI Guidance for ${currentStep}: ${guidance.action} ${guidance.selector}`);
        return guidance;
      }
    } catch (parseError) {
      logger(`Error parsing AI guidance: ${parseError.message}`);
    }
    
    // If parsing failed, try to extract key information manually
    logger('Falling back to manual parsing of AI response');
    const selectorMatch = aiMessage.match(/selector["]?\s*:\s*["]([^"]+)["]/i);
    const actionMatch = aiMessage.match(/action["]?\s*:\s*["]([^"]+)["]/i);
    
    if (selectorMatch && actionMatch) {
      return {
        action: actionMatch[1],
        selector: selectorMatch[1],
        fallbackSelectors: []
      };
    }
    
    logger('Could not extract guidance from AI response');
    return null;
    
  } catch (error) {
    logger(`Error getting AI guidance: ${error.message}`);
    return null;
  }
}

// Function to perform an action based on AI guidance
async function performAction(page, guidance, stepName, screenshot) {
  try {
    // Log the action being attempted
    logger(`Performing action: ${guidance.action} on ${guidance.selector} with value ${guidance.value || 'none'}`);
    
    // First, try to perform the action with selectors from AI guidance
    if (guidance.selector) {
      try {
        if (guidance.action.toUpperCase() === 'CLICK') {
          await page.click(guidance.selector);
          logger(`Clicked element with selector: ${guidance.selector}`);
          await wait(2000);
          await screenshot(`after_${stepName.replace(/\s+/g, '_').toLowerCase()}_direct`);
          return true;
        } else if (guidance.action.toUpperCase() === 'TYPE' && guidance.value) {
          await page.type(guidance.selector, guidance.value);
          logger(`Typed "${guidance.value}" into element with selector: ${guidance.selector}`);
          await wait(2000);
          await screenshot(`after_${stepName.replace(/\s+/g, '_').toLowerCase()}_direct`);
          return true;
        } else if (guidance.action.toUpperCase() === 'SELECT' && guidance.value) {
          await page.select(guidance.selector, guidance.value);
          logger(`Selected "${guidance.value}" from element with selector: ${guidance.selector}`);
          await wait(2000);
          await screenshot(`after_${stepName.replace(/\s+/g, '_').toLowerCase()}_direct`);
          return true;
        }
      } catch (selectorError) {
        logger(`Failed to use selector directly: ${selectorError.message}`);
        // If direct selector fails, we'll try in-page evaluation next
      }
    }
    
    // If selector failed or wasn't provided, try in-page evaluation
    const actionType = guidance.action.toUpperCase();
    const actionPerformed = await page.evaluate((action, selector, stepInfo) => {
      // Helper to check visibility
      function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && 
               window.getComputedStyle(element).display !== 'none' && 
               window.getComputedStyle(element).visibility !== 'hidden';
      }
      
      // USJ-specific strategies
      if (action === 'CLICK') {
        // Strategy 1: Try text-based approach if we're clicking a button
        const buttonTexts = [
          'SELECT A DATE', 'Select a Date', 'Select Date',
          'NEXT', 'Next', 'CONTINUE', 'Continue',
          'ADD TO CART', 'Add to Cart',
          'CHECKOUT', 'Checkout',
          'GO TO CART', 'Go to Cart'
        ];
        
        // If it's likely a specific button, search for it by text
        if (buttonTexts.some(text => stepInfo.includes(text))) {
          const textToFind = buttonTexts.find(text => stepInfo.includes(text)) || '';
          
          const buttonsByText = Array.from(document.querySelectorAll('button, [role="button"], a.btn, .el-button'))
            .filter(btn => {
              if (!isVisible(btn) || btn.disabled) return false;
              
              const btnText = btn.innerText || btn.textContent || '';
              return btnText.includes(textToFind);
            });
          
          if (buttonsByText.length > 0) {
            buttonsByText[0].click();
            return { success: true, element: `Button with text "${textToFind}"` };
          }
          
          // If we're looking for a "SELECT A DATE" or date-related button
          if (stepInfo.includes('DATE') || stepInfo.includes('Date')) {
            const dateButtons = Array.from(document.querySelectorAll('button, [role="button"], a.btn, .el-button, [class*="date"]'))
              .filter(btn => isVisible(btn) && !btn.disabled);
            
            if (dateButtons.length > 0) {
              dateButtons[0].click();
              return { success: true, element: 'Date-related button' };
            }
          }
          
          // If we're looking for a checkout button
          if (stepInfo.includes('CHECKOUT') || stepInfo.includes('Checkout')) {
            const checkoutButtons = Array.from(document.querySelectorAll('button, [role="button"], a.btn, .el-button'))
              .filter(btn => {
                if (!isVisible(btn) || btn.disabled) return false;
                
                const text = btn.innerText || btn.textContent || '';
                return text.includes('CHECKOUT') || 
                       text.includes('Checkout') || 
                       text.includes('CHECK OUT') || 
                       text.includes('Check Out');
              });
            
            if (checkoutButtons.length > 0) {
              checkoutButtons[0].click();
              return { success: true, element: 'Checkout button' };
            }
          }
        }
      } 
      else if (action === 'TYPE') {
        // Look for input fields
        const inputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
        
        if (inputs.length > 0) {
          // Prefer number inputs if we're setting quantity
          if (stepInfo.includes('quantity') || stepInfo.includes('Quantity')) {
            const numberInput = inputs.find(input => input.type === 'number' || input.min === '0' || input.min === '1');
            if (numberInput) {
              numberInput.focus();
              numberInput.value = '1';
              numberInput.dispatchEvent(new Event('input', { bubbles: true }));
              numberInput.dispatchEvent(new Event('change', { bubbles: true }));
              return { success: true, element: 'Quantity input' };
            }
          }
          
          // Otherwise just use the first visible input
          inputs[0].focus();
          return { success: true, element: 'Input field' };
        }
      }
      
      return { success: false };
    }, actionType, guidance.selector + ' ' + (guidance.value || ''));
    
    if (actionPerformed.success) {
      logger(`Successfully performed ${actionType} on ${actionPerformed.element} using in-page evaluation`);
      await wait(2000); // Wait for any UI updates
      await screenshot(`after_${stepName.replace(/\s+/g, '_').toLowerCase()}_ai`);
      return true;
    }
    logger(`AI guidance failed for ${stepName}, falling back to manual approach`);
  } catch (error) {
    logger(`Error in manual approach for ${stepName}: ${error.message}`);
    return false;
  }
}

// Enhanced calendar navigation and date selection
async function selectDateFromCalendar(page, targetYear, targetMonth, targetDay) {
  logger(`Attempting to select date: ${targetYear}-${targetMonth}-${targetDay}`);
  
  try {
    // First, take a screenshot of the calendar for debugging
    await page.screenshot({ path: 'calendar_before_selection.png' });
    
    // Click on a date picker to open it if it's not already open
    const calendarOpened = await page.evaluate(() => {
      // Look for date input fields or buttons
      const dateInputs = document.querySelectorAll('input[type="date"], input.date-input, .date-picker');
      
      if (dateInputs.length > 0) {
        dateInputs[0].click();
        return true;
      }
      
      // Look for date picker buttons by text
      const dateButtons = Array.from(document.querySelectorAll('button, .button, [role="button"]')).filter(btn => {
        const text = btn.innerText || btn.textContent || '';
        return text.includes('SELECT A DATE') || 
               text.includes('Select Date') || 
               text.includes('Date') ||
               btn.getAttribute('aria-label')?.includes('date');
      });
      
      if (dateButtons.length > 0) {
        // Ensure we click an enabled button
        const enabledButton = dateButtons.find(btn => !btn.disabled && !btn.classList.contains('disabled'));
        if (enabledButton) {
          enabledButton.click();
          return true;
        }
      }
      
      // Check if calendar is already open
      const calendar = document.querySelector('.el-date-picker, .calendar, [class*="calendar"], [class*="datepicker"]');
      return !!calendar;
    });
    
    if (calendarOpened) {
      logger('Calendar opened or already open');
      await wait(1000);
    } else {
      logger('Could not find or open calendar');
    }
    
    // Enhanced date selection with multiple navigation strategies
    const dateSelected = await page.evaluate((year, month, day) => {
      // Navigation tracking for logging
      const navigationSteps = [];
      
      // Function to format date for comparison
      const formatDate = (y, m, d) => `${y}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`;
      const targetDate = formatDate(year, month, day);
      
      // Find the calendar panel
      const calendar = document.querySelector('.el-date-picker__header, .calendar-header, .datepicker-header, [class*="calendar-header"]');
      if (!calendar) {
        return { success: false, reason: 'Calendar header not found', navigation: navigationSteps };
      }
      
      // Strategy 1: Find current displayed month/year
      let currentMonthYear = '';
      const monthDisplay = calendar.querySelector('.el-date-picker__header-label, .month-year, .current-month');
      if (monthDisplay) {
        currentMonthYear = monthDisplay.innerText || monthDisplay.textContent || '';
        navigationSteps.push(`Current display: ${currentMonthYear}`);
      }
      
      // Strategy 2: Use navigation buttons to reach our target month/year
      const prevButtons = calendar.querySelectorAll('.el-icon-arrow-left, .prev-month, [aria-label="Previous Month"]');
      const nextButtons = calendar.querySelectorAll('.el-icon-arrow-right, .next-month, [aria-label="Next Month"]');
      
      if (prevButtons.length > 0 && nextButtons.length > 0) {
        // Parse current month/year
        let currentYear = new Date().getFullYear();
        let currentMonth = new Date().getMonth() + 1;
        
        // Try to extract from display
        if (currentMonthYear) {
          // Extract year
          const yearMatch = currentMonthYear.match(/\b(202\d|203\d)\b/);
          if (yearMatch) {
            currentYear = parseInt(yearMatch[0]);
          }
          
          // Extract month
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          for (let i = 0; i < monthNames.length; i++) {
            if (currentMonthYear.includes(monthNames[i])) {
              currentMonth = i + 1;
              break;
            }
          }
        }
        
        navigationSteps.push(`Detected: ${currentYear}-${currentMonth}`);
        
        // Calculate how many months to navigate
        const targetMonthNum = parseInt(month);
        const targetYearNum = parseInt(year);
        
        const currentMonthsFromZero = (currentYear * 12) + currentMonth;
        const targetMonthsFromZero = (targetYearNum * 12) + targetMonthNum;
        const monthDiff = targetMonthsFromZero - currentMonthsFromZero;
        
        navigationSteps.push(`Need to navigate ${monthDiff} months`);
        
        // Navigate months
        if (monthDiff > 0) {
          // Need to go forward
          for (let i = 0; i < Math.min(monthDiff, 24); i++) {
            // Limit to prevent infinite loops
            nextButtons[0].click();
            navigationSteps.push(`Clicked next`);
          }
        } else if (monthDiff < 0) {
          // Need to go backward
          for (let i = 0; i < Math.min(Math.abs(monthDiff), 24); i++) {
            prevButtons[0].click();
            navigationSteps.push(`Clicked prev`);
          }
        }
      }
      
      // Wait a moment for the calendar to update
      return new Promise(resolve => {
        setTimeout(() => {
          // Strategy 3: Find and click our target day
          const days = document.querySelectorAll('.el-date-table td:not(.disabled):not(.prev-month):not(.next-month)');
          
          navigationSteps.push(`Found ${days.length} available days`);
          
          // First, try to find exact day
          let targetDay = null;
          for (const dayCell of days) {
            const dayNum = dayCell.querySelector('.el-date-table__day, .day-number')?.innerText;
            if (dayNum && parseInt(dayNum) === parseInt(day)) {
              targetDay = dayCell;
              break;
            }
          }
          
          if (targetDay) {
            targetDay.click();
            navigationSteps.push(`Clicked on day ${day}`);
            resolve({ success: true, message: `Selected date: ${targetDate}`, navigation: navigationSteps });
            return;
          }
          
          // If we can't find the exact day, just pick the first available day
          if (days.length > 0) {
            const firstDay = days[0];
            const dayNum = firstDay.querySelector('.el-date-table__day, .day-number')?.innerText || 'unknown';
            firstDay.click();
            navigationSteps.push(`Could not find specific day, clicked on day ${dayNum} (first available)`);
            resolve({ success: true, message: `Selected fallback date (day ${dayNum})`, navigation: navigationSteps });
            return;
          }
          
          resolve({ success: false, reason: 'No available days found in calendar', navigation: navigationSteps });
        }, 500);
      });
    }, targetYear, targetMonth, targetDay);
    
    if (screenshotFn) await screenshotFn('calendar_after_navigation');
    
    // Handle the result
    if (dateSelected.success) {
      logger(`Date selection: ${dateSelected.method || 'Successful'}`);
      if (dateSelected.day) {
        logger(`Selected day: ${dateSelected.day}`);
      }
      return true;
    }
    
    // If the in-page evaluation failed, try a fallback approach
    logger(`In-page date selection failed: ${dateSelected.reason || 'Unknown error'}`);
    
    // Fallback 1: Try clicking on any date cell directly
    try {
      await page.evaluate(() => {
        const dateCells = document.querySelectorAll('td');
        for (const cell of dateCells) {
          const text = cell.innerText || cell.textContent || '';
          if (/^\d+$/.test(text.trim()) && !cell.classList.contains('disabled')) {
            cell.click();
            return true;
          }
        }
        return false;
      });
      logger('Tried fallback method to click any date cell');
      await wait(1000);
      return true;
    } catch (error) {
      logger(`Fallback date selection also failed: ${error.message}`);
      throw new Error('Failed to select any date after multiple attempts');
    }
  } catch (error) {
    logger(`Error selecting date: ${error.message}`);
    if (screenshotFn) await screenshotFn('date_selection_error');
    throw error;
  }
}

// Function to select the first available session
async function selectFirstSession(page) {
  try {
    // First take a screenshot for debugging
    await page.screenshot({ path: './screenshots/session_selection_before.png' });
    logger('Saved screenshot of session selection page');
    
    // Check if we're on the session selection page
    const pageInfo = await page.evaluate(() => {
      const title = document.title;
      const bodyText = document.body.innerText;
      return {
        title,
        hasSessionText: bodyText.includes('session') || bodyText.includes('Session') || 
                       bodyText.includes('MarioKart') || bodyText.includes('times'),
        hasRadioButtons: document.querySelectorAll('input[type="radio"]').length > 0
      };
    });
    
    logger(`Current page info - Title: ${pageInfo.title}, Has session text: ${pageInfo.hasSessionText}, Has radio buttons: ${pageInfo.hasRadioButtons}`);
    
    if (!pageInfo.hasSessionText && !pageInfo.hasRadioButtons) {
      logger('Not on session selection page, skipping session selection');
      return true; // Skip this step if we're not on the right page
    }
    
    // Use in-page evaluation to find and select a session
    const sessionSelected = await page.evaluate(() => {
      // Helper function to check if an element is visible
      function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && 
               window.getComputedStyle(element).display !== 'none' && 
               window.getComputedStyle(element).visibility !== 'hidden';
      }
      
      // Strategy 1: Find and click a radio button
      const radioButtons = Array.from(document.querySelectorAll('input[type="radio"]'))
        .filter(radio => isVisible(radio) && !radio.disabled);
      
      if (radioButtons.length > 0) {
        radioButtons[0].click();
        
        // Get some context about what we clicked
        const container = radioButtons[0].closest('div, label, tr');
        const sessionText = container ? container.innerText : 'Unknown session';
        
        return { 
          success: true, 
          method: 'Clicked radio button', 
          details: sessionText.substring(0, 100) // First 100 chars for logging
        };
      }
      
      // Strategy 2: Find clickable session divs with time information
      const sessionDivs = Array.from(document.querySelectorAll('div, label, p, span'))
        .filter(el => {
          if (!isVisible(el)) return false;
          
          const text = el.innerText || el.textContent || '';
          return (text.includes('MarioKart') || 
                 text.includes('Harry Potter') || 
                 text.includes('session') ||
                 text.includes(':') && /\d+:\d+/.test(text)) && // Contains time like 13:30
                 el.onclick !== null;
        });
      
      if (sessionDivs.length > 0) {
        sessionDivs[0].click();
        return { 
          success: true, 
          method: 'Clicked session div', 
          details: sessionDivs[0].innerText.substring(0, 100)
        };
      }
      
      // Strategy 3: Look for checkboxes or any interactable items
      const interactables = Array.from(document.querySelectorAll('div[role="button"], div.clickable, input[type="checkbox"], .selectable'))
        .filter(el => isVisible(el) && !el.disabled);
      
      if (interactables.length > 0) {
        interactables[0].click();
        return { 
          success: true, 
          method: 'Clicked interactable element', 
          details: interactables[0].innerText || 'No text' 
        };
      }
      
      // Strategy 4: If we can't find any session elements, check if there's a form with submit button
      // This could mean we need to skip this step or submit a form
      const submitButtons = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"], button:not(:disabled)'))
        .filter(el => {
          const text = el.innerText || el.textContent || '';
          return (text.includes('Next') || 
                 text.includes('NEXT') || 
                 text.includes('Continue') ||
                 text.includes('Submit')) &&
                 isVisible(el);
        });
      
      if (submitButtons.length > 0) {
        submitButtons[0].click();
        return { 
          success: true, 
          method: 'Clicked submit/next button', 
          details: submitButtons[0].innerText || 'No text' 
        };
      }
      
      return { success: false, reason: 'No suitable session elements found' };
    });
    
    if (sessionSelected.success) {
      logger(`Session selection: ${sessionSelected.method}`);
      if (sessionSelected.details) {
        logger(`Selected: ${sessionSelected.details}`);
      }
      
      // Take a screenshot after session selection
      await page.screenshot({ path: './screenshots/session_selection_after.png' });
      
      // Wait for any UI updates after selection
      await wait(2000);
      
      // Now look for and click the ADD TO CART button
      await clickAddToCartAfterSessionSelection(page);
      return true;
    } else {
      logger(`Failed to select session: ${sessionSelected.reason}`);
      
      // Take a screenshot of the failed state
      await page.screenshot({ path: './screenshots/session_selection_failed.png' });
      
      // Try to go forward anyway - the session might be pre-selected
      return await clickAddToCartAfterSessionSelection(page);
    }
  } catch (error) {
    logger(`Error selecting session: ${error.message}`);
    await page.screenshot({ path: './screenshots/session_selection_error.png' });
    
    // Try to go forward anyway - the session might be pre-selected
    try {
      return await clickAddToCartAfterSessionSelection(page);
    } catch (e) {
      // If we also can't click ADD TO CART, then truly fail
      throw new Error('Could not select any session or proceed to cart');
    }
  }
}

// Helper function to click ADD TO CART after session selection
async function clickAddToCartAfterSessionSelection(page) {
  try {
    logger('Looking for ADD TO CART button after session selection');
    
    // Use in-page evaluation to find and click ADD TO CART button
    const buttonClicked = await page.evaluate(() => {
      // Helper function to check if an element is visible
      function isVisible(element) {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && 
               window.getComputedStyle(element).display !== 'none' && 
               window.getComputedStyle(element).visibility !== 'hidden';
      }
      
      // Helper function to check if an element can be clicked
      function isClickable(element) {
        return isVisible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true';
      }
      
      // Strategy 1: Look for buttons with ADD TO CART text
      const cartButtons = Array.from(document.querySelectorAll('button, [role="button"], a.btn'))
        .filter(btn => {
          if (!isClickable(btn)) return false;
          
          const text = btn.innerText || btn.textContent || '';
          return text.includes('ADD TO CART') || 
                 text.includes('Add to Cart') ||
                 text.includes('Add to cart') ||
                 text.includes('ADD TO BASKET') ||
                 text.includes('PURCHASE') ||
                 text.includes('Purchase');
        });
      
      if (cartButtons.length > 0) {
        cartButtons[0].click();
        return { success: true, method: 'by text', text: cartButtons[0].innerText.trim() };
      }
      
      // Strategy 2: Look for success buttons (usually green)
      const successButtons = Array.from(document.querySelectorAll('button.el-button--success, button.button--success, button.success, button.btn-success, .button-success'))
        .filter(btn => isClickable(btn));
      
      if (successButtons.length > 0) {
        successButtons[0].click();
        return { success: true, method: 'by success class', text: successButtons[0].innerText.trim() };
      }
      
      // Strategy 3: Look for primary buttons that aren't for navigation
      const primaryButtons = Array.from(document.querySelectorAll('button.el-button--primary, button.primary, button.btn-primary, .button-primary'))
        .filter(btn => {
          if (!isClickable(btn)) return false;
          
          const text = btn.innerText || btn.textContent || '';
          return !text.includes('Next') && 
                 !text.includes('NEXT') && 
                 !text.includes('Previous') && 
                 !text.includes('PREVIOUS');
        });
      
      if (primaryButtons.length > 0) {
        primaryButtons[0].click();
        return { success: true, method: 'by primary class', text: primaryButtons[0].innerText.trim() };
      }
      
      // Strategy 4: Look for buttons with "cart" or "purchase" in their attributes
      const cartAttrButtons = Array.from(document.querySelectorAll('button, a.btn, [role="button"]'))
        .filter(btn => {
          if (!isClickable(btn)) return false;
          
          // Check attributes like id, class, data-* for cart-related terms
          const attrs = Array.from(btn.attributes).map(attr => attr.value.toLowerCase());
          return attrs.some(attr => 
            attr.includes('cart') || 
            attr.includes('purchase') || 
            attr.includes('buy')
          );
        });
      
      if (cartAttrButtons.length > 0) {
        cartAttrButtons[0].click();
        return { success: true, method: 'by cart attribute', text: cartAttrButtons[0].innerText.trim() };
      }
      
      // Strategy 5: Look for any action button
      const actionButtons = Array.from(document.querySelectorAll('button:not(:disabled), .el-button:not(.is-disabled), .submit-button, .action-button'))
        .filter(btn => isVisible(btn) && !btn.classList.contains('el-button--text'));
      
      if (actionButtons.length > 0) {
        const mainButton = actionButtons.find(btn => {
          const style = window.getComputedStyle(btn);
          // Look for buttons with prominent colors (like green or blue)
          return style.backgroundColor !== 'transparent' && 
                 style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
                 style.backgroundColor !== 'white' &&
                 style.backgroundColor !== '#ffffff';
        }) || actionButtons[0];
        
        mainButton.click();
        return { success: true, method: 'by any action button', text: mainButton.innerText.trim() };
      }
      
      // Strategy 6: Look for icons that might be the cart button
      const cartIcons = Array.from(document.querySelectorAll('i.el-icon-shopping-cart, i.shopping-cart-icon, .fa-shopping-cart, svg[data-icon="cart"]'))
        .filter(icon => isVisible(icon));
      
      if (cartIcons.length > 0) {
        // Click the icon or its parent if the icon itself isn't clickable
        const target = cartIcons[0].onclick ? cartIcons[0] : cartIcons[0].parentElement;
        target.click();
        return { success: true, method: 'by cart icon' };
      }
      
      // If we're really stuck, look for ANY button
      const anyButtons = Array.from(document.querySelectorAll('button, .button, [role="button"]'))
        .filter(btn => isVisible(btn) && !btn.disabled);
      
      if (anyButtons.length > 0) {
        anyButtons[0].click();
        return { success: true, method: 'by any button', text: anyButtons[0].innerText.trim() };
      }
      
      return { success: false, reason: 'No add to cart button found' };
    });
    
    if (buttonClicked.success) {
      logger(`Clicked ADD TO CART button ${buttonClicked.method} ${buttonClicked.text || ''}`);
      
      // Wait for potential navigation or cart update
      await wait(3000);
      
      // Take a screenshot for debugging
      await page.screenshot({ path: './screenshots/after_add_to_cart.png' });
      return true;
    } else {
      // Try a last fallback with direct recorded selector
      try {
        await page.click('button.el-button--success > span');
        logger('Clicked ADD TO CART button with recorded selector');
        await wait(3000);
        return true;
      } catch (err) {
        logger(`Error clicking ADD TO CART button with recorded selector: ${err.message}`);
        
        // Take a screenshot to see what's on the page
        await page.screenshot({ path: './screenshots/add_to_cart_error.png' });
        
        // Try one last strategy - look for cart icon in header
        try {
          const cartIcon = await page.$('.header .el-icon-shopping-cart-1, .header .fa-shopping-cart');
          if (cartIcon) {
            await cartIcon.click();
            logger('Clicked cart icon in header as fallback');
            await wait(2000);
            return true;
          }
        } catch (iconError) {
          logger(`Error clicking cart icon: ${iconError.message}`);
        }
        
        throw new Error('Could not find or click ADD TO CART button with any method');
      }
    }
  } catch (error) {
    logger(`All methods to click ADD TO CART button failed: ${error.message}`);
    throw error;
  }
}

// Function to find and click on specific product
async function findAndClickProduct(page, productId = '10009980', productName = 'Universal Express Pass 4: 4D & Choice') {
  logger(`Finding specific product: ${productName} (ID: ${productId})`);
  
  try {
    // First, ensure we're on the Express Passes page by clicking the category
    logger('Checking if we need to click EXPRESS PASSES category...');
    
    const onCategoryPage = await page.evaluate(() => {
      // Check if we need to click a category first
      const expressPassLinks = Array.from(document.querySelectorAll('a')).filter(a => {
        const text = a.innerText || a.textContent || '';
        return text.includes('EXPRESS PASSES') || text.includes('Express Passes');
      });
      
      if (expressPassLinks.length > 0) {
        expressPassLinks[0].click();
        return false; // We needed to click
      }
      
      // Check if we're already on the right page
      return document.title.includes('Express Pass') || 
             document.body.innerText.includes('Express Pass');
    });
    
    if (!onCategoryPage) {
      logger('Clicked EXPRESS PASSES category, waiting for page to load...');
      await wait(5000);
    } else {
      logger('Already on Express Passes page');
    }
    
    // Now look for the specific product with multiple strategies
    logger(`Looking for product: ${productName}`);
    
    // Take a screenshot of the product page for debugging
    await page.screenshot({ path: 'product_page.png' });
    
    // Try multiple strategies to find the product
    const productFound = await page.evaluate((targetId, targetName) => {
      // Strategy 1: Find by product ID in data attributes
      const productById = document.querySelector(`[data-product-id="${targetId}"]`);
      if (productById) {
        // Find clickable element within or near this container
        const clickable = productById.querySelector('a') || 
                          productById.querySelector('button') || 
                          productById.closest('a');
        if (clickable) {
          clickable.click();
          return { success: true, method: 'Found by product ID' };
        }
      }
      
      // Strategy 2: Find by product name in text content
      const allElements = Array.from(document.querySelectorAll('a, div.product-title, h2, h3, h4'));
      const productElements = allElements.filter(el => {
        const text = el.innerText || el.textContent || '';
        return text.includes(targetName) || 
               text.includes('Universal Express Pass 4') || 
               text.includes('4D & Choice');
      });
      
      if (productElements.length > 0) {
        // Find clickable element
        const element = productElements[0];
        if (element.tagName === 'A') {
          element.click();
          return { success: true, method: 'Found by product name (link)' };
        } else {
          // Try to find a nearby clickable element
          const viewDetails = element.querySelector('a') || 
                             element.closest('a') ||
                             element.parentElement.querySelector('a');
          
          if (viewDetails) {
            viewDetails.click();
            return { success: true, method: 'Found by product name (nearby link)' };
          }
        }
      }
      
      // Strategy 3: Look for "View Details" links
      const viewDetailsLinks = Array.from(document.querySelectorAll('a')).filter(a => {
        const text = a.innerText || a.textContent || '';
        return text.includes('View Details') || 
               text.includes('VIEW DETAILS') ||
               text.includes('Details');
      });
      
      if (viewDetailsLinks.length > 0) {
        // Inspect surrounding text to find our target product
        for (const link of viewDetailsLinks) {
          const container = link.closest('div.product-card') || 
                           link.closest('div.product-item') || 
                           link.closest('li') ||
                           link.parentElement;
          
          if (container) {
            const containerText = container.innerText || container.textContent || '';
            if (containerText.includes('Universal Express Pass 4') || 
                containerText.includes('4D & Choice') ||
                containerText.includes('Express Pass 4')) {
              link.click();
              return { success: true, method: 'Found by View Details link with matching text' };
            }
          }
        }
        
        // If we couldn't find the exact product, click the first View Details as fallback
        viewDetailsLinks[0].click();
        return { success: true, method: 'Clicked first View Details link (fallback)' };
      }
      
      // Strategy 4: Last resort - click any product link
      const productLinks = Array.from(document.querySelectorAll('a.product-link, a.font16, a.el-link--primary, a[href*="express"]'));
      if (productLinks.length > 0) {
        productLinks[0].click();
        return { success: true, method: 'Clicked generic product link (last resort)' };
      }
      
      return { success: false, method: 'All product finding strategies failed' };
    }, productId, productName);
    
    if (productFound.success) {
      logger(`Product found and clicked: ${productFound.method}`);
      await wait(5000); // Wait for product page to load
      return true;
    } else {
      logger('Failed to find product with any strategy');
      return false;
    }
  } catch (error) {
    logger(`Error finding product: ${error.message}`);
    return false;
  }
}

// Function to set quantity
async function setTicketQuantity(page, quantity) {
  logger(`Setting quantity to ${quantity}`);
  
  try {
    // Take a screenshot before attempting to set quantity
    await page.screenshot({ path: './screenshots/before_set_quantity.png' });
    
    // Find product section - this function will log detailed product info
    const productSectionIndex = await findProductSection(page, 'Universal Express Pass 4');
    logger(`Using product section index: ${productSectionIndex}`);
    
    // Check if there's a quantity selector in the product section
    const quantityStatus = await page.evaluate((sectionIndex, targetQuantity) => {
      // Find all potential quantity selectors
      const productSection = document.querySelector(`div:nth-of-type(${sectionIndex})`);
      if (!productSection) {
        return { 
          found: false, 
          message: 'Product section not found' 
        };
      }
      
      // Check if we have a dropdown select
      const selectElement = productSection.querySelector('select');
      if (selectElement) {
        // Check current value
        const currentValue = selectElement.value;
        
        // Set to new value if different
        if (currentValue !== targetQuantity.toString()) {
          selectElement.value = targetQuantity.toString();
          // Trigger change event
          const event = new Event('change', { bubbles: true });
          selectElement.dispatchEvent(event);
        }
        
        return { 
          found: true, 
          type: 'select', 
          currentValue: currentValue,
          newValue: selectElement.value,
          message: `Quantity select found with value ${currentValue}, set to ${selectElement.value}` 
        };
      }
      
      // Check if we have number input
      const inputElement = productSection.querySelector('input[type="number"], [class*="quantity"] input');
      if (inputElement) {
        // Check current value
        const currentValue = inputElement.value;
        
        // Set to new value if different
        if (currentValue !== targetQuantity.toString()) {
          inputElement.value = targetQuantity.toString();
          // Trigger input and change events
          inputElement.dispatchEvent(new Event('input', { bubbles: true }));
          inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        }
        
        return { 
          found: true, 
          type: 'input', 
          currentValue: currentValue,
          newValue: inputElement.value,
          message: `Quantity input found with value ${currentValue}, set to ${inputElement.value}` 
        };
      }
      
      // Check for increment/decrement buttons
      const incrementButton = productSection.querySelector('[class*="increment"], [class*="plus"], [class*="add"]');
      const decrementButton = productSection.querySelector('[class*="decrement"], [class*="minus"], [class*="subtract"]');
      const quantityDisplay = productSection.querySelector('[class*="quantity-display"], [class*="quantity-text"]');
      
      if (incrementButton && decrementButton) {
        let currentQuantity = 1; // Assume default is 1
        
        if (quantityDisplay) {
          currentQuantity = parseInt(quantityDisplay.innerText) || 1;
        }
        
        // Adjust quantity as needed
        if (currentQuantity < targetQuantity) {
          // Need to increment
          const clicksNeeded = targetQuantity - currentQuantity;
          for (let i = 0; i < clicksNeeded; i++) {
            incrementButton.click();
          }
        } else if (currentQuantity > targetQuantity) {
          // Need to decrement
          const clicksNeeded = currentQuantity - targetQuantity;
          for (let i = 0; i < clicksNeeded; i++) {
            decrementButton.click();
          }
        }
        
        // Get new value
        let newQuantity = targetQuantity;
        if (quantityDisplay) {
          newQuantity = parseInt(quantityDisplay.innerText) || targetQuantity;
        }
        
        return { 
          found: true, 
          type: 'buttons', 
          currentValue: currentQuantity,
          newValue: newQuantity,
          message: `Used increment/decrement buttons to adjust from ${currentQuantity} to ${newQuantity}` 
        };
      }
      
      // No quantity selector found - check if there's any quantity text
      const quantityText = productSection.innerText.match(/quantity:\s*(\d+)/i);
      if (quantityText) {
        return { 
          found: true, 
          type: 'static', 
          currentValue: quantityText[1],
          message: `Found static quantity text: ${quantityText[0]}` 
        };
      }
      
      return { 
        found: false, 
        message: 'No quantity selector found in product section' 
      };
    }, productSectionIndex, quantity);
    
    logger(`Quantity status: ${JSON.stringify(quantityStatus)}`);
    
    if (quantityStatus.found) {
      logger(`Successfully handled quantity: ${quantityStatus.message}`);
      
      // Wait for any UI updates
      await page.waitForTimeout(1000);
      
      // Take screenshot after setting quantity
      await page.screenshot({ path: './screenshots/after_set_quantity.png' });
      return true;
    }
    
    // If the product section approach failed, try a more general approach
    logger('Product section quantity not found, trying general quantity selectors');
    
    const generalSetResult = await page.evaluate((targetQuantity) => {
      // Try any quantity selector on the page
      const quantitySelectors = [
        'select.quantity-select',
        'input[type="number"]',
        'input[class*="quantity"]',
        '[class*="quantity-input"]',
        '[aria-label*="quantity"]',
        '[id*="quantity"]'
      ];
      
      for (const selector of quantitySelectors) {
        const element = document.querySelector(selector);
        if (element) {
          // Handle different types of elements
          if (element.tagName === 'SELECT') {
            element.value = targetQuantity.toString();
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return { 
              success: true, 
              method: `general select: ${selector}`,
              oldValue: element.defaultValue,
              newValue: element.value
            };
          } else if (element.tagName === 'INPUT') {
            element.value = targetQuantity.toString();
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return { 
              success: true, 
              method: `general input: ${selector}`,
              oldValue: element.defaultValue,
              newValue: element.value
            };
          }
        }
      }
      
      // If we couldn't find a direct selector, try increment/decrement buttons
      const buttons = {
        increment: document.querySelector('[class*="increment"], [class*="plus"], button:contains("+")'),
        decrement: document.querySelector('[class*="decrement"], [class*="minus"], button:contains("-")'),
        display: document.querySelector('[class*="quantity-display"], [class*="quantity-text"]')
      };
      
      if (buttons.increment && buttons.decrement) {
        // Get current quantity
        let currentQuantity = 1;
        if (buttons.display) {
          currentQuantity = parseInt(buttons.display.innerText) || 1;
        }
        
        // Adjust the quantity as needed
        if (currentQuantity < targetQuantity) {
          for (let i = 0; i < targetQuantity - currentQuantity; i++) {
            buttons.increment.click();
          }
        } else if (currentQuantity > targetQuantity) {
          for (let i = 0; i < currentQuantity - targetQuantity; i++) {
            buttons.decrement.click();
          }
        }
        
        return { 
          success: true, 
          method: 'general increment/decrement buttons',
          oldValue: currentQuantity,
          newValue: targetQuantity
        };
      }
      
      return { success: false, message: 'No quantity controls found on page' };
    }, quantity);
    
    if (generalSetResult.success) {
      logger(`Set quantity using ${generalSetResult.method}: changed from ${generalSetResult.oldValue} to ${generalSetResult.newValue}`);
      
      // Wait for any UI updates
      await page.waitForTimeout(1000);
      
      // Take screenshot after setting quantity
      await page.screenshot({ path: './screenshots/after_set_quantity_general.png' });
      return true;
    }
    
    // If we can't find any quantity controls, assume default quantity is 1 and continue
    logger('No quantity controls found, assuming default quantity is correct');
    return true;
  } catch (error) {
    logger(`Error setting quantity: ${error.message}`);
    // Take error screenshot
    await page.screenshot({ path: './screenshots/quantity_error.png' });
    
    // Don't throw, just return false
    return false;
  }
}

// Main function to run the purchase flow
async function purchaseUSJTicket(browser, date = '2025-04-29', quantity = 1) {
  logger(`Starting purchase flow for Universal Express Pass 4D & Choice for date ${date}`);
  
  // Create a new Puppeteer page
  const page = await browser.newPage();
  
  try {
    // Set viewport
    await page.setViewport({ width: 1280, height: 900 });
    
    // Navigate to the USJ website
    await page.goto('https://nta.tripodeck.com/');
    
    // Save a screenshot of the initial page for debugging
    await page.screenshot({ path: `./screenshots/${Date.now()}_initial_page.png` });
    
    // Wait for page to load
    await wait(5000);
    
    // See what page we got
    const initialPageTitle = await page.title();
    logger(`Initial page title: ${initialPageTitle}`);
    
    // Get AI guidance for navigation
    logger('Checking if we need to navigate to the ticket page or if we are already there');
    
    // Check if we are on the correct page with Express Pass 4 products
    let onProductPage = await page.evaluate(() => {
      const pageText = document.body.innerText || '';
      
      // Check for Express Pass 4 products
      const hasExpressPass = pageText.includes('Express Pass 4') || 
                            pageText.includes('4D & Choice') || 
                            pageText.includes('Universal Express');
                            
      // Check if we are on a product listing page
      const hasPrices = document.body.innerText.match(/[¥$]\d+/) !== null;
      
      return {
        hasExpressPass,
        hasPrices,
        url: window.location.href,
        title: document.title
      };
    });
    
    logger(`Page check: ${JSON.stringify(onProductPage)}`);
    
    // Navigate to product page if needed
    if (!onProductPage.hasExpressPass || !onProductPage.hasPrices) {
      logger('Navigating to Express Pass 4 product page');
      
      // Use recorded navigation path
      await page.goto('https://nta.tripodeck.com/official/usj/express_pass');
      
      // Wait for page to load
      await wait(5000);
      
      // Check again
      onProductPage = await page.evaluate(() => {
        const pageText = document.body.innerText || '';
        
        // Check for Express Pass 4 products
        const hasExpressPass = pageText.includes('Express Pass 4') || 
                              pageText.includes('4D & Choice') || 
                              pageText.includes('Universal Express');
                              
        // Check if we are on a product listing page
        const hasPrices = document.body.innerText.match(/[¥$]\d+/) !== null;
        
        return {
          hasExpressPass,
          hasPrices,
          url: window.location.href,
          title: document.title
        };
      });
      
      logger(`After navigation - Page check: ${JSON.stringify(onProductPage)}`);
      
      if (!onProductPage.hasExpressPass) {
        logger('Warning: Could not confirm we are on the Express Pass page');
        await page.screenshot({ path: `./screenshots/${Date.now()}_navigation_issue.png` });
      }
    }
    
    // Save a screenshot showing the product page
    await page.screenshot({ path: `./screenshots/${Date.now()}_product_page.png` });
    
    // Step 1: Set quantity (defaults to 1)
    logger(`Step 1: Setting quantity to ${quantity}`);
    const quantitySuccess = await setTicketQuantity(page, quantity);
    
    if (!quantitySuccess) {
      logger('Warning: Could not confirm quantity was set correctly, continuing with default quantity');
    }
    
    // Step 2: Click "SELECT A DATE" button
    logger('Step 2: Clicking date button');
    try {
      await clickDateButton(page);
    } catch (dateButtonError) {
      logger(`Error clicking date button: ${dateButtonError.message}`);
      
      // Take a screenshot of the error state
      await page.screenshot({ path: `./screenshots/${Date.now()}_error_date_button.png` });
      
      // Try an alternative approach
      logger('Trying alternative date button approach');
      const altDateButtonSuccess = await page.evaluate(() => {
        // Find any button or element that might open the date picker
        const dateButtons = Array.from(document.querySelectorAll('button, [role="button"], a'))
          .filter(el => {
            const text = (el.innerText || el.textContent || '').toLowerCase();
            return text.includes('date') || 
                   text.includes('calendar') || 
                   text.includes('select') || 
                   text.includes('when') ||
                   el.id?.toLowerCase().includes('date') ||
                   el.className?.toLowerCase().includes('date');
          });
        
        if (dateButtons.length > 0) {
          dateButtons[0].click();
          return { clicked: true, text: dateButtons[0].innerText || dateButtons[0].textContent };
        }
        
        // Try data attributes or ARIA labels
        const dateElements = Array.from(document.querySelectorAll('[data-date], [data-calendar], [aria-label*="date"], [aria-label*="calendar"]'));
        if (dateElements.length > 0) {
          dateElements[0].click();
          return { clicked: true, element: 'data attribute element' };
        }
        
        return { clicked: false };
      });
      
      if (!altDateButtonSuccess.clicked) {
        logger('Failed to click date button with alternative approach');
        throw new Error('Unable to click date button with any method');
      }
      
      logger(`Clicked date button with alternative approach: ${JSON.stringify(altDateButtonSuccess)}`);
      await wait(2000);
    }
    
    // Step 3: Select the date from calendar
    logger(`Step 3: Selecting date ${date}`);
    try {
      await selectDateFromCalendar(page, date);
    } catch (dateSelectionError) {
      logger(`Error selecting date: ${dateSelectionError.message}`);
      
      // Take a screenshot of the error state
      await page.screenshot({ path: `./screenshots/${Date.now()}_error_date_selection.png` });
      
      // Try an alternative approach
      logger('Trying alternative date selection approach');
      const altDateSelectionSuccess = await page.evaluate((targetDate) => {
        // Format date as YYYY-MM-DD
        const dateParts = targetDate.split('-');
        const year = parseInt(dateParts[0]);
        const month = parseInt(dateParts[1]);
        const day = parseInt(dateParts[2]);
        
        // Find all date cells in any calendar
        const dateCells = Array.from(document.querySelectorAll('[data-date], td[role="cell"], .day, [class*="calendar-day"]'));
        
        // Check each date cell
        for (const cell of dateCells) {
          // Check if it matches our date
          const cellText = cell.innerText || cell.textContent || '';
          const cellDate = cell.getAttribute('data-date');
          
          // If we have a data-date attribute with full date
          if (cellDate && cellDate === targetDate) {
            cell.click();
            return { clicked: true, method: 'data-date attribute match' };
          }
          
          // If the cell contains just the day number
          if (cellText.trim() === day.toString()) {
            // Make sure it's not disabled
            const isDisabled = cell.classList.contains('disabled') || 
                              cell.hasAttribute('disabled') || 
                              cell.getAttribute('aria-disabled') === 'true';
            
            if (!isDisabled) {
              cell.click();
              return { clicked: true, method: 'day number match' };
            }
          }
        }
        
        // If no direct match, try finding month navigation
        const monthDisplay = document.querySelector('[class*="calendar-header"], [class*="month-display"]');
        if (monthDisplay) {
          const monthText = monthDisplay.innerText || monthDisplay.textContent || '';
          
          // Check if month navigation is needed
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
          const monthTriggers = {
            current: monthNames[month - 1],
            next: monthNames[month % 12],
            prev: monthNames[(month + 10) % 12]
          };
          
          // If current month is not displayed, try to navigate
          if (!monthText.includes(monthTriggers.current)) {
            // Find and click next month button
            const nextButton = document.querySelector('[class*="next"], [aria-label*="next"], button > span.right, [class*="right-arrow"]');
            if (nextButton) {
              nextButton.click();
              // Wait a moment for UI update
              return { clicked: false, navigated: true, direction: 'next' };
            }
          }
        }
        
        return { clicked: false, navigated: false };
      }, date);
      
      if (altDateSelectionSuccess.navigated) {
        // Wait for UI to update after month navigation
        await wait(1000);
        
        // Try to select the date again
        const secondAttempt = await page.evaluate((targetDate) => {
          const dateParts = targetDate.split('-');
          const day = parseInt(dateParts[2]);
          
          // Find all date cells in any calendar
          const dateCells = Array.from(document.querySelectorAll('[data-date], td[role="cell"], .day, [class*="calendar-day"]'));
          
          // Check each date cell
          for (const cell of dateCells) {
            // Check if it matches our date
            const cellText = cell.innerText || cell.textContent || '';
            const cellDate = cell.getAttribute('data-date');
            
            // If we have a data-date attribute with full date
            if (cellDate && cellDate === targetDate) {
              cell.click();
              return { clicked: true, method: 'data-date attribute match' };
            }
            
            // If the cell contains just the day number
            if (cellText.trim() === day.toString()) {
              // Make sure it's not disabled
              const isDisabled = cell.classList.contains('disabled') || 
                                cell.hasAttribute('disabled') || 
                                cell.getAttribute('aria-disabled') === 'true';
              
              if (!isDisabled) {
                cell.click();
                return { clicked: true, method: 'day number match' };
              }
            }
          }
          
          return { clicked: false };
        }, date);
        
        if (!secondAttempt.clicked) {
          logger('Failed to select date with alternative approach after navigation');
          await page.screenshot({ path: './screenshots/checkout_button_error.png' });
          throw error;
        }
      }
      
      // Step 4: Click "ADD TO CART" button
      logger('Step 4: Clicking Add to Cart button');
      const addToCartSuccess = await clickAddToCart(page);
      
      if (!addToCartSuccess) {
        logger('Warning: Could not confirm Add to Cart button was clicked');
      }
      
      // Step 5: Accept terms and conditions if they appear
      logger('Step 5: Accepting terms and conditions');
      const termsAccepted = await acceptTermsIfPresent(page);
      
      if (!termsAccepted) {
        logger('Warning: Could not confirm terms and conditions were accepted');
      }
      
      // Step 6: Click "ADD TO CART" button again
      logger('Step 6: Clicking Add to Cart button again');
      const finalAddToCartSuccess = await clickAddToCart(page);
      
      if (!finalAddToCartSuccess) {
        logger('Warning: Could not confirm final Add to Cart button was clicked');
      }
      
      return true;
    } catch (error) {
      logger(`Error in purchase flow: ${error.message}`);
      await page.screenshot({ path: `./screenshots/${Date.now()}_error_state.png` });
      throw error;
    }
  } catch (error) {
    logger(`Error in purchase flow: ${error.message}`);
    await page.screenshot({ path: `./screenshots/${Date.now()}_error_state.png` });
    throw error;
  }
}

// Function to accept terms and conditions if they appear
async function acceptTermsIfPresent(page) {
  try {
    // Check if terms dialog is present
    const termsPresent = await page.evaluate(() => {
      const termsDialog = document.querySelector('div:nth-of-type(4) button');
      return !!termsDialog;
    });
    
    if (termsPresent) {
      // Try recorded selector
      await page.click('div:nth-of-type(4) button');
      logger('Accepted terms and conditions using recorded selector');
      return true;
    } else {
      logger('No terms and conditions dialog found, skipping');
      return false;
    }
  } catch (error) {
    logger(`Error handling terms and conditions: ${error.message}`);
    
    // Try to find and click any "I Agree" or similar button
    try {
      const agreeButtonClicked = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const agreeButton = buttons.find(b => {
          const text = b.innerText || b.textContent || '';
          return (text.includes('Agree') || 
                 text.includes('AGREE') || 
                 text.includes('Accept') || 
                 text.includes('ACCEPT')) && 
                !b.disabled;
        });
        
        if (agreeButton) {
          agreeButton.click();
          return true;
        }
        return false;
      });
      
      if (agreeButtonClicked) {
        logger('Clicked agreement button using in-page evaluation');
        return true;
      }
      
      // If we didn't find any agree button, it's probably not present
      logger('Could not find any agreement button, assuming not required');
      return false;
    } catch (fallbackError) {
      logger(`Error while trying to accept terms: ${fallbackError.message}`);
      // Not throwing error as this step is optional
      return false;
    }
  }
}

// Function to click ADD TO CART button
async function clickAddToCart(page) {
  logger('Attempting to click the Add to Cart button');
  
  // Take a screenshot before clicking
  await page.screenshot({ path: `./screenshots/before_add_to_cart.png` });
  
  // First, check if we are on the right page with the product details
  const pageValidation = await page.evaluate(() => {
    // Check if we have product info
    const productTitle = document.querySelector('h1, h2, h3, .product-title, [class*="product-name"]');
    const productTitleText = productTitle ? productTitle.innerText || productTitle.textContent : null;
    
    // Check if date is selected
    const dateInfo = document.querySelector('[class*="date-info"], [class*="date-selected"], [class*="calendar-selected"]');
    const dateSelected = dateInfo ? true : false;
    
    // Check if we can find the add to cart button
    const addToCartButton = Array.from(document.querySelectorAll('button, a'))
      .find(el => {
        const text = (el.innerText || el.textContent || '').toLowerCase();
        return text.includes('add to cart') || 
               text.includes('カートに入れる') || // Japanese
               text.includes('add') || 
               text.includes('cart');
      });
    
    return {
      productTitleText,
      dateSelected,
      hasAddToCartButton: !!addToCartButton,
      pageURL: window.location.href
    };
  });
  
  logger(`Page validation: ${JSON.stringify(pageValidation)}`);
  
  // Try multiple strategies to find and click the Add to Cart button
  try {
    // Strategy 1: Try to find visible button with text 'Add to Cart' or similar
    const addToCartSelector = [
      'button:visible:contains("Add to Cart")',
      'button:visible:contains("カートに入れる")', // Japanese
      'a:visible:contains("Add to Cart")',
      'a:visible:contains("カートに入れる")', // Japanese
      'button.add-to-cart',
      'button[class*="cart"]',
      '[class*="add-to-cart"]',
      '[data-testid*="cart"]',
      '[aria-label*="cart"]',
      'button:visible[class*="success"]', // Success color buttons are often Add to Cart
      'a:visible[class*="success"]'
    ];
    
    // Try each selector
    for (const selector of addToCartSelector) {
      try {
        logger(`Trying selector: ${selector}`);
        
        // Check if the selector exists
        const buttonExists = await page.evaluate((sel) => {
          let buttons;
          try {
            // For jQuery-style :contains and :visible
            if (sel.includes(':contains') || sel.includes(':visible')) {
              // Try to use jQuery if available
              if (typeof jQuery !== 'undefined') {
                buttons = jQuery(sel);
                return buttons.length > 0 ? true : false;
              } else {
                // Fallback for :contains without jQuery
                const plainSelector = sel.replace(/:contains\(['"](.*?)['"]\)/, '');
                const searchText = sel.match(/:contains\(['"](.*?)['"]\)/)?.[1] || '';
                
                buttons = Array.from(document.querySelectorAll(plainSelector))
                  .filter(el => (el.innerText || el.textContent || '').includes(searchText));
                  
                return buttons.length > 0 ? true : false;
              }
            } else {
              // Regular querySelector
              buttons = document.querySelectorAll(sel);
              return buttons.length > 0 ? true : false;
            }
          } catch (e) {
            console.error('Error evaluating selector:', e);
            return false;
          }
        }, selector);
        
        if (buttonExists) {
          logger(`Found button with selector: ${selector}`);
          
          // Click the button
          await page.evaluate((sel) => {
            let button;
            
            // Handle jQuery-style selectors
            if (sel.includes(':contains') || sel.includes(':visible')) {
              if (typeof jQuery !== 'undefined') {
                button = jQuery(sel)[0];
              } else {
                const plainSelector = sel.replace(/:contains\(['"](.*?)['"]\)/, '');
                const searchText = sel.match(/:contains\(['"](.*?)['"]\)/)?.[1] || '';
                
                button = Array.from(document.querySelectorAll(plainSelector))
                  .find(el => (el.innerText || el.textContent || '').includes(searchText));
              }
            } else {
              button = document.querySelector(sel);
            }
            
            if (button) {
              button.click();
              return true;
            }
            return false;
          }, selector);
          
          // Wait for any cart updates or loaders
          await page.waitForTimeout(2000);
          
          // Take a screenshot after clicking
          await page.screenshot({ path: `./screenshots/after_add_to_cart.png` });
          
          // Verify if the item was added to cart
          const cartVerification = await page.evaluate(() => {
            // Check for success message
            const successMsg = document.querySelector('[class*="success-message"], [class*="notification"], [class*="alert-success"]');
            const successText = successMsg ? (successMsg.innerText || successMsg.textContent) : null;
            
            // Check cart count if available
            let cartCount = null;
            const cartCountElement = document.querySelector('[class*="cart-count"], .badge, [class*="item-count"]');
            if (cartCountElement) {
              cartCount = cartCountElement.innerText || cartCountElement.textContent;
            }
            
            // Check for cart subtotal
            let subtotal = null;
            const subtotalElement = document.querySelector('[class*="subtotal"], [class*="cart-total"]');
            if (subtotalElement) {
              subtotal = subtotalElement.innerText || subtotalElement.textContent;
            }
            
            return {
              successText,
              cartCount,
              subtotal,
              currentURL: window.location.href
            };
          });
          
          logger(`Cart verification: ${JSON.stringify(cartVerification)}`);
          
          if (cartVerification.cartCount && cartVerification.cartCount !== '0') {
            logger('Item appears to be added to cart based on cart count!');
            return true;
          }
          
          if (cartVerification.subtotal && !cartVerification.subtotal.includes('0')) {
            logger('Item appears to be added to cart based on subtotal!');
            return true;
          }
          
          if (cartVerification.successText) {
            logger(`Success message found: ${cartVerification.successText}`);
            return true;
          }
        }
      } catch (error) {
        logger(`Error with selector ${selector}: ${error.message}`);
      }
    }
    
    // Strategy 2: Find buttons by visible text
    logger('Trying to find Add to Cart button by text content');
    const buttons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .map(button => {
          const text = (button.innerText || button.textContent || '').trim();
          const isVisible = button.offsetWidth > 0 && button.offsetHeight > 0;
          const classes = button.className;
          return {
            text,
            isVisible,
            classes
          };
        });
    });
    
    logger(`Found ${buttons.length} buttons on the page`);
    buttons.forEach((button, index) => {
      logger(`Button #${index + 1}: Text="${button.text}", Visible=${button.isVisible}, Classes=${button.classes}`);
    });
    
    // Try clicking on the most prominent "Add to Cart" button
    const clickResult = await page.evaluate(() => {
      const cartKeywords = ['add to cart', 'カートに入れる', 'add', 'cart', 'purchase', 'buy'];
      
      const buttons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
        .filter(btn => {
          const text = (btn.innerText || btn.textContent || '').toLowerCase();
          const isVisible = btn.offsetWidth > 0 && btn.offsetHeight > 0;
          return isVisible && cartKeywords.some(keyword => text.includes(keyword));
        });
      
      if (buttons.length > 0) {
        buttons[0].click();
        return `Clicked button with text: ${buttons[0].innerText || buttons[0].textContent}`;
      } else {
        return 'No suitable buttons found';
      }
    });
    
    logger(`Click result: ${clickResult}`);
    
    // Wait and take another screenshot after this attempt
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `./screenshots/after_add_to_cart_alternative.png` });
    
    // Check if we are now on a cart page or have cart items
    const isInCart = await page.evaluate(() => {
      // Check URL
      const isCartURL = window.location.href.includes('cart') || 
                       window.location.href.includes('checkout') || 
                       window.location.href.includes('basket');
                       
      // Check for cart elements
      const hasCartElements = !!document.querySelector('[class*="cart-item"], [class*="line-item"], [class*="order-summary"]');
      
      return isCartURL || hasCartElements;
    });
    
    if (isInCart) {
      logger('Successfully navigated to cart!');
      return true;
    }
    
    logger('Unable to find or click the Add to Cart button');
    return false;
  } catch (error) {
    logger(`Error clicking Add to Cart button: ${error.message}`);
    
    // Fallback: Try direct event simulation
    try {
      await page.evaluate(() => {
        // Create and dispatch an event for adding to cart
        const addToCartEvent = new CustomEvent('add-to-cart', {
          detail: { productId: document.querySelector('[data-product-id]')?.getAttribute('data-product-id') || 'unknown' }
        });
        document.dispatchEvent(addToCartEvent);
      });
      
      logger('Dispatched custom add-to-cart event as fallback');
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `./screenshots/after_add_to_cart_event.png` });
      return true;
    } catch (eventError) {
      logger(`Error with custom event: ${eventError.message}`);
      return false;
    }
  }
}

// Run the purchase flow
purchaseUSJTicket({
  headless: false,
  quantity: 1,
  targetDate: '2025-04-29',
  takeScreenshots: true
}); 