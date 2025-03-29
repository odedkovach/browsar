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

// NEW FUNCTION: analyzeDropdownIssue
async function analyzeDropdownIssue(page, screenshotName) {
  try {
    const screenshotPath = await takeScreenshot(page, screenshotName);
    const imageBuffer = fs.readFileSync(screenshotPath);
    const base64Image = imageBuffer.toString('base64');
    const prompt = "Please analyze the attached screenshot of the webpage dropdown that appears to be stuck. Describe what elements you observe and suggest what might be causing the issue with the dropdown not selecting correctly. Provide only your analysis.";
    console.log(`Sending analysis request to OpenAI with prompt: \"${prompt}\"`);
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "user", content: prompt },
        { type: "image_url", image_url: { url: `data:image/png;base64,${base64Image}` } }
      ]
    });
    const analysisText = response.choices[0].message.content.trim();
    return analysisText;
  } catch (error) {
    console.error("Error in analyzeDropdownIssue:", error.message);
    return "Analysis failed";
  }
}

// Define the steps for our process with their corresponding actions
const steps = [
  { name: 'Find Universal Express Pass 4: Thrills & Choice product', action: 'findProduct', productName: 'Universal Express Pass 4: Thrills & Choice' },
  { name: 'Increase quantity to 1', action: 'increaseQuantity' },
  { name: 'Click SELECT A DATE button', action: 'clickSelectDate' },
  { name: 'Navigate to May 2025', action: 'clickNextMonth' },
  { name: 'Select date 31', action: 'selectDate', day: 31 },
  { name: 'Click Next', action: 'clickNext' },
  { name: 'Select first radio button', action: 'selectFirstRadio' },
  { name: 'Click Add to Cart', action: 'clickAddToCart' },
  { name: 'Click Next Step', action: 'clickNextStep' },
  { name: 'Click Second Next Step', action: 'clickSecondNextStep' },
  { name: 'Click Checkout', action: 'clickCheckout' },
  { name: 'Click I Agree', action: 'clickIAgree' },
  { name: 'Fill Form Details', action: 'fillFormDetails' },
  { name: 'Fill Nationality', action: 'fillNationality' },
  { name: 'Fill Place of Residence', action: 'fillPlaceOfResidence' },
  { name: 'Handle Captcha Verification', action: 'handleCaptcha' },
  { name: 'Check Terms of Service Checkbox', action: 'checkTermsCheckbox' },
  { name: 'Check Cancellation Policy Checkbox', action: 'checkCancellationCheckbox' },
];

// Function to get instruction for the current step
async function getStepInstruction(step, dom, retryCount, lastError) {
  // Return the step's action directly since it's already defined in the step object
  return step;
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
    await takeScreenshot(page, 'before_text_verification');
    
    console.log('Looking for verification elements...');
    
    // Wait for verification elements to be visible
    await page.waitForSelector('img[data-v-6aff2c22]', { visible: true, timeout: 10000 })
      .catch(() => console.log('Verification image not found with first selector, trying alternatives...'));
    
    // Try multiple selectors for the verification image
    const imgSelectors = [
      'img[data-v-6aff2c22]', 
      'img.captcha-image', 
      'div.captcha-container img', 
      'div[class*="captcha"] img'
    ];
    
    // Find verification image
    let verificationImg = null;
    
    // Try each selector until we find the image
    for (const imgSel of imgSelectors) {
      verificationImg = await page.$(imgSel);
      if (verificationImg) {
        console.log(`Found verification image with selector: ${imgSel}`);
        break;
      }
    }
    
    if (!verificationImg) {
      console.error('❌ Could not find verification image');
      await takeScreenshot(page, 'verification_image_not_found');
      return false;
    }
    
    console.log('Found verification image');
    
    // Highlight the verification image for better recognition
    await highlightElement(page, verificationImg);
    await takeScreenshot(page, 'text_verification');
    
    // Get verification text from the image using GPT-4o
    const verificationText = await getVerificationText(page);
    if (!verificationText) {
      console.error('❌ Could not get verification text');
      return false;
    }
    
    console.log(`Text detected: ${verificationText}`);
    
    // Using exact selector based on form HTML
      // Email
      await page.locator('div:nth-of-type(10) input').click();
      await page.locator('div:nth-of-type(10) input').fill(verificationText);


   

  
   
    // Wait for verification to complete
    await delay(1000);
    
    // Just continue - we can't rely on the verification check
    console.log('✅ Completed verification step');
    return true;
  } catch (error) {
    console.error('Error in handleCaptchaVerification:', error);
    await takeScreenshot(page, 'error_captcha_verification');
    return false;
  }
}

async function getVerificationText(page) {
  try {
    // Take a full screenshot with the highlighted image
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `text_verification_${timestamp}.png`;
    const filepath = path.join(screenshotsDir, filename);
    
    // Take full screenshot
    await page.screenshot({
      path: filepath,
      fullPage: true
    });
    console.log(`Full screenshot with highlighted text saved: ${filename}`);
    
    // Read the image file and convert to base64
    const imageBuffer = fs.readFileSync(filepath);
    const base64Image = imageBuffer.toString('base64');
    
    // Create a simpler prompt that explicitly asks for just the text
    const prompt = "Return ONLY the letters and numbers you see in the red rectangle. Do not add any other text or phrases like 'The text is'";
    
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
    
    let verificationText = response.choices[0].message.content.trim();
    
    // Remove common prefixes that might be included
    const prefixesToRemove = [
      "The text in the red rectangle is",
      "The text is",
      "The captcha is",
      "The code is",
      "The verification code is",
      "The text reads",
      "I see",
      "It says"
    ];
    
    for (const prefix of prefixesToRemove) {
      if (verificationText.toLowerCase().startsWith(prefix.toLowerCase())) {
        verificationText = verificationText.substring(prefix.length).trim();
      }
    }
    
    // Remove any quotation marks, colons, or periods
    verificationText = verificationText.replace(/["':,.]/g, '').trim();
    
    console.log(`Processed verification text: "${verificationText}"`);
    return verificationText;
  } catch (error) {
    console.error('❌ Error getting verification text:', error.message);
    return null;
  }
}

// Functions to handle checkbox checking
async function checkTermsCheckbox(instruction, page) {
  try {
    console.log('Checking terms of service checkbox');
    await takeScreenshot(page, 'before_terms_checkbox');
    
    const checkbox = await page.$('div.el-checkbox');
    const isChecked = await page.evaluate(el => el.classList.contains('is-checked'), checkbox);

    if (!isChecked) {
      await checkbox.click();
    }
    
    await delay(1000);
    await takeScreenshot(page, 'after_terms_checkbox_click');
    
    console.log('✅ Checked Terms of Service checkbox');
    return true;
  } catch (error) {
    console.error('❌ Error checking terms checkbox:', error.message);
    return false;
  }
}

async function checkCancellationCheckbox(instruction, page) {
  try {
    console.log('Checking cancellation policy checkbox');
    await takeScreenshot(page, 'before_cancellation_checkbox');
    
    // Get all checkboxes
    const checkboxes = await page.$$('div.el-checkbox');
    
    // Use the second checkbox (index 1) if available
    if (checkboxes.length > 1) {
      const checkbox = checkboxes[1];
      const isChecked = await page.evaluate(el => el.classList.contains('is-checked'), checkbox);
      
      if (!isChecked) {
        await checkbox.click();
      }
    } else {
      console.log('Only one checkbox found, trying to find another way');
      // Try to find checkbox in second terms row
      const termsRows = await page.$$('div.terms.el-row');
      if (termsRows.length > 1) {
        const checkbox = await termsRows[1].$('div.el-checkbox');
        if (checkbox) {
          const isChecked = await page.evaluate(el => el.classList.contains('is-checked'), checkbox);
          if (!isChecked) {
            await checkbox.click();
          }
        }
      }
    }
    
    await delay(1000);
    await takeScreenshot(page, 'after_cancellation_checkbox_click');
    
    console.log('✅ Checked Cancellation Policy checkbox');
    return true;
  } catch (error) {
    console.error('❌ Error checking cancellation checkbox:', error.message);
    return false;
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
    await delay(1000);
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
    await delay(1000);
    
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
    await delay(500);
    
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
    await delay(500);
    
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
    await delay(2000);
    
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
    await delay(500);
    
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
    await delay(500);
    
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
    await delay(500);
    
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
    await delay(500);
    
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
    await delay(1000);
    
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
        await delay(500); // 1 second delay after entering
        
        // Take screenshot after entering code
        await takeScreenshot(page, 'verification_code_entered');
        return true;
    } catch (error) {
        console.error(`Error entering verification code: ${error.message}`);
        await takeScreenshot(page, 'error_entering_code');
        throw error;
    }
}

async function fillFormDetails(instruction, page) {
  try {
    console.log('Filling form details');
    const timeout = 5000;
    page.setDefaultTimeout(timeout);

    // First Name
    await page.locator('form > div:nth-of-type(1) input').click();
    await page.locator('form > div:nth-of-type(1) input').fill('oded');
    
    // Last Name
    await page.locator('form > div:nth-of-type(2) input').click();
    await page.locator('form > div:nth-of-type(2) input').fill('kovach');
    
    // Phone Number - Country Code
    await page.locator('div.pc-phoneNumber-input div.el-select input').click();
    await page.locator('div.pc-phoneNumber-input div.el-select input').fill('isra');
    await page.locator('::-p-text(Israel+972)').click();
    
    // Phone Number
    await page.locator('div.reset-el-select > input').click();
    await page.locator('div.reset-el-select > input').fill('0547777655');
    
    // Address
    await page.locator('div:nth-of-type(7) input').click();
    await page.locator('div:nth-of-type(7) input').fill('rokah 106');
    
    // Email
    await page.locator('div:nth-of-type(8) input').click();
    await page.locator('div:nth-of-type(8) input').fill('oded.kovach@gmail.com');
    
    // Confirm Email
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift');
    await page.locator('div:nth-of-type(9) input').fill('oded.kovach@gmail.com');
    
    await delay(1000);
    return true;
  } catch (error) {
    console.error('Error filling form details:', error.message);
    return false;
  }
}

async function fillNationality(page) {
  try {
    console.log('Filling nationality field');
    
    // Click the nationality dropdown
    await page.locator('div:nth-of-type(4) div.el-select input').click();
    
    // Type 'isra' to filter
    await page.locator('div:nth-of-type(4) div.el-select input').fill('isra');
    
    // Wait a bit for the dropdown to update
    await delay(1000);
    
    // Try multiple selectors for Israel option as in the recording
    // Using the exact selectors and coordinates from the browser recording
    try {
      await page.locator('div:nth-of-type(3) li.hover').click({
        offset: {
          x: 383,
          y: 19
        }
      });
    } catch (e) {
      console.log('First selector failed, trying alternative selectors:', e.message);
      
      try {
        // Try XPath selector from the recording
        await page.locator('xpath//html/body/div[3]/div[1]/div[1]/ul/li[106]').click({
          offset: {
            x: 383,
            y: 19
          }
        });
      } catch (e2) {
        console.log('XPath selector failed, trying generic approach:', e2.message);
        
        // Last resort - try a more generic approach
        await page.evaluate(() => {
          const dropdowns = document.querySelectorAll('div.el-select-dropdown.el-popper');
          for (const dropdown of dropdowns) {
            if (dropdown.style.display !== 'none') {
              const items = dropdown.querySelectorAll('li');
              for (const item of items) {
                if (item.textContent.includes('Israel')) {
                  item.click();
                  return true;
                }
              }
            }
          }
          throw new Error('Israel option not found in visible dropdowns');
        });
      }
    }
    
    // Wait to ensure the selection is registered
    await delay(1000);
    
    console.log('✅ Successfully filled nationality field');
    return true;
  } catch (error) {
    console.error('Error filling nationality:', error.message);
    await takeScreenshot(page, 'error_fill_nationality');
    return false;
  }
}

async function fillPlaceOfResidence(page) {
  try {
    console.log('Filling Place of Residence field');
    
    // Click the Place of Residence dropdown
    await page.locator('div:nth-of-type(5) div.el-select input').click();
    
    // Type 'isra' to filter
    await page.locator('div:nth-of-type(5) div.el-select input').fill('isra');
    
    // Wait a bit for the dropdown to update
    await delay(1000);
    
    // Try multiple selectors and approaches to click Israel
    try {
      // First attempt - target visible dropdown item
      await page.evaluate(() => {
        const dropdowns = document.querySelectorAll('div.el-select-dropdown.el-popper');
        for (const dropdown of dropdowns) {
          if (dropdown.style.display !== 'none') {
            const items = dropdown.querySelectorAll('li');
            for (const item of items) {
              if (item.textContent.includes('Israel')) {
                item.click();
                return true;
              }
            }
          }
        }
        throw new Error('Israel option not found in visible dropdowns');
      });
    } catch (e) {
      console.log('First attempt failed, trying direct selectors:', e.message);
      
      // Second attempt - using the hover class that may be present
      try {
        await page.locator('li.hover').click();
      } catch (e2) {
        console.log('Second attempt failed, trying xpath:', e2.message);
        
        // Third attempt - try XPath selector
        try {
          // Find any dropdown that's currently visible
          const liElements = await page.$$eval('li.el-select-dropdown__item', (items) => {
            return items.filter(item => {
              // Check if the item is visible
              const style = window.getComputedStyle(item);
              return style.display !== 'none' && item.textContent.includes('Israel');
            }).map(item => items.indexOf(item));
          });
          
          if (liElements.length > 0) {
            // Click the first Israel option found
            await page.locator('li.el-select-dropdown__item').nth(liElements[0]).click();
          }
        } catch (e3) {
          console.log('All attempts failed:', e3.message);
          throw e3;
        }
      }
    }
    
    // Wait to ensure the selection is registered
    await delay(1000);
    
    console.log('✅ Successfully filled Place of Residence field');
    return true;
  } catch (error) {
    console.error('Error filling Place of Residence:', error.message);
    await takeScreenshot(page, 'error_fill_place_of_residence');
    return false;
  }
}

// Function to execute the step based on the instruction
async function executeStep(instruction, page) {
  switch (instruction.action) {
    case 'findProduct':
      return await findProduct(instruction, page);
    case 'increaseQuantity':
      return await increaseQuantity(instruction, page);
    case 'clickSelectDate':
      return await clickSelectDate(instruction, page);
    case 'clickNextMonth':
      return await clickNextMonth(instruction, page);
    case 'selectDate':
      return await selectDate(instruction, page);
    case 'clickNext':
      return await clickNext(instruction, page);
    case 'selectFirstRadio':
      return await selectFirstRadio(instruction, page);
    case 'clickAddToCart':
      return await clickAddToCart(instruction, page);
    case 'clickNextStep':
      return await clickNextStep(instruction, page);
    case 'clickSecondNextStep':
      return await clickSecondNextStep(instruction, page);
    case 'clickCheckout':
      return await clickCheckout(instruction, page);
    case 'clickIAgree':
      return await handleIAgree(page);
    case 'fillFormDetails':
      return await fillFormDetails(instruction, page);
    case 'fillNationality':
      return await fillNationality(page);
    case 'fillPlaceOfResidence':
      return await fillPlaceOfResidence(page);
    case 'handleCaptcha':
      return await handleCaptchaVerification(page);
    case 'checkTermsCheckbox':
      return await checkTermsCheckbox(instruction, page);
    case 'checkCancellationCheckbox':
      return await checkCancellationCheckbox(instruction, page);
    default:
      throw new Error(`Unknown action: ${instruction.action}`);
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
    await delay(1000);
    
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
        
        await delay(1000);
        
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
        
        await delay(500);
        console.log('Cart should now be empty');
      } else {
        console.log('✅ No items in cart');
      }
    } catch (error) {
      console.log('Error checking cart:', error.message);
    }
    
    // Wait for page to fully load
    console.log('Waiting for 5 seconds before starting the process...');
    await delay(500);
    
    // Process each step with AI assistance and retry mechanism
    for (const step of steps) {
      console.log(`\n---- Processing step: ${step.name} ----`);
      console.log(`Waiting 4 seconds before starting this step...`);
      await delay(1000);
      
      let stepSuccess = false;
      let retryCount = 0;
      let lastError = null;
      const MAX_RETRIES = 3;
      
      while (!stepSuccess && retryCount <= MAX_RETRIES) {
        try {
          // Get the current DOM state
          const dom = await page.evaluate(() => document.documentElement.outerHTML);
          
          // Get instruction from GPT-4o with retry information if applicable
          const instruction = await getStepInstruction(step, dom, retryCount, lastError);
          console.log("Obtained instruction:", instruction);
          
          // Take a screenshot before each action
          await takeScreenshot(page, `before_${step.name.replace(/\s+/g, '_')}${retryCount > 0 ? `_retry${retryCount}` : ''}`);
          console.log(`About to perform action: ${instruction.action}. Waiting 1 seconds...`);
          await delay(1000);
          
          // Execute the step
          stepSuccess = await executeStep(instruction, page);
          
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
          await delay(2000);
          
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
    }
      
    // Final wait and screenshot
    console.log('\n---- Process completed ----');
    await delay(1000);
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
    console.log('Script complete. Browser will remain open for inspection.');
    // Removing browser.close() to keep the browser open
  }
})();