const puppeteer = require('puppeteer');
const OpenAI = require('openai');
require('dotenv').config(); // Load environment variables from .env file
const fs = require('fs');
const path = require('path');

// Configure the OpenAI client using your API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Delays for better visibility
const timeout = 30000;
const stepDelay = 5000; // 5 seconds between steps
const actionDelay = 3000; // 3 seconds between actions
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Create screenshots directory if it doesn't exist
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Function to check if the subtotal shows the expected amount
async function checkSubtotalAmount(page, expectedAmount) {
  try {
    const subtotalCheck = await page.evaluate((expected) => {
      const subtotalElements = document.querySelectorAll('.subtotal, [class*="subtotal"]');
      for (const el of subtotalElements) {
        if (el.textContent.includes(expected)) {
          el.style.outline = '5px solid green';
          el.style.backgroundColor = 'lightgreen';
          return {
            found: true,
            text: el.textContent.trim(),
            match: true
          };
        }
      }
      
      // If not found with exact match, check for any subtotal
      if (subtotalElements.length > 0) {
        return {
          found: true,
          text: subtotalElements[0].textContent.trim(),
          match: false
        };
      }
      
      return { found: false };
    }, expectedAmount);
    
    console.log("Subtotal check result:", JSON.stringify(subtotalCheck));
    
    if (subtotalCheck && subtotalCheck.found && subtotalCheck.match) {
      console.log(`✅ Subtotal verification successful, found: ${subtotalCheck.text}`);
      return true;
    } else {
      console.log(`❌ Subtotal verification failed, expected: ¥${expectedAmount}`);
      return false;
    }
  } catch (error) {
    console.error("Error checking subtotal:", error.message);
    return false;
  }
}

async function getStepInstruction(step, dom) {
  // Create a prompt that informs GPT-4 of the overall goal and current step
  let simplifiedDom = dom.substring(0, 2000) + "... [DOM truncated for brevity]";
  
  const prompt = `
You are an expert web automation assistant. The goal is to purchase a ticket from Universal Studios Japan's Express Pass page.

SPECIFIC REQUIREMENTS:
- Ticket: Universal Express Pass 4: Mine Cart & Fun (find this card on the page)
- Quantity: 1 (add more or less if needed to reach 1)
- Date: May 31, 2025 (31.5.25)

Current step: "${step}"
I've loaded the webpage. Tell me what element to click next to accomplish the current step.

IMPORTANT INSTRUCTIONS:
- For the "navigate to April 2025" step, you should use action "navigateCalendar" to move to May 2025, then select date 31.
- For the "select date 29" step, use action "selectDate" with day 31 instead.
- For the first step, use "clickNthCard" with cardNumber 10 to select the correct ticket.

Reply with ONE of these JSON formats:
{ "action": "click", "selector": "CSS_SELECTOR_HERE" }
{ "action": "clickNthCard", "cardNumber": 10 }
{ "action": "navigateCalendar", "month": 5, "year": 2025 }
{ "action": "selectDate", "day": 31 }
`;

  console.log(`\nSending prompt to OpenAI for step: ${step}`);
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4-turbo",
      messages: [
        { role: "system", content: "You are a helpful assistant for web automation." },
        { role: "user", content: prompt }
      ],
      temperature: 0.0,
    });
    
    const message = response.choices[0].message.content.trim();
    
    // Print the raw response for debugging
    console.log("\n=== Raw OpenAI Response ===");
    console.log(message);
    console.log("===========================\n");
    
    try {
      // Handle responses that include markdown code blocks (```json) 
      let jsonStr = message;
      if (message.includes('```')) {
        // Extract just the JSON portion from the code block
        const jsonMatch = message.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch && jsonMatch[1]) {
          jsonStr = jsonMatch[1].trim();
        }
      }
      return JSON.parse(jsonStr);
    } catch (err) {
      console.error("Failed to parse GPT response:", message);
      throw err;
    }
  } catch (error) {
    console.error("Error getting instruction from OpenAI:", error.message);
    // Provide a fallback instruction based on the step
    if (step === "select ticket and add quantity") {
      return { action: 'clickNthCard', cardNumber: 10 };
    } else if (step === "open calendar") {
      return { action: 'click', selector: 'button' };
    } else if (step === "navigate to May 2025") {
      return { action: 'navigateCalendar', month: 5, year: 2025 };
    } else if (step === "select date 31") {
      return { action: 'selectDate', day: 31 };
    }
    throw error;
  }
}

// Add a function to highlight elements before clicking
async function highlightElement(page, selector, description = "element") {
  try {
    console.log(`Highlighting ${description} with selector: "${selector}"`);
    
    // Add a red border to the element
    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.style.outline = '3px solid red';
        element.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.7)';
      }
    }, selector);
    
    // Take a screenshot with the highlight
    await page.screenshot({ path: `./screenshots/highlight_${description.replace(/\s+/g, '_')}.png` });
    
    // Wait a moment with the highlight visible
    await delay(2000);
  } catch (error) {
    console.error(`Error highlighting element:`, error.message);
  }
}

// Main function to run the script
async function runScript() {
  let browser = null;
  
  try {
    browser = await puppeteer.launch({ 
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    await page.setViewport({ width: 1024, height: 900 });

    console.log("Navigating to USJ Express Pass page...");
    await page.goto('https://www.usjticketing.com/expressPass', { 
      waitUntil: 'networkidle2', 
      timeout 
    });
    await delay(2000); // Give extra time for any dynamic content to load

    // Define only the first 5 steps that are working
    const steps = [
      "select ticket and add quantity",
      "open calendar",
      "navigate to May 2025",
      "select date 31",
      "verify subtotal" // Added a dedicated step for verification
    ];

    // Track state between steps
    const state = {
      dateSelected: false,
      dateVerified: false,
      lastVerifiedPrice: null
    };

    for (const step of steps) {
      console.log(`\n=== Processing step: ${step} ===`);
      console.log(`Waiting ${stepDelay/1000} seconds before starting this step...`);
      await delay(stepDelay);
      
      try {
        // Skip getting instruction for the verification step
        if (step === "verify subtotal") {
          console.log("Verifying date selection by checking for Subtotal showing ¥31,800");
          const dateVerified = await checkSubtotalAmount(page, '31,800');
          
          if (dateVerified) {
            console.log("✅ Date selection verification successful, found the correct price");
            state.dateSelected = true;
            state.dateVerified = true;
            state.lastVerifiedPrice = '¥31,800';
            
            // Take a specific screenshot of the selected date with verified subtotal
            await page.screenshot({ path: './screenshots/date_31_selected_with_verified_subtotal.png' });
            
            // Now look for and click the "Next" button 
            console.log("Looking for Next button");
            
            // Click the Next button with the specific class
            const nextButtonClicked = await page.evaluate(() => {
              const nextButtons = Array.from(document.querySelectorAll('button.el-button.el-button--primary'));
              const targetButton = nextButtons.find(btn => btn.textContent.includes('NEXT'));
              
              if (targetButton) {
                // Highlight the button
                targetButton.style.outline = '5px solid red';
                targetButton.style.backgroundColor = 'yellow';
                
                // Click with a small delay
                setTimeout(() => {
                  targetButton.click();
                }, 1000);
                
                return true;
              }
              return false;
            });
            
            if (nextButtonClicked) {
              console.log("Successfully clicked Next button");
            } else {
              console.log("Could not find Next button");
            }
            
            await delay(5000);
            await page.screenshot({ path: './screenshots/after_next_button_click.png' });
          } else {
            console.log("❌ Date selection verification failed");
          }
          
          continue; // Skip the rest of the loop for this step
        }
        
        // Get the current DOM as HTML
        const dom = await page.content();
        
        // Get instruction from GPT-4
        const instruction = await getStepInstruction(step, dom);
        console.log("Obtained instruction:", instruction);
        
        // Take a screenshot before each action
        await page.screenshot({ path: `./screenshots/before_${step.replace(/\s+/g, '_')}.png` });
        console.log(`About to perform action: ${instruction.action}. Waiting ${actionDelay/1000} seconds...`);
        await delay(actionDelay);
        
        if (instruction.action === 'click') {
          console.log(`Waiting for selector: ${instruction.selector}`);
          
          try {
            // First check if selector exists
            const selectorExists = await page.evaluate((selector) => {
              const element = document.querySelector(selector);
              return element !== null;
            }, instruction.selector);
            
            if (selectorExists) {
              // Highlight the element before clicking
              await highlightElement(page, instruction.selector, `element in step "${step}"`);
              
              console.log(`Clicking selector: ${instruction.selector}`);
              await page.click(instruction.selector);
            } else {
              // For calendar opening, try the SELECT A DATE button
              if (step === "open calendar") {
                const dateButtonClicked = await page.evaluate(() => {
                  const buttons = Array.from(document.querySelectorAll('button'));
                  for (const button of buttons) {
                    if (button.textContent.includes('SELECT A DATE')) {
                      button.click();
                      return true;
                    }
                  }
                  return false;
                });
                
                if (dateButtonClicked) {
                  console.log("Successfully clicked SELECT A DATE button");
                }
              }
            }
            
            // Take a screenshot after the click attempt
            await delay(2000);
            await page.screenshot({ path: `./screenshots/after_click_${step.replace(/\s+/g, '_')}.png` });
          } catch (error) {
            console.error(`Error clicking on element:`, error.message);
          }
          
        } else if (instruction.action === 'clickNthCard') {
          console.log(`Finding and clicking card number ${instruction.cardNumber}`);
          
          try {
            // First find all the cards
            const cardSelector = '.el-card';
            
            // Get the count of cards and click the specific one
            const cardIndex = instruction.cardNumber - 1;
            
            // First make sure we can see the cards
            await page.evaluate(() => {
              window.scrollTo(0, 300); // Scroll down a bit to ensure cards are visible
            });
            await delay(1000);

            // Highlight and click the card
            const cardHighlighted = await page.evaluate((selector, index) => {
              const cards = document.querySelectorAll(selector);
              if (cards[index]) {
                // Highlight the card
                cards[index].style.outline = '3px solid red';
                cards[index].style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.7)';
                
                // Scroll to ensure it's in view
                cards[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
                return true;
              }
              return false;
            }, cardSelector, cardIndex);
            
            if (cardHighlighted) {
              // Take screenshot with the highlight
              await page.screenshot({ path: './screenshots/card_highlighted.png' });
              console.log(`Card ${instruction.cardNumber} is now highlighted. Waiting 3 seconds before clicking...`);
              await delay(3000);
              
              // Click the card
              const cardClicked = await page.evaluate((selector, index) => {
                const cards = document.querySelectorAll(selector);
                if (cards[index]) {
                  cards[index].click();
                  return true;
                }
                return false;
              }, cardSelector, cardIndex);
              
              if (cardClicked) {
                console.log(`Successfully clicked card ${instruction.cardNumber}`);
              } else {
                console.log(`Failed to click card ${instruction.cardNumber}`);
              }
              
              await delay(5000);
              
              // After clicking the card, click the "SELECT A DATE" button
              console.log("Looking for SELECT A DATE button...");
              
              const dateButtonClicked = await page.evaluate(() => {
                const dateButtons = document.querySelectorAll('button');
                for (const button of dateButtons) {
                  if (button.textContent.includes('SELECT A DATE')) {
                    // Highlight the button
                    button.style.outline = '3px solid red';
                    button.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.7)';
                    
                    // Click after a short delay
                    setTimeout(() => {
                      button.click();
                    }, 1000);
                    
                    return true;
                  }
                }
                return false;
              });
              
              if (dateButtonClicked) {
                console.log("Successfully clicked SELECT A DATE button");
              }
              
              // Take a screenshot after
              await delay(2000);
              await page.screenshot({ path: './screenshots/after_select_date_button.png' });
            } else {
              console.log(`Could not find card ${instruction.cardNumber}`);
            }
          } catch (error) {
            console.error(`Error handling card selection:`, error.message);
          }
          
        } else if (instruction.action === 'navigateCalendar') {
          console.log(`Navigating calendar to month ${instruction.month}, year ${instruction.year}`);
          
          try {
            // Ensure the calendar is open
            await delay(5000);
            await page.screenshot({ path: './screenshots/calendar_opened.png' });
            
            // For May 2025, click next month button exactly twice
            console.log("Clicking next month button exactly twice to reach May 2025");
            
            // Find and click the next month button - first time
            const firstButtonClicked = await page.evaluate(() => {
              const arrow = document.querySelector('.el-icon-arrow-right') || 
                           document.querySelector('p > img:last-child') ||
                           document.querySelector('[class*="next"]');
              
              if (arrow) {
                // Highlight
                arrow.style.outline = '3px solid red';
                
                // Click
                arrow.click();
                return true;
              }
              return false;
            });
            
            if (firstButtonClicked) {
              console.log("Clicked next month button (1/2)");
            } else {
              console.log("Failed to find first next month button");
            }
            
            await delay(3000);
            await page.screenshot({ path: './screenshots/after_first_next_month.png' });
            
            // Click next month button - second time
            const secondButtonClicked = await page.evaluate(() => {
              const arrow = document.querySelector('.el-icon-arrow-right') || 
                           document.querySelector('p > img:last-child') ||
                           document.querySelector('[class*="next"]');
              
              if (arrow) {
                // Highlight
                arrow.style.outline = '3px solid red';
                
                // Click
                arrow.click();
                return true;
              }
              return false;
            });
            
            if (secondButtonClicked) {
              console.log("Clicked next month button (2/2)");
            } else {
              console.log("Failed to find second next month button");
            }
            
            await delay(5000);
            await page.screenshot({ path: './screenshots/may_2025_calendar.png' });
            console.log("We should now be in May 2025");
          } catch (error) {
            console.error(`Error navigating calendar:`, error.message);
          }
          
        } else if (instruction.action === 'selectDate') {
          console.log(`Selecting date ${instruction.day}`);
          
          try {
            // Take screenshot before attempting to select date
            await page.screenshot({ path: `./screenshots/before_selecting_date_${instruction.day}.png` });
            
            // Log the current state of the DOM for debugging
            await page.evaluate(() => {
              // Log the calendar's HTML structure to the console
              const calendar = document.querySelector('.el-date-table, .calendar, [class*="calendar"], [class*="date"]');
              if (calendar) {
                console.log('Calendar HTML found:', calendar.outerHTML.substring(0, 500) + '...');
              } else {
                console.log('No calendar element found on the page');
              }
              
              // Log all elements containing text "31"
              const allElements = document.querySelectorAll('*');
              console.log(`Total elements on page: ${allElements.length}`);
              
              let elementsWithText31 = [];
              allElements.forEach((el) => {
                if (el.textContent && el.textContent.includes('31')) {
                  elementsWithText31.push({
                    tag: el.tagName,
                    id: el.id,
                    className: el.className,
                    text: el.textContent.trim(),
                    visible: el.offsetWidth > 0 && el.offsetHeight > 0
                  });
                }
              });
              console.log(`Found ${elementsWithText31.length} elements containing "31":`);
              console.log(JSON.stringify(elementsWithText31.slice(0, 10), null, 2));
            });
            
            // Improved approach to select the date cell - more robust
            try {
              // Look for all elements containing the text "31" in the calendar
              const dateClicked = await page.evaluate((day) => {
                console.log(`Looking for date cell with day ${day}`);
                
                // Try multiple approach to find date cells
                const findDateCells = () => {
                  // Try common date cell selectors
                  const selectors = [
                    '.dateCell', 
                    '.datecell_click', 
                    'div[class*="dateCell"]',
                    'div[class*="date"]',
                    'td[class*="date"]',
                    'div.day',
                    'td.day',
                    '[class*="calendar"] td',
                    '[class*="datepicker"] td',
                    '[class*="calendar"] div',
                    'td',
                    'div'
                  ];
                  
                  let allCells = [];
                  
                  for (const selector of selectors) {
                    const cells = document.querySelectorAll(selector);
                    console.log(`Selector "${selector}" found ${cells.length} elements`);
                    
                    if (cells.length > 0) {
                      allCells = [...allCells, ...Array.from(cells)];
                    }
                  }
                  
                  // Remove duplicates
                  const uniqueCells = [...new Set(allCells)];
                  console.log(`Found ${uniqueCells.length} unique date cell candidates`);
                  
                  return uniqueCells;
                };
                
                // Get all potential date cells
                const dateCells = findDateCells();
                
                // Find cells matching day 31
                const matches = [];
                dateCells.forEach((cell, index) => {
                  const cellText = cell.textContent || '';
                  
                  // Look for exact match for day 31
                  if (cellText.trim() === day || 
                      cellText.includes(`${day} `) || 
                      cellText.includes(` ${day}`) || 
                      cellText.includes(`${day}\n`)) {
                    
                    console.log(`Found exact match for day ${day} at index ${index}: "${cellText.trim()}"`);
                    matches.push({
                      index,
                      element: cell,
                      exactMatch: true,
                      price: cellText.includes('31800'),
                      text: cellText.trim()
                    });
                  }
                  // Also check for any cell that contains the day number
                  else if (cellText.includes(day)) {
                    console.log(`Found partial match for day ${day} at index ${index}: "${cellText.trim()}"`);
                    matches.push({
                      index,
                      element: cell,
                      exactMatch: false,
                      price: cellText.includes('31800'),
                      text: cellText.trim()
                    });
                  }
                });
                
                console.log(`Found ${matches.length} cells matching day ${day}`);
                
                // Prioritize exact matches with price, then exact matches, then partial matches with price
                const sortedMatches = matches.sort((a, b) => {
                  if (a.exactMatch && a.price && (!b.exactMatch || !b.price)) return -1;
                  if (b.exactMatch && b.price && (!a.exactMatch || !a.price)) return 1;
                  if (a.exactMatch && !b.exactMatch) return -1;
                  if (b.exactMatch && !a.exactMatch) return 1;
                  if (a.price && !b.price) return -1;
                  if (b.price && !a.price) return 1;
                  return 0;
                });
                
                if (sortedMatches.length > 0) {
                  const bestMatch = sortedMatches[0];
                  console.log(`Best match for day ${day}: ${JSON.stringify(bestMatch)}`);
                  
                  const targetCell = bestMatch.element;
                  
                  // Highlight all matching cells
                  sortedMatches.forEach((match, i) => {
                    match.element.style.outline = i === 0 ? '5px solid red' : '3px solid orange';
                    match.element.style.backgroundColor = i === 0 ? 'yellow' : 'lightyellow';
                    match.element.style.zIndex = '9999';
                  });
                  
                  // Create markers to show where all matches are
                  sortedMatches.forEach((match, i) => {
                    const rect = match.element.getBoundingClientRect();
                    
                    const marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.width = '20px';
                    marker.style.height = '20px';
                    marker.style.borderRadius = '50%';
                    marker.style.backgroundColor = i === 0 ? 'red' : 'orange';
                    marker.style.zIndex = '10001';
                    marker.style.left = (rect.left + rect.width/2) + 'px';
                    marker.style.top = (rect.top + rect.height/2) + 'px';
                    marker.style.border = '2px solid black';
                    marker.style.pointerEvents = 'none'; // make sure it doesn't interfere with clicks
                    document.body.appendChild(marker);
                    
                    // Add a number to identify the match
                    const label = document.createElement('div');
                    label.textContent = i + 1;
                    label.style.position = 'absolute';
                    label.style.left = (rect.left + rect.width/2 - 5) + 'px';
                    label.style.top = (rect.top + rect.height/2 - 7) + 'px';
                    label.style.zIndex = '10002';
                    label.style.fontWeight = 'bold';
                    label.style.fontSize = '14px';
                    label.style.color = 'white';
                    label.style.pointerEvents = 'none';
                    document.body.appendChild(label);
                  });
                  
                  // Try multiple ways to click the target cell
                  const clickMethods = [
                    // Method 1: Direct click
                    () => {
                      console.log('Trying direct click');
                      targetCell.click();
                      return 'direct_click';
                    },
                    
                    // Method 2: Click via event
                    () => {
                      console.log('Trying click event');
                      const clickEvent = new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                      });
                      targetCell.dispatchEvent(clickEvent);
                      return 'event_click';
                    },
                    
                    // Method 3: Click any child elements that might be the actual clickable part
                    () => {
                      console.log('Trying to click children');
                      const children = targetCell.querySelectorAll('*');
                      if (children.length > 0) {
                        children.forEach(child => child.click());
                        return 'child_click';
                      }
                      return null;
                    },
                    
                    // Method 4: Click via parent
                    () => {
                      console.log('Trying parent click');
                      if (targetCell.parentElement) {
                        targetCell.parentElement.click();
                        return 'parent_click';
                      }
                      return null;
                    }
                  ];
                  
                  // Try each method until one works
                  for (const method of clickMethods) {
                    try {
                      const result = method();
                      if (result) {
                        return { 
                          clicked: true, 
                          method: result, 
                          text: bestMatch.text,
                          matches: sortedMatches.length
                        };
                      }
                    } catch (e) {
                      console.error('Click method failed:', e);
                    }
                  }
                  
                  // If we got here, all click methods failed but we found the cell
                  return { 
                    clicked: false, 
                    foundCell: true,
                    rect: targetCell.getBoundingClientRect(),
                    text: bestMatch.text,
                    matches: sortedMatches.length
                  };
                }
                
                // If no matching cells found, try finding the calendar grid and clicking in the bottom-right corner
                const calendars = document.querySelectorAll('.el-date-table, .calendar, table[class*="calendar"], table');
                if (calendars.length > 0) {
                  const calendar = calendars[0];
                  const rect = calendar.getBoundingClientRect();
                  
                  // Create a grid of possible click positions in the bottom-right area
                  const clickPositions = [];
                  
                  // Calculate the approximate cell size
                  const cellWidth = rect.width / 7; // 7 days in a week
                  const cellHeight = rect.height / 6; // typically 6 rows in a calendar
                  
                  // Calculate positions for the last week (bottom row) or second-to-last week
                  for (let row = 5; row >= 4; row--) {
                    for (let col = 6; col >= 4; col--) {
                      // Calculate positions for cells in bottom-right
                      clickPositions.push({
                        x: rect.left + (col * cellWidth) + (cellWidth / 2),
                        y: rect.top + (row * cellHeight) + (cellHeight / 2)
                      });
                    }
                  }
                  
                  // Mark all these positions visually
                  clickPositions.forEach((pos, i) => {
                    const marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.width = '15px';
                    marker.style.height = '15px';
                    marker.style.borderRadius = '50%';
                    marker.style.backgroundColor = 'red';
                    marker.style.opacity = '0.7';
                    marker.style.zIndex = '10000';
                    marker.style.left = (pos.x - 7) + 'px';
                    marker.style.top = (pos.y - 7) + 'px';
                    document.body.appendChild(marker);
                    
                    // Add a number to identify the position
                    const label = document.createElement('div');
                    label.textContent = i + 1;
                    label.style.position = 'absolute';
                    label.style.left = (pos.x - 4) + 'px';
                    label.style.top = (pos.y - 7) + 'px';
                    label.style.zIndex = '10001';
                    label.style.fontWeight = 'bold';
                    label.style.fontSize = '12px';
                    label.style.color = 'white';
                    document.body.appendChild(label);
                  });
                  
                  return { 
                    clicked: false, 
                    usingCalendarGrid: true, 
                    positions: clickPositions,
                    calendarRect: {
                      left: rect.left,
                      top: rect.top,
                      right: rect.right,
                      bottom: rect.bottom,
                      width: rect.width,
                      height: rect.height
                    }
                  };
                }
                
                // If all else fails
                return { clicked: false };
              }, instruction.day);
              
              console.log('Date cell selection result:', JSON.stringify(dateClicked));
              
              // Take a screenshot after finding the date cells with visual markers
              await page.screenshot({ path: './screenshots/date_cells_found.png' });
              
              // If JavaScript click didn't work but we found the cell, try puppeteer click
              if (!dateClicked.clicked && dateClicked.foundCell) {
                try {
                  // Get the rectangle and calculate the center
                  const rect = dateClicked.rect;
                  const x = rect.left + (rect.width / 2);
                  const y = rect.top + (rect.height / 2);
                  
                  // Click at the exact coordinates of the center of the cell
                  await page.mouse.click(x, y);
                  console.log(`Clicked at the center of the found cell: (${x}, ${y})`);
                } catch (error) {
                  console.error("Error clicking at cell coordinates:", error);
                }
              }
              // If we have a grid of positions to try
              else if (!dateClicked.clicked && dateClicked.usingCalendarGrid) {
                console.log("Using calendar grid to find and click day 31");
                
                // Try clicking at each position in the grid
                for (let i = 0; i < dateClicked.positions.length; i++) {
                  const pos = dateClicked.positions[i];
                  
                  // Click the position
                  await page.mouse.click(pos.x, pos.y);
                  console.log(`Clicked at grid position ${i+1}: (${pos.x}, ${pos.y})`);
                  
                  // Wait a moment to see if the click had an effect
                  await delay(1000);
                  
                  // Check if we successfully selected the date
                  const subtotalVisible = await checkSubtotalAmount(page, '31,800');
                  if (subtotalVisible) {
                    console.log(`✅ Successfully selected date after clicking at grid position ${i+1}`);
                    state.dateSelected = true;
                    state.dateVerified = true;
                    state.lastVerifiedPrice = '¥31,800';
                    break;
                  }
                  
                  // If not, continue to the next position
                  console.log(`Grid position ${i+1} didn't select the date, trying next position...`);
                }
              }
              
              // Wait to see if clicking affected the subtotal
              await delay(3000);
              
              // Final check if we successfully selected the date by looking for the subtotal
              const subtotalVisible = await checkSubtotalAmount(page, '31,800');
              if (subtotalVisible) {
                console.log("✅ Successfully selected date - subtotal verification passed");
                
                // Set our state so the verification step knows we already verified
                state.dateSelected = true;
                state.dateVerified = true;
                state.lastVerifiedPrice = '¥31,800';
                
                // Take a screenshot with the date selected
                await page.screenshot({ path: './screenshots/date_selected_with_subtotal.png' });
                
                // Since we've verified the date selection, look for and click the "Next" button now
                console.log("Looking for Next button after successful date selection");
                
                // Click the Next button with the specific class
                const nextButtonClicked = await page.evaluate(() => {
                  // Look for buttons with specific classes first
                  const buttonSelectors = [
                    'button.el-button.el-button--primary',
                    'button.el-button--primary',
                    'button.primary',
                    'button[class*="primary"]',
                    'button:contains("NEXT")',
                    'button:contains("Next")',
                    'button:contains("Continue")',
                    'button:contains("Proceed")'
                  ];
                  
                  for (const selector of buttonSelectors) {
                    try {
                      const buttons = document.querySelectorAll(selector);
                      for (const btn of buttons) {
                        if (btn.textContent.includes('NEXT') || 
                            btn.textContent.includes('Next') || 
                            btn.textContent.includes('Continue')) {
                          
                          // Highlight the button
                          btn.style.outline = '5px solid red';
                          btn.style.backgroundColor = 'yellow';
                          btn.style.zIndex = '9999';
                          
                          // Click with a small delay
                          setTimeout(() => {
                            btn.click();
                          }, 1000);
                          
                          return { clicked: true, text: btn.textContent };
                        }
                      }
                    } catch (e) {
                      // Continue to next selector
                    }
                  }
                  
                  // If no specific button found, look for any prominent button
                  const allButtons = document.querySelectorAll('button');
                  const prominentButtons = Array.from(allButtons).filter(btn => {
                    const styles = window.getComputedStyle(btn);
                    const rect = btn.getBoundingClientRect();
                    // Look for large, visible buttons with prominent colors
                    return rect.width > 80 && 
                           rect.height > 30 && 
                           (styles.backgroundColor.includes('blue') || 
                            styles.backgroundColor.includes('green') || 
                            styles.backgroundColor.includes('primary') ||
                            btn.className.includes('primary'));
                  });
                  
                  if (prominentButtons.length > 0) {
                    // Use the most prominent button
                    const button = prominentButtons[0];
                    
                    // Highlight the button
                    button.style.outline = '5px solid red';
                    button.style.backgroundColor = 'yellow';
                    button.style.zIndex = '9999';
                    
                    // Click with a small delay
                    setTimeout(() => {
                      button.click();
                    }, 1000);
                    
                    return { clicked: true, text: button.textContent, fallback: true };
                  }
                  
                  return { clicked: false };
                });
                
                if (nextButtonClicked && nextButtonClicked.clicked) {
                  console.log("Successfully clicked Next button:", nextButtonClicked.text);
                  await delay(1000);
                  await page.screenshot({ path: './screenshots/after_next_button_click.png' });
                } else {
                  console.log("Could not find Next button automatically");
                  
                  // Try clicking at the bottom-right corner where Next buttons are often located
                  const viewportSize = await page.evaluate(() => ({
                    width: window.innerWidth,
                    height: window.innerHeight
                  }));
                  
                  // Calculate bottom-right area coordinates
                  const bottomRightX = viewportSize.width - 100;
                  const bottomRightY = viewportSize.height - 100;
                  
                  await page.mouse.click(bottomRightX, bottomRightY);
                  console.log(`Clicked at bottom-right corner: (${bottomRightX}, ${bottomRightY})`);
                  await delay(2000);
                  await page.screenshot({ path: './screenshots/after_bottom_right_click.png' });
                }
                
                // Wait longer for the next screen to load
                console.log("Waiting 5 seconds for next screen...");
                await delay(5000);
                await page.screenshot({ path: './screenshots/after_next_screen_wait.png' });
              } else {
                console.log("❌ Date selection may have failed - no subtotal visible");
                
                // One last attempt - click directly on calendar cells in a pattern
                console.log("Making one final attempt to click calendar cells in a pattern...");
                
                await page.evaluate(() => {
                  // Find any calendar table or date container
                  const calendar = document.querySelector('table, [class*="calendar"], [class*="date"]');
                  if (!calendar) return null;
                  
                  const rect = calendar.getBoundingClientRect();
                  
                  // Create a 7x6 grid of positions covering the entire calendar
                  const cellWidth = rect.width / 7;
                  const cellHeight = rect.height / 6;
                  
                  const allPositions = [];
                  for (let row = 0; row < 6; row++) {
                    for (let col = 0; col < 7; col++) {
                      allPositions.push({
                        x: rect.left + (col * cellWidth) + (cellWidth / 2),
                        y: rect.top + (row * cellHeight) + (cellHeight / 2),
                        row,
                        col
                      });
                    }
                  }
                  
                  // Mark the positions
                  allPositions.forEach((pos, i) => {
                    const marker = document.createElement('div');
                    marker.style.position = 'absolute';
                    marker.style.width = '10px';
                    marker.style.height = '10px';
                    marker.style.borderRadius = '50%';
                    marker.style.backgroundColor = 'blue';
                    marker.style.opacity = '0.5';
                    marker.style.zIndex = '10000';
                    marker.style.left = (pos.x - 5) + 'px';
                    marker.style.top = (pos.y - 5) + 'px';
                    document.body.appendChild(marker);
                  });
                  
                  return { gridPositions: allPositions, calendarRect: rect };
                }).then(async (result) => {
                  if (result && result.gridPositions) {
                    // First try the positions most likely to be day 31 (bottom-right quadrant)
                    const likelyPositions = result.gridPositions.filter(
                      pos => pos.row >= 3 && pos.col >= 4
                    );
                    
                    // Try these positions first
                    for (const pos of likelyPositions) {
                      await page.mouse.click(pos.x, pos.y);
                      console.log(`Clicked at likely position row=${pos.row}, col=${pos.col}`);
                      await delay(1000);
                      
                      // Check if this click selected the date
                      const subtotalVisible = await checkSubtotalAmount(page, '31,800');
                      if (subtotalVisible) {
                        console.log(`✅ Successfully selected date after grid click at row=${pos.row}, col=${pos.col}`);
                        state.dateSelected = true;
                        state.dateVerified = true;
                        state.lastVerifiedPrice = '¥31,800';
                        break;
                      }
                    }
                  }
                });
                
                // Take a final screenshot after all attempts
                await page.screenshot({ path: './screenshots/after_all_date_selection_attempts.png' });
              }
            } catch (error) {
              console.error("Error in detailed date selection:", error.message);
            }
            
            // Take a final screenshot after date selection attempts
            await delay(1000);
            await page.screenshot({ path: './screenshots/final_date_selection_result.png' });
          } catch (error) {
            console.error(`Error in date selection step:`, error.message);
          }
        }
        
        console.log(`Completed step: ${step}`);
        await delay(stepDelay);
      } catch (error) {
        console.error(`Error processing step ${step}:`, error.message);
        // Take an error screenshot
        try {
          await page.screenshot({ path: `./screenshots/error_at_step_${step.replace(/\s+/g, '_')}.png` });
        } catch (screenshotError) {
          console.error("Failed to take error screenshot:", screenshotError.message);
        }
      }
    }

    console.log("Successfully completed the steps. Closing browser...");
  } catch (error) {
    console.error("Script execution error:", error.message);
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        console.error("Error closing browser:", e.message);
      }
    }
  }
}

// Run the script with error handling
runScript().catch(err => {
  console.error("Fatal error during script execution:", err);
  process.exit(1);
}); 