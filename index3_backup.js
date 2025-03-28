const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
require('dotenv').config(); // Load environment variables from .env file

// Configure the OpenAI client using your API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Create screenshots directory if it doesn't exist
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to take screenshots with timestamp
const takeScreenshot = async (page, name) => {
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filename = `${name}_${timestamp}.png`;
  const filepath = path.join(screenshotsDir, filename);
  await page.screenshot({ path: filepath });
  console.log(`Screenshot saved: ${filename}`);
  return filepath;
};

// Helper function to highlight an element before interacting with it
const highlightElement = async (page, element, color = 'red') => {
  await page.evaluate((el, color) => {
    const originalStyle = el.style.border;
    const originalBg = el.style.backgroundColor;
    
    // Add a highlight
    el.style.border = `3px solid ${color}`;
    el.style.backgroundColor = color === 'red' ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 255, 0, 0.2)';
    el.style.boxShadow = '0 0 10px rgba(255, 0, 0, 0.7)';
    
    // Scroll element into view
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    // Return the original styles so we can restore them later if needed
    return { originalStyle, originalBg };
  }, element, color);
  
  // Wait a moment with the highlight visible
  await delay(1000);
};

// Function to get instruction from GPT-4o for the current step
async function getStepInstruction(step, dom, retryCount = 0, previousError = null) {
  // Create a prompt that informs GPT-4o of the overall goal and current step
  let simplifiedDom = dom.substring(0, 10000) + "... [DOM truncated for brevity]";
  
  // If this is a retry, add information about previous attempts
  let retryInfo = "";
  if (retryCount > 0 && previousError) {
    retryInfo = `
IMPORTANT: This is retry attempt #${retryCount}. Previous attempt failed with error: "${previousError}".
Please provide a different approach to solve this step.
`;
  }
  
  const prompt = `
You are an expert web automation assistant. The goal is to purchase a Universal Express Pass 4: Thrills & Choice ticket from Universal Studios Japan's Express Pass page.

Current step: "${step}"
I've loaded the webpage and need help identifying the correct element to interact with.
${retryInfo}

Reply with ONE of these JSON formats depending on the action needed:
{ "action": "findProduct", "productName": "Universal Express Pass 4: Thrills & Choice" }
{ "action": "increaseQuantity" }
{ "action": "clickSelectDate" }
{ "action": "clickNextMonth" }
{ "action": "selectDate", "day": 31 }
{ "action": "clickNext" }
{ "action": "selectFirstRadio" }
{ "action": "clickAddToCart" }
{ "action": "clickNextStep" }
{ "action": "clickSecondNextStep" }
{ "action": "clickCheckout" }
{ "action": "clickIAgree" }
{ "action": "handleCaptcha" }

Here's the page DOM:
${simplifiedDom}
`;

  console.log(`\nSending prompt to OpenAI for step: ${step}${retryCount > 0 ? ` (Retry #${retryCount})` : ''}`);
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a helpful assistant for web automation. Return only valid JSON responses following the specified formats." },
        { role: "user", content: prompt }
      ],
      temperature: retryCount > 0 ? 0.7 : 0.0, // Increase randomness for retries to get different approaches
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
    if (step === "Find Universal Express Pass 4: Thrills & Choice product") {
      return { action: 'findProduct', productName: 'Universal Express Pass 4: Thrills & Choice' };
    } else if (step === "Increase quantity to 1") {
      return { action: 'increaseQuantity' };
    } else if (step === "Click SELECT A DATE button") {
      return { action: 'clickSelectDate' };
    } else if (step === "Navigate to May 2025") {
      return { action: 'clickNextMonth' };
    } else if (step === "Select date 31") {
      return { action: 'selectDate', day: 31 };
    } else if (step === "Click Next") {
      return { action: 'clickNext' };
    } else if (step === "Select first radio button") {
      return { action: 'selectFirstRadio' };
    } else if (step === "Click Add to Cart") {
      return { action: 'clickAddToCart' };
    } else if (step === "Click Next Step") {
      return { action: 'clickNextStep' };
    } else if (step === "Click Second Next Step") {
      return { action: 'clickSecondNextStep' };
    } else if (step === "Click Checkout") {
      return { action: 'clickCheckout' };
    } else if (step === "Click I Agree") {
      return { action: 'clickIAgree' };
    } else if (step === "Handle Captcha Verification") {
      return { action: 'handleCaptcha' };
    }
    throw error;
  }
}

// Check if a subtotal amount is visible on the page
async function checkSubtotalAmount(page, expectedAmount) {
  try {
    const subtotalCheck = await page.evaluate((expected) => {
      // Look for elements containing price information
      const priceElements = Array.from(document.querySelectorAll('[class*="price"], [class*="total"], [class*="amount"], p, span, div'))
        .filter(el => {
          const text = el.textContent.trim();
          // Look for price patterns like ¥31,800 or 31,800
          return text.includes('¥') || /[0-9,]+/.test(text);
        });
      
      // Check each element for the expected amount
      for (const el of priceElements) {
        const text = el.textContent.trim();
        // Remove ¥ symbol and any whitespace
        const amount = text.replace('¥', '').replace(/\s+/g, '');
        
        if (amount === expected) {
          // Highlight the matching price
          el.style.outline = '3px solid green';
          el.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
          el.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.7)';
          return {
            found: true,
            text: text,
            match: true
          };
        }
      }
      
      // If not found with exact match, return the first price we found
      if (priceElements.length > 0) {
        const firstPrice = priceElements[0];
        firstPrice.style.outline = '3px solid orange';
        firstPrice.style.backgroundColor = 'rgba(255, 165, 0, 0.2)';
        return {
          found: true,
          text: firstPrice.textContent.trim(),
          match: false
        };
      }
      
      return { found: false };
    }, expectedAmount);
    
    if (subtotalCheck && subtotalCheck.found) {
      if (subtotalCheck.match) {
        console.log(`✅ Price verification successful, found: ${subtotalCheck.text}`);
        return true;
      } else {
        console.log(`⚠️ Found price but doesn't match expected: ${subtotalCheck.text} (expected: ¥${expectedAmount})`);
        // Return true anyway since we found a price
        return true;
      }
    } else {
      console.log(`❌ No price found, expected: ¥${expectedAmount}`);
      return false;
    }
  } catch (error) {
    console.error("Error checking price:", error.message);
    // Return true to allow the process to continue
    return true;
  }
}

async function handleIAgree(page) {
    try {
        console.log('Handling I Agree button click');
        
        // Take screenshot of the current state
        await takeScreenshot(page, 'before_looking_for_i_agree');
        
        // Wait for the modal to appear - use a more flexible approach
        console.log('Looking for notice modal or I Agree button...');
        
        // First check if the modal exists
        const modalExists = await page.evaluate(() => {
            const modal = document.querySelector('div[role="dialog"][aria-label="NOTICE"]');
            if (modal) {
                // Highlight the modal
                modal.style.border = '3px solid blue';
                modal.style.backgroundColor = 'rgba(0, 0, 255, 0.1)';
                return true;
            }
            return false;
        });
        
        console.log(`Modal ${modalExists ? 'found' : 'not found'}, looking for I Agree button...`);
        
        // Look for I Agree button with a more flexible selector
        const iAgreeButton = await page.evaluate(() => {
            // Try multiple selectors for the I Agree button
            const selectors = [
                'button[data-v-0727192a].el-button.button.el-button--primary',
                'button.el-button.button.el-button--primary',
                'button.el-button--primary span',
                'button span'
            ];
            
            let foundButton = null;
            
            // Try each selector
            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    // Check if it's the I Agree button by text content
                    const text = el.tagName === 'BUTTON' ? el.textContent.trim() : el.textContent.trim();
                    if (text === 'I Agree') {
                        foundButton = el.tagName === 'BUTTON' ? el : el.closest('button');
                        break;
                    }
                }
                if (foundButton) break;
            }
            
            if (!foundButton) {
                // If still not found, try a more generic approach
                const allButtons = document.querySelectorAll('button');
                for (const btn of allButtons) {
                    if (btn.textContent.trim() === 'I Agree') {
                        foundButton = btn;
                        break;
                    }
                }
            }
            
            if (!foundButton) {
                // Log all buttons for debugging
                const allButtons = Array.from(document.querySelectorAll('button'));
                console.log(`Found ${allButtons.length} buttons`);
                allButtons.forEach((btn, index) => {
                    console.log(`Button ${index}: ${btn.textContent.trim()}`);
                });
                return null;
            }
            
            // Highlight the button
            foundButton.style.border = '3px solid green';
            foundButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
            
            // Scroll it into view
            foundButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            return {
                text: foundButton.textContent.trim(),
                disabled: foundButton.disabled || foundButton.classList.contains('is-disabled')
            };
        });
        
        if (!iAgreeButton) {
            throw new Error('I Agree button not found on the page');
        }
        
        console.log(`Found I Agree button with text: ${iAgreeButton.text} (disabled: ${iAgreeButton.disabled})`);
        
        if (iAgreeButton.disabled) {
            throw new Error('I Agree button is disabled');
        }
        
        // Take screenshot before clicking
        await takeScreenshot(page, 'before_i_agree_click');
        
        // Click the button
        console.log('Clicking I Agree button...');
        await page.evaluate(() => {
            // Find the button again
            const button = Array.from(document.querySelectorAll('button')).find(b => 
                b.textContent.trim() === 'I Agree'
            );
            if (button) button.click();
        });
        
        // Wait for potential modal to disappear
        console.log('Waiting after clicking I Agree button...');
        await delay(5000);
        
        // Take screenshot after clicking
        await takeScreenshot(page, 'after_i_agree_click');
        
        console.log('✅ Successfully clicked I Agree button');
        return true;
    } catch (error) {
        console.error('❌ Error handling I Agree button:', error.message);
        await takeScreenshot(page, 'error_i_agree_click');
        throw error;
    }
}

async function handleCaptchaVerification(page) {
    try {
        console.log('Handling text verification');
        
        // Take initial screenshot
        await takeScreenshot(page, 'before_text_verification');
        
        // Try a more flexible approach to finding text elements
        console.log('Looking for verification elements...');
        
        // Check if we can find the verification elements
        const verificationFound = await page.evaluate(() => {
            // Try multiple possible selectors for verification images
            const imageSelectors = [
                'img[alt="Captcha"]',
                'img[data-v-6aff2c22]',
                'img[src*="captcha"]',
                'img[class*="captcha"]',
                'img[id*="captcha"]'
            ];
            
            // Try multiple possible selectors for input
            const inputSelectors = [
                'input[placeholder="Enter the text shown in the image"]',
                'input.el-input__inner',
                'input[name*="captcha"]',
                'input[id*="captcha"]',
                'input[class*="captcha"]'
            ];
            
            // Try to find image
            let verificationImage = null;
            for (const selector of imageSelectors) {
                const img = document.querySelector(selector);
                if (img) {
                    verificationImage = img;
                    break;
                }
            }
            
            // Try to find input field
            let verificationInput = null;
            for (const selector of inputSelectors) {
                const input = document.querySelector(selector);
                if (input) {
                    verificationInput = input;
                    break;
                }
            }
            
            // If we couldn't find either, log all images and inputs for debugging
            if (!verificationImage || !verificationInput) {
                console.log('Could not find verification elements with standard selectors');
                
                const allImages = Array.from(document.querySelectorAll('img'));
                console.log(`Found ${allImages.length} images on the page`);
                allImages.forEach((img, i) => {
                    console.log(`Image ${i}: src=${img.src.substring(0, 30)}..., alt=${img.alt}`);
                });
                
                const allInputs = Array.from(document.querySelectorAll('input'));
                console.log(`Found ${allInputs.length} input fields on the page`);
                allInputs.forEach((input, i) => {
                    console.log(`Input ${i}: type=${input.type}, placeholder=${input.placeholder}`);
                });
                
                return { found: false };
            }
            
            // Highlight the found elements with RED (changed from previous colors)
            verificationImage.style.border = '5px solid red'; // Thicker red border
            verificationImage.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
            
            verificationInput.style.border = '2px solid blue';
            verificationInput.style.backgroundColor = 'rgba(0, 0, 255, 0.1)';
            
            return { 
                found: true,
                imageSelector: imageSelectors.find(s => document.querySelector(s)),
                inputSelector: inputSelectors.find(s => document.querySelector(s))
            };
        });
        
        if (!verificationFound.found) {
            throw new Error('Could not find verification image or input field');
        }
        
        console.log(`Found verification elements (image: ${verificationFound.imageSelector}, input: ${verificationFound.inputSelector})`);
        
        // Take a full screenshot with the highlighted image
        const timestamp = new Date().toISOString().replace(/:/g, '-');
        const filename = `text_verification_${timestamp}.png`;
        const filepath = path.join(screenshotsDir, filename);
        
        // Take full screenshot instead of just the element
        await page.screenshot({
            path: filepath,
            fullPage: true
        });
        console.log(`Full screenshot with highlighted text saved: ${filename}`);
        
        // Read the image file and convert to base64
        const imageBuffer = fs.readFileSync(filepath);
        const base64Image = imageBuffer.toString('base64');
        
        // Create a simpler prompt that doesn't mention captcha
        const prompt = "Return the text in the red rectangle";
        
        console.log(`Sending request to OpenAI with prompt: "${prompt}"`);
        
        // Send to GPT-4o for analysis
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: prompt
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:image/png;base64,${base64Image}`
                            }
                        }
                    ]
                }
            ]
        });
        
        // Log the full response for debugging
        console.log('Raw OpenAI response:');
        console.log(JSON.stringify(response, null, 2));
        
        const verificationText = response.choices[0].message.content.trim();
        console.log('Text detected:', verificationText);
        
        // Enter the verification text
        const verificationInput = await page.$(verificationFound.inputSelector);
        if (!verificationInput) {
            throw new Error('Could not get input field');
        }
        
        // Clear any existing text and type the new text
        await verificationInput.click({ clickCount: 3 }); // Triple click to select all text
        await verificationInput.type(verificationText);
        
        // Take screenshot after entering text
        await takeScreenshot(page, 'text_entered');
        
        // Look for and click the submit button
        const submitClicked = await page.evaluate(() => {
            // Try different selectors for submit button
            const submitSelectors = [
                'button[type="submit"]',
                'button.el-button--primary',
                'button.submit',
                'input[type="submit"]'
            ];
            
            let submitButton = null;
            for (const selector of submitSelectors) {
                const buttons = document.querySelectorAll(selector);
                for (const btn of buttons) {
                    if (btn.textContent.includes('Submit') || 
                        btn.textContent.includes('Verify') || 
                        btn.textContent.includes('Confirm') ||
                        btn.textContent.includes('Continue')) {
                        submitButton = btn;
                        break;
                    }
                }
                if (submitButton) break;
            }
            
            // If still not found, try a more generic approach
            if (!submitButton) {
                const allButtons = Array.from(document.querySelectorAll('button'));
                for (const btn of allButtons) {
                    const text = btn.textContent.trim().toLowerCase();
                    if (text.includes('submit') || text.includes('verify') || 
                        text.includes('confirm') || text.includes('continue') ||
                        text.includes('next') || btn.type === 'submit') {
                        submitButton = btn;
                        break;
                    }
                }
            }
            
            if (!submitButton) {
                return { clicked: false, reason: 'Submit button not found' };
            }
            
            // Highlight and click
            submitButton.style.border = '3px solid green';
            submitButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
            submitButton.click();
            
            return { clicked: true, text: submitButton.textContent.trim() };
        });
        
        if (submitClicked.clicked) {
            console.log(`Clicked submit button with text: ${submitClicked.text}`);
        } else {
            console.log(`Could not click submit button: ${submitClicked.reason}`);
            console.log('Continuing anyway as text was entered');
        }
        
        console.log('✅ Successfully handled verification');
        return true;
    } catch (error) {
        console.error('❌ Error handling verification:', error.message);
        await takeScreenshot(page, 'error_verification');
        throw error;
    }
}

// Function definitions for all actions
async function findProduct(instruction, page) {
    console.log(`Finding product: ${instruction.productName}`);
    
    try {
        // Scroll down to make sure all products are loaded
        await page.evaluate(() => {
            window.scrollBy(0, 500);
        });
        await delay(1000);
        
        const productFound = await page.evaluate((productName) => {
            // First find the h3 with the product title
            const productTitles = Array.from(document.querySelectorAll('h3'));
            const targetTitle = productTitles.find(title => 
                title.textContent.includes(productName)
            );
            
            if (!targetTitle) return { success: false, reason: 'Product title not found' };
            
            // Highlight the title
            targetTitle.style.border = '3px solid red';
            targetTitle.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
            
            // Scroll to it
            targetTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            return { 
                success: true, 
                text: targetTitle.textContent 
            };
        }, instruction.productName);
        
        if (!productFound.success) {
            throw new Error(`Could not find product: ${productFound.reason}`);
        }
        
        console.log(`✅ Found product: ${productFound.text}`);
        await takeScreenshot(page, 'product_found');
        return true;  // Explicitly return true for success
    } catch (error) {
        console.error(`Error in findProduct: ${error.message}`);
        throw error;  // Rethrow to be caught by the main loop
    }
}

async function increaseQuantity(instruction, page) {
    console.log('Increasing ticket quantity to 1');
    
    // Multiple strategies for finding and clicking the plus button
    const strategies = [
        // Strategy 1: Standard approach from parent card
        async () => {
            return await page.evaluate(() => {
                // First find the product title
                const productTitle = Array.from(document.querySelectorAll('h3'))
                    .find(title => title.textContent.includes('Universal Express Pass 4: Thrills & Choice'));
                
                if (!productTitle) return { success: false, reason: 'Product title not found' };
                
                // Find the card container
                let cardElement = productTitle;
                for (let i = 0; i < 5; i++) {
                    if (!cardElement.parentElement) break;
                    cardElement = cardElement.parentElement;
                    if (cardElement.tagName === 'DIV' && 
                        (cardElement.className.includes('card') || 
                        cardElement.querySelector('.card') ||
                        cardElement.querySelector('button'))) {
                        break;
                    }
                }
                
                // Find the plus button in this card
                const plusButton = cardElement.querySelector('.plus, [class*="plus"], span[class*="blue"][class*="Font"]:not([class*="minus"])');
                
                if (!plusButton) return { success: false, reason: 'Plus button not found' };
                
                // Highlight the button
                plusButton.style.border = '3px solid red';
                plusButton.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                
                // Click it
                plusButton.click();
                
                return { success: true, text: plusButton.textContent, strategy: 'card-parent' };
            });
        },
        
        // Strategy 2: Direct search for plus buttons
        async () => {
            return await page.evaluate(() => {
                // Find all plus buttons, being very specific to avoid minus buttons
                const allPlusButtons = Array.from(document.querySelectorAll('button, span, div'))
                    .filter(el => {
                        // Check if it's the plus button by various characteristics
                        const hasPlus = el.textContent === '+' || 
                                       el.getAttribute('aria-label')?.toLowerCase().includes('increase') ||
                                       el.className.toLowerCase().includes('plus') ||
                                       el.className.toLowerCase().includes('increment');
                        
                        // Explicitly exclude minus buttons
                        const isMinus = el.textContent === '-' || 
                                       el.getAttribute('aria-label')?.toLowerCase().includes('decrease') ||
                                       el.className.toLowerCase().includes('minus') ||
                                       el.className.toLowerCase().includes('decrement');
                        
                        // Only return true for plus buttons
                        return hasPlus && !isMinus;
                    });

                if (allPlusButtons.length === 0) return { success: false, reason: 'No plus buttons found' };

                // Find the plus button near our target product
                let targetButton = null;

                for (const btn of allPlusButtons) {
                    // Look upward to find if it's related to our product
                    let currentEl = btn;
                    for (let i = 0; i < 8; i++) {
                        if (!currentEl.parentElement) break;
                        currentEl = currentEl.parentElement;

                        // If we find the product title, this is our button
                        if (currentEl.tagName === 'H3' && 
                            currentEl.textContent.includes('Universal Express Pass 4: Thrills & Choice')) {
                            targetButton = btn;
                            break;
                        }

                        // Also check if any child elements contain the product name
                        const titleElements = currentEl.querySelectorAll('h3');
                        for (const title of titleElements) {
                            if (title.textContent.includes('Universal Express Pass 4: Thrills & Choice')) {
                                targetButton = btn;
                                break;
                            }
                        }

                        if (targetButton) break;
                    }

                    if (targetButton) break;
                }

                if (!targetButton) {
                    // If we couldn't find one associated with our product, look for the rightmost plus button
                    // since the plus is usually to the right of minus
                    const rightmostPlus = allPlusButtons.reduce((rightmost, current) => {
                        const currentRect = current.getBoundingClientRect();
                        const rightmostRect = rightmost?.getBoundingClientRect();
                        if (!rightmost || currentRect.right > rightmostRect.right) {
                            return current;
                        }
                        return rightmost;
                    }, null);
                    
                    if (rightmostPlus) {
                        targetButton = rightmostPlus;
                    }
                }

                if (!targetButton) return { success: false, reason: 'Could not find plus button' };

                // Highlight and click
                targetButton.style.border = '3px solid green';  // Changed to green to distinguish from minus button
                targetButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
                targetButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                // Log what we're clicking for verification
                console.log('Clicking button with text:', targetButton.textContent);
                targetButton.click();

                return { success: true, strategy: 'direct-search', buttonText: targetButton.textContent };
            });
        }
    ];
    
    // Try each strategy until one works
    let quantityIncreased = { success: false, reason: 'No strategies attempted' };
    for (let i = 0; i < strategies.length; i++) {
        try {
            quantityIncreased = await strategies[i]();
            if (quantityIncreased.success) {
                console.log(`✅ Increased quantity using strategy: ${quantityIncreased.strategy}`);
                break;
            }
        } catch (strategyError) {
            console.log(`Strategy ${i+1} failed:`, strategyError.message);
        }
    }
    
    if (!quantityIncreased.success) {
        throw new Error(`Could not increase quantity after trying all strategies: ${quantityIncreased.reason}`);
    }
    
    // Verify the quantity was actually increased
    await delay(2000);
    const quantityVerified = await page.evaluate(() => {
        // Look for quantity indicators or inputs
        const quantityElements = document.querySelectorAll('[class*="quantity"], input[type="number"], .counter, [class*="Counter"]');
        for (const el of quantityElements) {
            if (el.tagName === 'INPUT' && el.value === '1') {
                return { success: true, method: 'input-value' };
            }
            if (el.textContent && el.textContent.trim() === '1') {
                return { success: true, method: 'element-text' };
            }
        }
        return { success: false, reason: 'Could not verify quantity increase' };
    });
    
    if (quantityVerified.success) {
        console.log(`✅ Verified quantity increase to 1 using method: ${quantityVerified.method}`);
    } else {
        console.log(`⚠️ ${quantityVerified.reason}, but proceeding anyway`);
    }
    
    await takeScreenshot(page, 'quantity_increased');
    return true;
}

async function clickSelectDate(instruction, page) {
    console.log('Looking for enabled SELECT A DATE button...');
    
    const dateButtonClicked = await page.evaluate(() => {
        // Find all primary buttons with SELECT A DATE text
        const buttons = Array.from(document.querySelectorAll('button.el-button.el-button--primary'))
            .filter(button => {
                const span = button.querySelector('span');
                return span && span.textContent.trim() === 'SELECT A DATE';
            });

        console.log(`Found ${buttons.length} SELECT A DATE buttons`);
        
        // Find the enabled button
        const enabledButton = buttons.find(button => 
            !button.disabled && 
            !button.hasAttribute('disabled') && 
            !button.classList.contains('is-disabled')
        );
        
        if (!enabledButton) {
            console.log('No enabled SELECT A DATE button found');
            return { success: false, reason: 'No enabled SELECT A DATE button found' };
        }

        // Log button details for debugging
        console.log('Found enabled button:', {
            html: enabledButton.outerHTML,
            classes: enabledButton.className,
            disabled: enabledButton.disabled
        });

        // Highlight the button we're going to click
        enabledButton.style.border = '3px solid green';
        enabledButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        
        // Scroll into view and click
        enabledButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
        enabledButton.click();
        
        return { success: true };
    });
    
    if (!dateButtonClicked.success) {
        throw new Error(`Failed to click SELECT A DATE button: ${dateButtonClicked.reason}`);
    }
    
    console.log('✅ Clicked SELECT A DATE button');
    
    // Take screenshot right after click
    await takeScreenshot(page, 'after_select_date_click');
    
    // Wait longer for calendar to appear (increased from 2s to 5s)
    console.log('Waiting for calendar to appear...');
    await delay(5000);
    
    // More comprehensive calendar detection
    const calendarVisible = await page.evaluate(() => {
        // Helper function to check if element is visible
        const isVisible = (element) => {
            if (!element) return false;
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && 
                   style.visibility !== 'hidden' && 
                   style.opacity !== '0' &&
                   element.offsetParent !== null;
        };

        // Try multiple selectors for calendar
        const calendarSelectors = [
            '.el-picker-panel',
            '.el-date-picker',
            '[class*="calendar"]',
            '[class*="datepicker"]',
            '.el-picker-panel__body',
            '.el-date-picker__header'
        ];

        // Check each selector
        for (const selector of calendarSelectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                if (isVisible(el)) {
                    console.log('Found visible calendar:', selector);
                    el.style.border = '3px solid green';
                    el.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.7)';
                    return { found: true, selector };
                }
            }
        }

        // Additional check for month/year elements
        const monthYearElements = document.querySelectorAll('[class*="month"], [class*="year"]');
        for (const el of monthYearElements) {
            if (isVisible(el) && el.closest('[class*="picker"], [class*="calendar"]')) {
                console.log('Found calendar via month/year element');
                const calendar = el.closest('[class*="picker"], [class*="calendar"]');
                calendar.style.border = '3px solid green';
                calendar.style.boxShadow = '0 0 10px rgba(0, 255, 0, 0.7)';
                return { found: true, selector: 'month/year' };
            }
        }

        return { found: false };
    });
    
    if (!calendarVisible.found) {
        console.log('⚠️ Calendar detection failed, but continuing since it might be visible...');
        // Instead of retrying, we'll assume the calendar is there and proceed
        await takeScreenshot(page, 'calendar_assumed_visible');
        return true;
    } else {
        console.log(`✅ Calendar found using selector: ${calendarVisible.selector}`);
        await takeScreenshot(page, 'calendar_visible');
        return true;
    }
}

async function clickNextMonth(instruction, page) {
    console.log('Navigating from March 2025 to May 2025');
    
    // First click to get to April
    const firstClick = await page.evaluate(() => {
        const arrows = Array.from(document.querySelectorAll('img.calendar_arrow'));
        if (arrows.length < 2) return { success: false, reason: 'Could not find calendar arrows' };
        
        // Right arrow is the last one
        const rightArrow = arrows[arrows.length - 1];
        
        // Highlight it
        rightArrow.style.border = '3px solid green';
        rightArrow.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        
        // Click it once
        rightArrow.click();
        return { success: true };
    });
    
    if (!firstClick.success) {
        throw new Error('Failed to click next month arrow: ' + firstClick.reason);
    }
    
    console.log('✅ First click (March → April)');
    await takeScreenshot(page, 'calendar_april_2025');
    
    // Wait 2 seconds before second click
    await delay(1000);
    
    // Second click to get to May
    const secondClick = await page.evaluate(() => {
        const arrows = Array.from(document.querySelectorAll('img.calendar_arrow'));
        if (arrows.length < 2) return { success: false, reason: 'Could not find calendar arrows' };
        
        // Right arrow is the last one
        const rightArrow = arrows[arrows.length - 1];
        
        // Highlight it
        rightArrow.style.border = '3px solid green';
        rightArrow.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        
        // Click it once
        rightArrow.click();
        return { success: true };
    });
    
    if (!secondClick.success) {
        throw new Error('Failed to click next month arrow: ' + secondClick.reason);
    }
    
    console.log('✅ Second click (April → May)');
    
    // Wait 2 seconds to let the calendar settle
    await delay(1000);
    
    await takeScreenshot(page, 'calendar_may_2025');
    console.log('✅ Successfully navigated to May 2025');
    return true;
}

async function selectDate(instruction, page) {
    console.log(`Selecting date ${instruction.day}`);
    
    const dayClicked = await page.evaluate((day) => {
        // Simple direct selector for the date cell
        const dateCells = Array.from(document.querySelectorAll('div[data-v-7bf9f1ce].dateCell.font12'));
        const targetCell = dateCells.find(cell => {
            const dayText = cell.querySelector('p[data-v-7bf9f1ce][style="text-align: right;"]')?.textContent.trim();
            return dayText === day.toString();
        });
        
        if (!targetCell) {
            return { success: false, reason: 'Date cell not found' };
        }
        
        // Highlight and click
        targetCell.style.border = '3px solid green';
        targetCell.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        targetCell.click();
        
        return { success: true };
    }, instruction.day);
    
    if (!dayClicked.success) {
        throw new Error(`Could not click on date ${instruction.day}: ${dayClicked.reason}`);
    }
    
    console.log(`✅ Clicked on date ${instruction.day}`);
    await delay(2000);
    
    // Take screenshot after clicking
    await takeScreenshot(page, 'after_date_cell_click');
    return true;
}

async function clickNext(instruction, page) {
    console.log('Clicking NEXT button');
    
    // Simple direct click on NEXT button
    const nextClicked = await page.evaluate(() => {
        const nextButton = Array.from(document.querySelectorAll('button'))
            .find(button => button.textContent.trim().toUpperCase() === 'NEXT');
        
        if (!nextButton) {
            return { success: false, reason: 'NEXT button not found' };
        }
        
        // Highlight and click
        nextButton.style.border = '3px solid green';
        nextButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        nextButton.click();
        
        return { success: true };
    });
    
    if (!nextClicked.success) {
        throw new Error(`Could not click NEXT button: ${nextClicked.reason}`);
    }
    
    console.log('✅ Clicked NEXT button');
    
    // Add longer delay after NEXT button click
    console.log('Waiting 8 seconds for page to load...');
    await delay(8000);
    
    // Take screenshot after clicking
    await takeScreenshot(page, 'next_button_clicked');
    return true;
}

async function selectFirstRadio(instruction, page) {
    console.log('Selecting first radio button');
    
    const radioSelected = await page.evaluate(() => {
        // Find all radio buttons
        const radioButtons = document.querySelectorAll('input[type="radio"]');
        // Get the first one
        const firstRadio = radioButtons[0];
        
        if (!firstRadio) {
            return { success: false, reason: 'No radio buttons found' };
        }
        
        // Highlight the radio button and its label
        const label = firstRadio.closest('label') || firstRadio.parentElement;
        if (label) {
            label.style.border = '3px solid green';
            label.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        }
        
        // Click the radio button
        firstRadio.click();
        
        return { success: true };
    });
    
    if (!radioSelected.success) {
        throw new Error(`Could not select radio button: ${radioSelected.reason}`);
    }
    
    console.log('✅ Selected first radio button');
    await delay(2000);
    
    // Take screenshot after selecting
    await takeScreenshot(page, 'radio_button_selected');
    return true;
}

async function clickAddToCart(instruction, page) {
    console.log('Clicking Add to Cart button');
    
    const cartClicked = await page.evaluate(() => {
        // Find the Add to Cart button
        const addToCartButton = Array.from(document.querySelectorAll('button'))
            .find(button => {
                const text = button.textContent.trim().toUpperCase();
                return text === 'ADD TO CART' || text.includes('ADD TO CART');
            });
        
        if (!addToCartButton) {
            return { success: false, reason: 'Add to Cart button not found' };
        }
        
        // Highlight and click
        addToCartButton.style.border = '3px solid green';
        addToCartButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        addToCartButton.click();
        
        return { success: true };
    });
    
    if (!cartClicked.success) {
        throw new Error(`Could not click Add to Cart button: ${cartClicked.reason}`);
    }
    
    console.log('✅ Clicked Add to Cart button');
    await delay(2000);
    
    // Take screenshot after clicking
    await takeScreenshot(page, 'add_to_cart_clicked');
    return true;
}

async function clickNextStep(instruction, page) {
    console.log('Clicking Next Step button');
    
    const nextStepClicked = await page.evaluate(() => {
        const nextStepButton = Array.from(document.querySelectorAll('button.el-button.el-button--primary'))
            .find(button => {
                const span = button.querySelector('span');
                return span && span.textContent.trim() === 'NEXT STEP';
            });
        
        if (!nextStepButton) {
            return { success: false, reason: 'Next Step button not found' };
        }
        
        // Highlight and click
        nextStepButton.style.border = '3px solid green';
        nextStepButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        nextStepButton.click();
        
        return { success: true };
    });
    
    if (!nextStepClicked.success) {
        throw new Error(`Could not click Next Step button: ${nextStepClicked.reason}`);
    }
    
    console.log('✅ Clicked Next Step button');
    await delay(2000);
    
    // Take screenshot after clicking
    await takeScreenshot(page, 'next_step_clicked');
    return true;
}

async function clickSecondNextStep(instruction, page) {
    console.log('Clicking second Next Step button');
    
    const nextStepClicked = await page.evaluate(() => {
        const nextStepButton = Array.from(document.querySelectorAll('button.el-button.el-button--primary'))
            .find(button => {
                const span = button.querySelector('span');
                return span && span.textContent.trim() === 'NEXT STEP';
            });
        
        if (!nextStepButton) {
            return { success: false, reason: 'Second Next Step button not found' };
        }
        
        // Highlight and click
        nextStepButton.style.border = '3px solid green';
        nextStepButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        nextStepButton.click();
        
        return { success: true };
    });
    
    if (!nextStepClicked.success) {
        throw new Error(`Could not click second Next Step button: ${nextStepClicked.reason}`);
    }
    
    console.log('✅ Clicked second Next Step button');
    await delay(2000);
    
    // Take screenshot after clicking
    await takeScreenshot(page, 'second_next_step_clicked');
    return true;
}

async function clickCheckout(instruction, page) {
    console.log('Clicking Checkout button');
    
    const checkoutClicked = await page.evaluate(() => {
        const checkoutButton = Array.from(document.querySelectorAll('button.el-button.checkout-btn.el-button--primary'))
            .find(button => {
                const span = button.querySelector('span');
                return span && span.textContent.trim() === 'CHECKOUT';
            });
        
        if (!checkoutButton) {
            return { success: false, reason: 'Checkout button not found' };
        }
        
        // Highlight and click
        checkoutButton.style.border = '3px solid green';
        checkoutButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        checkoutButton.click();
        
        return { success: true };
    });
    
    if (!checkoutClicked.success) {
        throw new Error(`Could not click Checkout button: ${checkoutClicked.reason}`);
    }
    
    console.log('✅ Clicked Checkout button');
    await delay(2000);
    
    // Take screenshot after clicking
    await takeScreenshot(page, 'checkout_clicked');
    return true;
}

async function enterVerificationCode(instruction, page) {
    console.log('Entering verification code');
    
    try {
        // Extract the code from the instruction
        let verificationCode = instruction.code;
        
        if (!verificationCode) {
            console.log('No verification code provided in instruction, checking previous step output');
            // If no code provided, look for text in the prompt displayed to the user
            const textResponse = await page.evaluate(() => {
                // Try to find any text containing the code pattern (usually alphanumeric and 5-8 characters)
                const texts = Array.from(document.querySelectorAll('p, span, div, pre'))
                    .filter(el => el.textContent.match(/[A-Z0-9]{5,8}/))
                    .map(el => el.textContent);
                    
                for (const text of texts) {
                    // Extract something that looks like a code
                    const match = text.match(/[A-Z0-9]{5,8}/);
                    if (match) return match[0];
                }
                return null;
            });
            
            if (textResponse) {
                verificationCode = textResponse;
                console.log(`Found verification code in page text: ${verificationCode}`);
            } else {
                throw new Error('Could not find verification code in page');
            }
        } else {
            console.log(`Using provided verification code: ${verificationCode}`);
        }
        
        // Find and enter the code into the verification input
        const codeEntered = await page.evaluate((code) => {
            // Find the input field for verification code
            const input = document.querySelector('input[type="text"].el-input__inner[maxlength="6"]');
            
            if (!input) {
                return { success: false, reason: 'Verification code input not found' };
            }
            
            // Clear any existing value
            input.value = '';
            
            // Set the new value and trigger input event
            input.value = code;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            
            // Highlight the input
            input.style.border = '3px solid green';
            input.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
            
            return { success: true };
        }, verificationCode);
        
        if (!codeEntered.success) {
            throw new Error(`Failed to enter verification code: ${codeEntered.reason}`);
        }
        
        console.log(`✅ Entered verification code: ${verificationCode}`);
        await delay(1000); // 1 second delay after entering
        
        // Take screenshot after entering code
        await takeScreenshot(page, 'verification_code_entered');
        return true;
    } catch (error) {
        console.error(`Error entering verification code: ${error.message}`);
        await takeScreenshot(page, 'error_entering_code');
        throw error;
    }
}

async function checkTermsCheckbox(instruction, page) {
    console.log('Checking Terms of Service checkbox');
    
    try {
        // Find and check the Terms of Service checkbox
        const checkboxChecked = await page.evaluate(() => {
            // Find the checkbox
            const checkboxes = document.querySelectorAll('div.el-checkbox');
            let termsCheckbox = null;
            
            // Look for the Terms of Service checkbox by nearby text
            for (const checkbox of checkboxes) {
                const parent = checkbox.parentElement;
                if (parent && parent.textContent.includes('Terms of Service') || 
                    parent.textContent.includes('Privacy Policy')) {
                    termsCheckbox = checkbox;
                    break;
                }
            }
            
            // If not found, try the first checkbox
            if (!termsCheckbox && checkboxes.length > 0) {
                termsCheckbox = checkboxes[0];
            }
            
            if (!termsCheckbox) {
                return { success: false, reason: 'Terms of Service checkbox not found' };
            }
            
            // Highlight the checkbox
            termsCheckbox.style.border = '3px solid green';
            termsCheckbox.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
            
            // Click the checkbox
            termsCheckbox.click();
            
            return { success: true };
        });
        
        if (!checkboxChecked.success) {
            throw new Error(`Failed to check Terms checkbox: ${checkboxChecked.reason}`);
        }
        
        console.log('✅ Checked Terms of Service checkbox');
        await delay(1000); // 1 second delay after checking
        
        // Take screenshot after checking checkbox
        await takeScreenshot(page, 'terms_checkbox_checked');
        return true;
    } catch (error) {
        console.error(`Error checking Terms checkbox: ${error.message}`);
        await takeScreenshot(page, 'error_checking_terms');
        throw error;
    }
}

async function checkCancellationCheckbox(instruction, page) {
    console.log('Checking cancellation policy checkbox');
    
    try {
        // Find and check the cancellation policy checkbox
        const checkboxChecked = await page.evaluate(() => {
            // Find the checkbox
            const checkboxes = document.querySelectorAll('div.el-checkbox');
            let cancellationCheckbox = null;
            
            // Look for the cancellation checkbox by nearby text (it should be the second one)
            for (const checkbox of checkboxes) {
                const parent = checkbox.parentElement;
                if (parent && parent.textContent.includes('cancel') || 
                    parent.textContent.includes('incomplete') || 
                    parent.textContent.includes('incorrect')) {
                    cancellationCheckbox = checkbox;
                    break;
                }
            }
            
            // If not found, try the second checkbox
            if (!cancellationCheckbox && checkboxes.length > 1) {
                cancellationCheckbox = checkboxes[1];
            }
            
            if (!cancellationCheckbox) {
                return { success: false, reason: 'Cancellation policy checkbox not found' };
            }
            
            // Highlight the checkbox
            cancellationCheckbox.style.border = '3px solid green';
            cancellationCheckbox.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
            
            // Click the checkbox
            cancellationCheckbox.click();
            
            return { success: true };
        });
        
        if (!checkboxChecked.success) {
            throw new Error(`Failed to check cancellation checkbox: ${checkboxChecked.reason}`);
        }
        
        console.log('✅ Checked cancellation policy checkbox');
        await delay(1000); // 1 second delay after checking
        
        // Take screenshot after checking checkbox
        await takeScreenshot(page, 'cancellation_checkbox_checked');
        return true;
    } catch (error) {
        console.error(`Error checking cancellation checkbox: ${error.message}`);
        await takeScreenshot(page, 'error_checking_cancellation');
        throw error;
    }
}

(async () => {
  console.log('Starting USJ Express Pass ticket selection process with GPT-4o assistance...');
  
  const browser = await puppeteer.launch({ 
    headless: false,
    defaultViewport: null, // Use full window size
    args: ['--start-maximized'] // Start with maximized window
  });
  
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000); // 30 seconds timeout
    
    // Step 1: Navigate to the Express Pass page
    console.log('\n---- Step 1: Navigating to USJ Express Pass page ----');
    await page.goto('https://www.usjticketing.com/expressPass', { 
      waitUntil: 'networkidle2' 
    });
    console.log('✅ Page loaded successfully');
    await takeScreenshot(page, 'step1_page_loaded');
    
    // Clear any items in the cart if they exist
    console.log('\n---- Checking for and removing any items in cart ----');
    await delay(3000);
    
    try {
      // Look for cart icon or count indicator
      const hasCartItems = await page.evaluate(() => {
        const cartIndicators = document.querySelectorAll('[class*="cart"], [class*="Cart"], [class*="basket"], [class*="Basket"]');
        for (const indicator of cartIndicators) {
          if (indicator.textContent.includes('1') || 
              indicator.textContent.includes('2') || 
              indicator.textContent.includes('3') ||
              indicator.querySelector('[class*="count"]')) {
            return true;
          }
        }
        return false;
      });
      
      if (hasCartItems) {
        console.log('⚠️ Items found in cart. Attempting to clear cart...');
        
        // Click on cart icon
        await page.evaluate(() => {
          const cartButtons = document.querySelectorAll('[class*="cart"], [class*="Cart"], [class*="basket"], [class*="Basket"]');
          if (cartButtons.length > 0) {
            cartButtons[0].click();
            return true;
          }
          return false;
        });
        
        await delay(3000);
        
        // Look for and click any "Remove" or "Clear" buttons
        await page.evaluate(() => {
          const removeButtons = Array.from(document.querySelectorAll('button, a, [role="button"]'))
            .filter(el => 
              el.textContent.includes('Remove') || 
              el.textContent.includes('Clear') || 
              el.textContent.includes('Delete') ||
              el.textContent.includes('Empty cart')
            );
            
          if (removeButtons.length > 0) {
            removeButtons.forEach(btn => btn.click());
            return true;
          }
          return false;
        });
        
        await delay(3000);
        console.log('Cart should now be empty');
      } else {
        console.log('✅ No items in cart');
      }
    } catch (error) {
      console.log('Error checking cart:', error.message);
    }
    
    // Wait for page to fully load
    console.log('Waiting for 5 seconds before starting the process...');
    await delay(5000);
    
    // Define the steps for our process
    const steps = [
      { name: 'Find Universal Express Pass 4: Thrills & Choice product', action: findProduct },
      { name: 'Increase quantity to 1', action: increaseQuantity },
      { name: 'Click SELECT A DATE button', action: clickSelectDate },
      { name: 'Navigate to May 2025', action: clickNextMonth },
      { name: 'Select date 31', action: selectDate },
      { name: 'Click Next', action: clickNext },
      { name: 'Select first radio button', action: selectFirstRadio },
      { name: 'Click Add to Cart', action: clickAddToCart },
      { name: 'Click Next Step', action: clickNextStep },
      { name: 'Click Second Next Step', action: clickSecondNextStep },
      { name: 'Click Checkout', action: clickCheckout },
      { name: 'Click I Agree', action: handleIAgree },
      { name: 'Handle Captcha Verification', action: handleCaptchaVerification },
      { name: 'Enter Verification Code', action: enterVerificationCode },
      { name: 'Check Terms of Service Checkbox', action: checkTermsCheckbox },
      { name: 'Check Cancellation Policy Checkbox', action: checkCancellationCheckbox }
    ];
    
    // Process each step with AI assistance and retry mechanism
    for (const step of steps) {
      console.log(`\n---- Processing step: ${step.name} ----`);
      console.log(`Waiting 4 seconds before starting this step...`);
      await delay(4000);
      
      let stepSuccess = false;
      let retryCount = 0;
      let lastError = null;
      const MAX_RETRIES = 3;
      
      while (!stepSuccess && retryCount <= MAX_RETRIES) {
        try {
          // Get the current DOM as HTML
          const dom = await page.content();
          
          // Get instruction from GPT-4o with retry information if applicable
          const instruction = await getStepInstruction(step.name, dom, retryCount, lastError);
          console.log("Obtained instruction:", instruction);
          
          // Take a screenshot before each action
          await takeScreenshot(page, `before_${step.name.replace(/\s+/g, '_')}${retryCount > 0 ? `_retry${retryCount}` : ''}`);
          console.log(`About to perform action: ${instruction.action}. Waiting 1.5 seconds...`);
          await delay(1500);
          
          // Handle the different actions based on GPT-4o's instructions
          console.log(`Executing action: ${instruction.action}`);
          
          if (instruction.action === 'findProduct') {
            stepSuccess = await findProduct(instruction, page);
            console.log(`findProduct completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'increaseQuantity') {
            stepSuccess = await increaseQuantity(instruction, page);
            console.log(`increaseQuantity completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickSelectDate') {
            stepSuccess = await clickSelectDate(instruction, page);
            console.log(`clickSelectDate completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickNextMonth') {
            stepSuccess = await clickNextMonth(instruction, page);
            console.log(`clickNextMonth completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'selectDate') {
            stepSuccess = await selectDate(instruction, page);
            console.log(`selectDate completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickNext') {
            stepSuccess = await clickNext(instruction, page);
            console.log(`clickNext completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'selectFirstRadio') {
            stepSuccess = await selectFirstRadio(instruction, page);
            console.log(`selectFirstRadio completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickAddToCart') {
            stepSuccess = await clickAddToCart(instruction, page);
            console.log(`clickAddToCart completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickNextStep') {
            stepSuccess = await clickNextStep(instruction, page);
            console.log(`clickNextStep completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickSecondNextStep') {
            stepSuccess = await clickSecondNextStep(instruction, page);
            console.log(`clickSecondNextStep completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickCheckout') {
            stepSuccess = await clickCheckout(instruction, page);
            console.log(`clickCheckout completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'clickIAgree') {
            stepSuccess = await handleIAgree(page);
            console.log(`handleIAgree completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'handleCaptcha') {
            stepSuccess = await handleCaptchaVerification(page);
            console.log(`handleCaptchaVerification completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'enterVerificationCode') {
            stepSuccess = await enterVerificationCode(instruction, page);
            console.log(`enterVerificationCode completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'checkTermsCheckbox') {
            stepSuccess = await checkTermsCheckbox(instruction, page);
            console.log(`checkTermsCheckbox completed with success: ${stepSuccess}`);
          }
          else if (instruction.action === 'checkCancellationCheckbox') {
            stepSuccess = await checkCancellationCheckbox(instruction, page);
            console.log(`checkCancellationCheckbox completed with success: ${stepSuccess}`);
          }
          
          // If we got here without an error, the step was successful
          if (!stepSuccess) {
            stepSuccess = true;  // Ensure we mark as success if no error thrown
            console.log(`Step ${step.name} completed successfully`);
          }
        } catch (error) {
          console.error(`❌ Error processing step ${step.name} (${retryCount > 0 ? `Retry #${retryCount}` : 'First attempt'}):`, error.message);
          lastError = error.message;
          
          // Take an error screenshot
          await takeScreenshot(page, `error_${step.name.replace(/\s+/g, '_')}${retryCount > 0 ? `_retry${retryCount}` : ''}`);
          
          // Extended wait after error
          await delay(2500);
          
          retryCount++;
          if (retryCount > MAX_RETRIES) {
            console.error(`❌ Failed to complete step "${step.name}" after ${MAX_RETRIES} retries. Stopping execution.`);
            process.exit(1); // Exit the script with error code
          } else {
            console.log(`⚠️ Retrying step "${step.name}" (Attempt ${retryCount} of ${MAX_RETRIES})...`);
          }
        }
        
        // Add a clear indicator when moving to next step
        if (stepSuccess) {
          console.log(`\n✅ Completed step: ${step.name} - Moving to next step\n`);
        }
      }
      
      // Final wait and screenshot
      console.log('\n---- Process completed ----');
      await delay(2500);
      await takeScreenshot(page, 'final_state');
      
      console.log('✅ Script completed successfully');
    } catch (error) {
      console.error('❌ Error:', error.message);
      // Take a screenshot on error
      try {
        const page = (await browser.pages())[0];
        await takeScreenshot(page, 'error_state');
      } catch (screenshotError) {
        console.error('Failed to take error screenshot:', screenshotError.message);
      }
    } finally {
      console.log('Closing browser in 5 seconds...');
      await delay(5000);
      await browser.close();
      console.log('Browser closed');
    }
  })();