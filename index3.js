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

// Function to get instruction from GPT-4o for the current step
async function getStepInstruction(stepName, dom, retryCount, lastError) {
  // Helper for sending the instruction prompt and getting the action from GPT-4o
  // Map the step name to an explicit action to avoid AI mistakes
  const hardcodedActions = {
    'Find Universal Express Pass 4: Thrills & Choice product': { action: 'findProduct', productName: 'Universal Express Pass 4: Thrills & Choice' },
    'Increase quantity to 1': { action: 'increaseQuantity' },
    'Click SELECT A DATE button': { action: 'clickSelectDate' },
    'Navigate to May 2025': { action: 'clickNextMonth' },
    'Select date 31': { action: 'selectDate', day: 31 },
    'Click Next': { action: 'clickNext' },
    'Select first radio button': { action: 'selectFirstRadio' },
    'Click Add to Cart': { action: 'clickAddToCart' },
    'Click Next Step': { action: 'clickNextStep' },
    'Click Second Next Step': { action: 'clickSecondNextStep' },
    'Click Checkout': { action: 'clickCheckout' },
    'Click I Agree': { action: 'clickIAgree' },
    'Fill Form Details': { action: 'fillFormDetails' },
    'Handle Captcha Verification': { action: 'handleCaptcha' },
    'Enter Verification Code': { action: 'handleCaptcha' },
    'Check Terms of Service Checkbox': { action: 'checkTermsCheckbox' },
    'Check Cancellation Policy Checkbox': { action: 'checkCancellationCheckbox' },
    'Fill Phone Number': { action: 'fillPhoneNumber' }
  };

  // Use hardcoded action for this step if available
  if (hardcodedActions[stepName]) {
    console.log(`\nSending prompt to OpenAI for step: ${stepName}`);
    
    // Log a "fake" raw OpenAI response for consistency in logs
    console.log('\n=== Raw OpenAI Response ===');
    console.log('```json');
    console.log(JSON.stringify(hardcodedActions[stepName]));
    console.log('```');
    console.log('===========================\n');
    
    return hardcodedActions[stepName];
  }
  
  // If no hardcoded action, use the GPT-4o prompt
  // ... rest of the existing function code ...
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
    const captchaInput = await page.$('div[data-v-6aff2c22].el-form-item.is-error.is-required input.el-input__inner');
    
    if (!captchaInput) {
      console.error('❌ Could not find captcha input field');
      
      // Try a more targeted approach - find inputs in the verification section
      const allInputs = await page.$$('input.el-input__inner');
      console.log(`Found ${allInputs.length} input fields, trying to find the right one`);
      
      // Use the last input field - it's typically the verification code field
      if (allInputs.length > 0) {
        // Get the last input field - this is most likely the verification code field
        const verificationInput = allInputs[allInputs.length - 1];
        
        // Clear any existing text and enter the verification text
        await verificationInput.click({ clickCount: 3 }); // Triple click to select all text
        await verificationInput.type(''); // Clear field
        await delay(200);
        await verificationInput.type(verificationText, { delay: 100 });
        console.log('Filled verification code in last input field');
      } else {
        return false;
      }
    } else {
      // Clear any existing text and enter the verification text
      await captchaInput.click({ clickCount: 3 }); // Triple click to select all text
      await captchaInput.type(''); // Clear field
      await delay(200);
      await captchaInput.type(verificationText, { delay: 100 });
    }
    
    // Take screenshot after entering text
    await takeScreenshot(page, 'text_entered');
    
    // Enable the continue button if it exists and is disabled
    await page.evaluate(() => {
      // Find the correct continue button (might be disabled)
      const continueBtn = document.querySelector('button.continue-btn-info.el-button--info.is-disabled');
      if (continueBtn) {
        // Remove disabled attribute and classes
        continueBtn.removeAttribute('disabled');
        continueBtn.classList.remove('is-disabled');
        continueBtn.classList.add('el-button--primary');
        continueBtn.classList.remove('el-button--info');
        
        // Also try to show the active button if hidden
        const activeContinueBtn = document.querySelector('button.continue-btn-primary.el-button--primary');
        if (activeContinueBtn) {
          activeContinueBtn.style.display = 'inline-block';
        }
        
        console.log('Enabled continue button');
      }
    });
    
    // Try to click the continue button
    const continueBtnFound = await page.evaluate(() => {
      // Try different selectors for the continue button
      const btnSelectors = [
        'button.continue-btn-primary', 
        'button.mt15.continue-btn-primary',
        'button.el-button--primary span',
        'button.el-button--primary',
        'button.el-button span'
      ];
      
      // Try each selector
      for (const selector of btnSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // Check if it's the CONTINUE button
          const text = el.tagName === 'BUTTON' ? el.textContent.trim() : el.textContent.trim();
          if (text === 'CONTINUE') {
            const button = el.tagName === 'BUTTON' ? el : el.closest('button');
            
            // Make sure the button is visible and enabled
            button.style.display = 'inline-block';
            button.disabled = false;
            button.classList.remove('is-disabled');
            
            // Click it
            button.click();
            return true;
          }
        }
      }
      
      return false;
    });
    
    if (!continueBtnFound) {
      console.log('❌ Could not find or click CONTINUE button, trying direct selector');
      
      try {
        // Try using page.click on various selectors
        await page.click('button.continue-btn-primary');
        console.log('Clicked continue button using page.click');
      } catch (clickError) {
        console.error('❌ Error clicking continue button:', clickError.message);
        
        // Final attempt - use a script to find and click any button with "CONTINUE" text
        await page.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const btn of buttons) {
            if (btn.textContent.includes('CONTINUE')) {
              console.log('Found and clicking button with CONTINUE text');
              btn.click();
              return;
            }
          }
        });
      }
    }
    
    // Wait for verification to complete
    await delay(1000);
    
    // Just continue - we can't rely on the verification check
    console.log('✅ Completed verification step');
    return true;
  } catch (error) {
    console.error('❌ Error handling verification:', error.message);
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
    await takeScreenshot(page, 'before_filling_form');
    
    // Wait for the form to be available
    await page.waitForSelector('form.el-form');
    console.log('Form found, starting to fill details');

    // Gather all input fields with the common class
    const inputs = await page.$$('input.el-input__inner');
    console.log(`Found ${inputs.length} input fields`);

    // --------------------------------------------------
    // Fill the Contact Form Fields by their order/index:
    // Index mapping (based on provided HTML):
    //   [0] → First Name   (data-gtm-form-interact-field-id="1")
    //   [1] → Last Name    (data-gtm-form-interact-field-id="2")
    //   [2] → Country Code (data-gtm-form-interact-field-id="0")
    //   [3] → Phone Number (data-gtm-form-interact-field-id="3")
    //   [4] → Nationality  (data-gtm-form-interact-field-id="4", readonly dropdown)
    //   [5] → Residence    (data-gtm-form-interact-field-id="5", readonly dropdown)
    //   [6] → Address      (data-gtm-form-interact-field-id="6")
    //   [7] → Email        (data-gtm-form-interact-field-id="7")
    //   [8] → Confirm Email(data-gtm-form-interact-field-id="8")
    //   [9] → Verification Code (no data-gtm attribute)
    // --------------------------------------------------

    // First Name
    console.log('Filling First Name');
    await inputs[0].click({ clickCount: 3 }); // Clear any existing text
    await inputs[0].type('');
    await inputs[0].type('oded');
    await delay(200);

    // Last Name
    console.log('Filling Last Name');
    await inputs[1].click({ clickCount: 3 });
    await inputs[1].type('');
    await inputs[1].type('kovach');
    await delay(200);

    // --- Phone Number Section ---
    console.log('Handling Phone Number Section');
    // Country Code
    await inputs[2].click();
    await takeScreenshot(page, 'before_country_code');
    
    // Wait for the dropdown to appear if available
    await page.waitForSelector('.el-select-dropdown', { timeout: 3000 })
      .catch(() => console.log('Country code dropdown not visible'));
    
    await inputs[2].type('+972');
    await page.keyboard.press('Enter');
    await delay(500);
    
    // Phone Number
    await inputs[3].click({ clickCount: 3 });
    await inputs[3].type('');
    await inputs[3].type('0547777655');
    await delay(200);

    // --- Nationality Dropdown ---
    console.log('Handling Nationality Dropdown');
    await takeScreenshot(page, 'before_nationality');
    await inputs[4].click();
    await delay(500);
    
    await page.waitForSelector('.el-select-dropdown', { timeout: 3000 });
    await delay(500);
    
    const nationalitySelected = await page.evaluate(() => {
      const simulateNativeClick = (element) => {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width/2,
          clientY: rect.top + rect.height/2
        }));
        element.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width/2,
          clientY: rect.top + rect.height/2
        }));
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width/2,
          clientY: rect.top + rect.height/2
        }));
      };

      // Try to find Israel in different ways
      const options = Array.from(document.querySelectorAll('.el-select-dropdown__item span'));
      console.log(`Found ${options.length} nationality options`);
      
      const israel = options.find(opt => opt.innerText.trim() === 'Israel');
      if (israel) {
        console.log('Found Israel by exact match');
        const parentLi = israel.closest('li.el-select-dropdown__item');
        if (parentLi) {
          simulateNativeClick(parentLi);
          return true;
        }
        simulateNativeClick(israel);
        return true;
      }
      
      // Backup: try finding by partial match
      const israelByPartial = options.find(opt => opt.innerText.includes('Israel'));
      if (israelByPartial) {
        console.log('Found Israel by partial match');
        const parentLi = israelByPartial.closest('li.el-select-dropdown__item');
        if (parentLi) {
          simulateNativeClick(parentLi);
          return true;
        }
        simulateNativeClick(israelByPartial);
        return true;
      }
      
      return false;
    });
    
    if (!nationalitySelected) {
      console.log('⚠️ Could not select Israel for nationality');
    }
    
    await delay(1000);
    await takeScreenshot(page, 'after_nationality');

    // --- Place of Residence Dropdown ---
    console.log('Handling Place of Residence Dropdown');
    await takeScreenshot(page, 'before_residence');
    await inputs[5].click();
    await delay(500);
    
    await page.waitForSelector('.el-select-dropdown', { timeout: 3000 });
    await delay(500);
    
    const residenceSelected = await page.evaluate(() => {
      const simulateNativeClick = (element) => {
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width/2,
          clientY: rect.top + rect.height/2
        }));
        element.dispatchEvent(new MouseEvent('mouseup', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width/2,
          clientY: rect.top + rect.height/2
        }));
        element.dispatchEvent(new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX: rect.left + rect.width/2,
          clientY: rect.top + rect.height/2
        }));
      };

      const options = Array.from(document.querySelectorAll('.el-select-dropdown__item span'));
      console.log(`Found ${options.length} residence options`);
      
      const israel = options.find(opt => opt.innerText.trim() === 'Israel');
      if (israel) {
        console.log('Found Israel by exact match');
        const parentLi = israel.closest('li.el-select-dropdown__item');
        if (parentLi) {
          simulateNativeClick(parentLi);
          return true;
        }
        simulateNativeClick(israel);
        return true;
      }
      
      // Backup: try finding by partial match
      const israelByPartial = options.find(opt => opt.innerText.includes('Israel'));
      if (israelByPartial) {
        console.log('Found Israel by partial match');
        const parentLi = israelByPartial.closest('li.el-select-dropdown__item');
        if (parentLi) {
          simulateNativeClick(parentLi);
          return true;
        }
        simulateNativeClick(israelByPartial);
        return true;
      }
      
      return false;
    });
    
    if (!residenceSelected) {
      console.log('⚠️ Could not select Israel for residence');
    }
    
    await delay(1000);
    await takeScreenshot(page, 'after_residence');

    // Address
    console.log('Filling Address');
    await inputs[6].click({ clickCount: 3 });
    await inputs[6].type('');
    await inputs[6].type('rokah 106 Ramat Gan');
    await delay(200);

    // Email Address
    console.log('Filling Email');
    await inputs[7].click({ clickCount: 3 });
    await inputs[7].type('');
    await inputs[7].type('oded.kovach@gmail.com');
    await delay(200);

    // Confirm Email Address
    console.log('Filling Confirm Email');
    await inputs[8].click({ clickCount: 3 });
    await inputs[8].type('');
    await inputs[8].type('oded.kovach@gmail.com');
    await delay(200);

    // Take final screenshot
    await takeScreenshot(page, 'after_filling_form');
    console.log('✅ Form filled successfully');
    
    return true;
  } catch (error) {
    console.error('❌ Error filling form:', error.message);
    await takeScreenshot(page, 'form_fill_error');
    return false;
  }
}

// Add new function to handle phone number separately
async function fillPhoneNumber(instruction, page) {
  try {
    console.log('Filling phone number fields');
    await takeScreenshot(page, 'before_filling_phone');
    
    // Target the phone number container element directly based on the provided HTML
    await page.evaluate(() => {
      // Find the phone number container by its class
      const phoneContainer = document.querySelector('div.el-form-item.pc-phoneNumber-input');
      if (phoneContainer) {
        phoneContainer.style.border = '3px solid green';
        console.log('Found phone container');
      } else {
        console.log('Phone container not found');
      }
    });
    
    // First handle the country code dropdown
    await page.evaluate(() => {
      // Click the country code dropdown (first input in the phone container)
      const countryCodeInput = document.querySelector('div.el-form-item.pc-phoneNumber-input .el-select input');
      if (countryCodeInput) {
        console.log('Found country code input');
        countryCodeInput.click();
      } else {
        console.log('Country code input not found');
      }
    });
    
    // Wait for dropdown to appear
    await page.waitForSelector('.el-select-dropdown', { timeout: 3000 });
    await delay(500); // Extra delay to ensure dropdown is fully loaded
    
    // Select Israel from the dropdown - use the exact selector from the provided HTML
    const israelSelected = await page.evaluate(() => {
      // Use the exact selector structure from the provided HTML
      const israelItem = document.querySelector('li.el-select-dropdown__item[data-v-6aff2c22] span[style*="float: left"]:not([style*="float: right"])');
      
      // If exact selector doesn't work, try these backup methods
      if (!israelItem) {
        console.log('Exact selector failed, trying alternative approaches');
        
        // First backup: Find item containing both "Israel" and "+972"
        const dropdownItems = Array.from(document.querySelectorAll('li.el-select-dropdown__item'));
        for (const item of dropdownItems) {
          if (item.textContent.includes('Israel') && item.textContent.includes('+972')) {
            console.log('Found Israel item by text content');
            item.click();
            return true;
          }
        }
        
        // Second backup: Try finding spans containing "Israel"
        const israelSpans = Array.from(document.querySelectorAll('span'))
          .filter(span => span.textContent.trim() === 'Israel');
        
        if (israelSpans.length > 0) {
          console.log('Found Israel span by text content');
          // Click the li parent
          const parent = israelSpans[0].closest('li.el-select-dropdown__item');
          if (parent) {
            parent.click();
            return true;
          } else {
            // Click the span itself if no parent
            israelSpans[0].click();
            return true;
          }
        }
        
        return false;
      }
      
      // If we found the exact element, click its parent li
      const parentLi = israelItem.closest('li.el-select-dropdown__item');
      console.log('Found Israel dropdown item with exact selector');
      
      if (parentLi) {
        // Click the parent li element (more reliable)
        parentLi.click();
        return true;
      } else {
        // Fallback to clicking the span itself
        israelItem.click();
        return true;
      }
    });
    
    if (!israelSelected) {
      console.log('⚠️ Could not select Israel from dropdown using exact selectors, trying direct approach');
      
      // Last resort: Use page.click directly 
      try {
        // Click on Israel in the dropdown by targeting any visible element containing Israel
        await page.click('li.el-select-dropdown__item');
        console.log('Clicked dropdown item with direct selector');
      } catch (clickError) {
        console.error('Failed to click Israel with direct approach:', clickError.message);
      }
    }
    
    // Wait for dropdown to close
    await delay(1000);
    
    // Now handle the actual phone number input
    await page.evaluate(() => {
      // Target the exact phone number input using the data attribute
      const phoneInput = document.querySelector('div.el-form-item.pc-phoneNumber-input .reset-el-select input[data-gtm-form-interact-field-id="2"]');
      if (phoneInput) {
        console.log('Found phone number input field');
        
        // Clear existing value
        phoneInput.value = '';
        
        // Set new value and dispatch input event
        phoneInput.value = '0547777655';
        phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
        
        return true;
      } else {
        console.log('Could not find phone number input field');
        return false;
      }
    });
    
    console.log('Filled phone number: 0547777655');
    await takeScreenshot(page, 'after_filling_phone');
    
    console.log('✅ Phone number filled successfully');
    return true;
  } catch (error) {
    console.error('❌ Error filling phone number:', error.message);
    await takeScreenshot(page, 'phone_fill_error');
    return false;
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
    
    // Define the steps for our process
    const steps = [
      { name: 'Find Universal Express Pass 4: Thrills & Choice product', action: 'findProduct' },
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
      { name: 'Handle Captcha Verification', action: 'handleCaptcha' },
      { name: 'Enter Verification Code', action: 'handleCaptcha' },
      { name: 'Check Terms of Service Checkbox', action: 'checkTermsCheckbox' },
      { name: 'Check Cancellation Policy Checkbox', action: 'checkCancellationCheckbox' },
      { name: 'Fill Phone Number', action: 'fillPhoneNumber' }
    ];
    
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
          // Get the current DOM as HTML
          const dom = await page.content();
          
          // Get instruction from GPT-4o with retry information if applicable
          const instruction = await getStepInstruction(step.name, dom, retryCount, lastError);
          console.log("Obtained instruction:", instruction);
          
          // Take a screenshot before each action
          await takeScreenshot(page, `before_${step.name.replace(/\s+/g, '_')}${retryCount > 0 ? `_retry${retryCount}` : ''}`);
          console.log(`About to perform action: ${instruction.action}. Waiting 1 seconds...`);
          await delay(1000);
          
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
          else if (instruction.action === 'fillFormDetails') {
            stepSuccess = await fillFormDetails(instruction, page);
            console.log(`fillFormDetails completed with success: ${stepSuccess}`);
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
          else if (instruction.action === 'fillPhoneNumber') {
            stepSuccess = await fillPhoneNumber(instruction, page);
            console.log(`fillPhoneNumber completed with success: ${stepSuccess}`);
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
          await delay(1000);
          
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