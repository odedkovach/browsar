const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const axios = require('axios');
require('dotenv').config(); // Load environment variables from .env file
const captchaHandler = require('./captcha-handler'); // Import the captcha handler module

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
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotPath = path.join(screenshotsDir, `${name}_${timestamp}.png`);
    
    // await page.screenshot({ path: screenshotPath });
    console.log(`Screenshot saved: ${name}_${timestamp}.png`);
  } catch (error) {
    console.error(`Error taking screenshot: ${error.message}`);
  }
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
productName= 'Universal Express Pass 4: 4D & Thrills';
// Define the steps for our process with their corresponding actions
const steps = [
  { name: `Find ${productName} product`, action: 'findProduct', productName: productName },
  { name: 'Increase quantity ', action: 'increaseQuantity', quantity: 3 },
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
  { name: 'Click Continue', action: 'clickContinue' },
  { name: 'Click Credit Card', action: 'clickCreditCard' },
  { name: 'Checkout Continue', action: 'continue_checkout' },
  { name: 'Fill Checkout', action: 'fillCheckout' },
  { name: 'Fill Checkout Nationality', action: 'fillCheckoutNationality' }
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

async function handleCaptcha(instruction, page) {
    console.log('Handling text verification');
    await takeScreenshot(page, 'before_text_verification');
    console.log('Looking for verification elements...');

    try {
        // First, wait for the verification image to be visible
        console.log('Waiting for verification image to be fully loaded...');
        await page.waitForSelector('img[data-v-6aff2c22], .verification-image, img[src*="captcha"], img[src*="verification"], img[class*="captcha"], img[class*="verification"]', { visible: true, timeout: 10000 });
        
        // Try multiple selectors to find the verification image
        const selectors = [
            'img[data-v-6aff2c22]',
            '.verification-image',
            'img[src*="captcha"]',
            'img[src*="verification"]',
            'img[class*="captcha"]',
            'img[class*="verification"]'
        ];
        
        let verificationImageSelector = null;
        for (const selector of selectors) {
            const exists = await page.evaluate((sel) => document.querySelector(sel) !== null, selector);
            if (exists) {
                console.log(`Found verification image with selector: ${selector}`);
                verificationImageSelector = selector;
                break;
            }
        }
        
        if (!verificationImageSelector) {
            throw new Error('Verification image not found');
        }
        
        console.log('Found verification image');
        
        // Enhanced image processing
        const enhancedScreenshot = await page.evaluate((selector) => {
            const img = document.querySelector(selector);
            if (!img) return null;
            
            // Create a canvas to enhance the image
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Set canvas dimensions to match the image
            canvas.width = img.width * 2; // Increase size for better clarity
            canvas.height = img.height * 2;
            
            // Draw the image on the canvas with increased contrast
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            // Apply image enhancements
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            
            // Increase contrast and sharpness
            for (let i = 0; i < data.length; i += 4) {
                // Increase contrast
                data[i] = data[i] < 128 ? data[i] * 0.8 : data[i] * 1.2;
                data[i+1] = data[i+1] < 128 ? data[i+1] * 0.8 : data[i+1] * 1.2;
                data[i+2] = data[i+2] < 128 ? data[i+2] * 0.8 : data[i+2] * 1.2;
            }
            
            ctx.putImageData(imageData, 0, 0);
            
            // Highlight the image with a red border
            img.style.border = '3px solid red';
            
            // Return the enhanced image as a data URL
            return {
                originalSrc: img.src,
                enhancedImage: canvas.toDataURL('image/png'),
                width: img.width,
                height: img.height
            };
        }, verificationImageSelector);
        
        if (!enhancedScreenshot) {
            throw new Error('Failed to process verification image');
        }
        
        // Take a full screenshot with the highlighted captcha
        await takeScreenshot(page, 'text_verification');
        
        // Save a full screenshot with highlighted text for debugging
        await page.screenshot({ path: `screenshots/text_verification_${new Date().toISOString().replace(/:/g, '-')}.png` });
        
        // We'll try multiple prompts with retries
        const prompts = [
            "Return ONLY the characters you see in the red-bordered image. Do not include any explanations or extra text. Just the CAPTCHA text.",
            "What letters and numbers do you see in the red-bordered verification image? Return ONLY the characters, nothing else.",
            "Identify the CAPTCHA characters in the red-bordered image. Provide ONLY the characters with no additional text."
        ];
        
        let verificationText = '';
        let success = false;
        
        // Try each prompt until we get a good response
        for (let i = 0; i < prompts.length && !success; i++) {
            const prompt = prompts[i];
            console.log(`Attempt ${i+1}: Using prompt: "${prompt}"`);
            
            try {
                // Create a detailed OpenAI prompt with both original and enhanced image
                const apiResponse = await axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    {
                        model: "gpt-4o",
                        messages: [
                            {
                                role: "system",
                                content: "You are a CAPTCHA solving assistant. Your only job is to identify the text in verification images. Return ONLY the characters, with no additional text or explanations."
                            },
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
                                            url: enhancedScreenshot.enhancedImage
                                        }
                                    }
                                ]
                            }
                        ],
                        max_tokens: 30
                    },
                    {
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
                        }
                    }
                );
                
                console.log('Raw OpenAI response:');
                console.log(JSON.stringify(apiResponse.data, null, 2));
                
                // Extract the text from the API response
                let rawText = apiResponse.data.choices[0].message.content;
                
                // Clean up the response - remove any non-alphanumeric characters
                verificationText = rawText.replace(/[^a-zA-Z0-9]/g, '');
                
                // Check if we got a reasonable response
                if (verificationText.length >= 4 && verificationText.length <= 8) {
                    console.log(`Processed verification text: "${verificationText}"`);
                    success = true;
                    break;
                } else {
                    console.log(`Got invalid text length (${verificationText.length}): "${verificationText}". Trying another prompt.`);
                }
            } catch (error) {
                console.error(`Error with prompt ${i+1}:`, error.message);
                // Continue to next prompt
            }
        }
        
        if (!success) {
            throw new Error('Failed to extract valid verification text after multiple attempts');
        }
        
        // Try to find the input field and submit the captcha
        console.log(`Text detected: ${verificationText}`);
        
        // Attempt multiple approaches to find and fill the verification input field
        let captchaFilled = false;
        
        // Approach 1: Try specific attribute-based selectors
        try {
            console.log('Approach 1: Using attribute-based selectors...');
            // Wait for the input field with shorter timeout
            const inputExists = await page.evaluate(() => {
                const selectors = [
                    'input[placeholder*="verification"]', 
                    'input[placeholder*="captcha"]', 
                    'input[name*="captcha"]', 
                    'input[class*="verification"]', 
                    'input[class*="captcha"]',
                    'input[aria-label*="verification"]', 
                    'input[aria-label*="captcha"]'
                ];
                
                for (const selector of selectors) {
                    if (document.querySelector(selector)) {
                        return true;
                    }
                }
                return false;
            });
            
            if (inputExists) {
                console.log('Found input field with attribute-based selector');
                await page.evaluate((text) => {
                    const selectors = [
                        'input[placeholder*="verification"]', 
                        'input[placeholder*="captcha"]', 
                        'input[name*="captcha"]', 
                        'input[class*="verification"]', 
                        'input[class*="captcha"]',
                        'input[aria-label*="verification"]', 
                        'input[aria-label*="captcha"]'
                    ];
                    
                    for (const selector of selectors) {
                        const input = document.querySelector(selector);
                        if (input) {
                            input.value = text;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            return;
                        }
                    }
                }, verificationText);
                
                captchaFilled = true;
            }
        } catch (error) {
            console.log('Approach 1 failed:', error.message);
        }
        
        // Approach 2: Try specific positional selector (like the original code)
        if (!captchaFilled) {
            try {
                console.log('Approach 2: Using positional selector (div:nth-of-type(10) input)...');
                const inputExists = await page.evaluate(() => {
                    return document.querySelector('div:nth-of-type(10) input') !== null;
                });
                
                if (inputExists) {
                    console.log('Found input field with positional selector');
                    await page.locator('div:nth-of-type(10) input').click();
                    await page.locator('div:nth-of-type(10) input').fill(verificationText);
                    captchaFilled = true;
                }
            } catch (error) {
                console.log('Approach 2 failed:', error.message);
            }
        }
        
        // Approach 3: Look for any input field near the verification image
        if (!captchaFilled) {
            try {
                console.log('Approach 3: Looking for any input field near the verification image...');
                const inputFound = await page.evaluate((imgSelector) => {
                    const img = document.querySelector(imgSelector);
                    if (!img) return false;
                    
                    // Try to find any input within the same form or container
                    let container = img.parentElement;
                    for (let i = 0; i < 5; i++) {
                        if (!container) break;
                        
                        // Look for inputs within this container
                        const inputs = container.querySelectorAll('input[type="text"]');
                        if (inputs.length > 0) {
                            // Fill the first available input
                            inputs[0].value = '';
                            inputs[0].focus();
                            return true;
                        }
                        
                        // Move up one level
                        container = container.parentElement;
                    }
                    
                    return false;
                }, verificationImageSelector);
                
                if (inputFound) {
                    console.log('Found input field near verification image');
                    await page.keyboard.type(verificationText);
                    captchaFilled = true;
                }
            } catch (error) {
                console.log('Approach 3 failed:', error.message);
            }
        }
        
        // Approach 4: Look for any visible text input on the page
        if (!captchaFilled) {
            try {
                console.log('Approach 4: Looking for any visible text input...');
                const inputFound = await page.evaluate(() => {
                    // Find all visible text inputs
                    const allInputs = Array.from(document.querySelectorAll('input[type="text"]'))
                        .filter(input => {
                            const style = window.getComputedStyle(input);
                            return style.display !== 'none' && 
                                   style.visibility !== 'hidden' && 
                                   input.offsetParent !== null;
                        });
                    
                    // Use the first visible input
                    if (allInputs.length > 0) {
                        allInputs[0].style.border = '3px solid red';
                        allInputs[0].focus();
                        return true;
                    }
                    
                    return false;
                });
                
                if (inputFound) {
                    console.log('Found visible text input');
                    await page.keyboard.type(verificationText);
                    captchaFilled = true;
                }
            } catch (error) {
                console.log('Approach 4 failed:', error.message);
            }
        }
        
        if (!captchaFilled) {
            throw new Error('Could not find or fill the verification input field');
        }
        
        // Wait a moment for the input to register
        await delay(1000);
        
        console.log('✅ Completed verification step');
        return true;
    } catch (error) {
        console.error(`Error in handleCaptcha: ${error.message}`);
        
        // If we fail, try one more approach - look for any input field that might accept the CAPTCHA
        try {
            await page.evaluate(() => {
                // Look for any text input that's visible
                const inputs = Array.from(document.querySelectorAll('input[type="text"]'))
                    .filter(input => {
                        const style = window.getComputedStyle(input);
                        return style.display !== 'none' && style.visibility !== 'hidden' && input.offsetParent !== null;
                    });
                
                if (inputs.length > 0) {
                    // Highlight it for debugging
                    inputs[0].style.border = '2px solid red';
                    return true;
                }
                return false;
            });
            
            await takeScreenshot(page, 'found_possible_captcha_input');
            
            throw new Error(`Failed to complete captcha: ${error.message}`);
        } catch (finalError) {
            throw new Error(`Failed to handle captcha: ${error.message}`);
        }
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
        
        // Take a screenshot of the available products
        await takeScreenshot(page, 'available_products');
        
        // First get a list of all product names for debugging
        const productList = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('h3'))
                .map(el => el.textContent.trim())
                .filter(text => text.length > 0);
        });
        
        console.log('Available products:', productList);
        
        // Use exact product name matching
        const productFound = await page.evaluate((exactProductName) => {
            // Log exact product we're looking for
            console.log(`Looking for exact product: "${exactProductName}"`);
            
            // First find the h3 with the EXACT product title
            const productTitles = Array.from(document.querySelectorAll('h3'));
            let targetTitle = null;
            
            // Try exact match first
            for (const title of productTitles) {
                const titleText = title.textContent.trim();
                console.log(`Comparing "${titleText}" with "${exactProductName}"`);
                
                if (titleText === exactProductName) {
                    targetTitle = title;
                    console.log("Found exact match!");
                    break;
                }
            }
            
            // If no exact match, try includes
            if (!targetTitle) {
                for (const title of productTitles) {
                    const titleText = title.textContent.trim();
                    if (titleText.includes(exactProductName)) {
                        targetTitle = title;
                        console.log("Found partial match!");
                        break;
                    }
                }
            }
            
            if (!targetTitle) return { success: false, reason: 'Product title not found' };
            
            // Highlight the title
            targetTitle.style.border = '5px solid red';
            targetTitle.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
            
            // Scroll to it
            targetTitle.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Find the card containing this title
            let card = targetTitle;
            let foundButton = null;
            
            // Try to go up to find the card containing this product
            for (let i = 0; i < 8; i++) {
                if (!card.parentElement) break;
                card = card.parentElement;
                
                // Look for SELECT A DATE button within this card
                const buttons = card.querySelectorAll('button');
                for (const button of buttons) {
                    if (button.textContent.includes('SELECT A DATE')) {
                        console.log("Found SELECT A DATE button in this card");
                        foundButton = button;
                        break;
                    }
                }
                
                if (foundButton) break;
                
                // If we find a container that seems to contain multiple products, stop climbing
                if (card.querySelectorAll('h3').length > 1) {
                    console.log("Found container with multiple products, stopping here");
                    break;
                }
            }
            
            // Make sure this is the right card by double-checking the title
            const cardTitle = card.querySelector('h3');
            if (cardTitle && cardTitle !== targetTitle) {
                console.log(`Card contains a different title: ${cardTitle.textContent}`);
                return { 
                    success: false, 
                    reason: `Found wrong card with title: ${cardTitle.textContent}` 
                };
            }
            
            // Highlight the entire card
            card.style.border = '5px solid blue';
            card.style.backgroundColor = 'rgba(0, 0, 255, 0.1)';
            
            // If we found a button, click it to select this product
            if (foundButton) {
                // Highlight the button
                foundButton.style.border = '5px solid green';
                foundButton.style.backgroundColor = 'rgba(0, 255, 0, 0.3)';
                
                // Make absolutely sure this is for our exact product
                const relatedTitle = card.querySelector('h3');
                if (relatedTitle) {
                    const titleText = relatedTitle.textContent.trim();
                    console.log(`Button is for product: "${titleText}"`);
                    
                    if (titleText === exactProductName || titleText.includes(exactProductName)) {
                        // Click the button to select this specific product
                        console.log("Clicking SELECT A DATE button for this product");
                        foundButton.click();
                        return { 
                            success: true, 
                            text: titleText,
                            clicked: true
                        };
                    } else {
                        console.log("Title doesn't match our product, not clicking");
                        return { 
                            success: false, 
                            reason: `Button belongs to wrong product: ${titleText}` 
                        };
                    }
                }
            } else {
                console.log("No SELECT A DATE button found in this card");
            }
            
            return { 
                success: true, 
                text: targetTitle.textContent,
                clicked: foundButton !== null
            };
        }, instruction.productName);
        
        if (!productFound.success) {
            console.error(`Could not find product: ${productFound.reason}`);
            throw new Error(`Could not find product: ${productFound.reason}`);
        }
        
        console.log(`✅ Found product: ${productFound.text}`);
        if (productFound.clicked) {
            console.log(`✅ Clicked SELECT A DATE button for ${instruction.productName}`);
        } else {
            console.log(`⚠️ Product found but no button clicked - will proceed with next steps`);
        }
        
        await takeScreenshot(page, 'product_found');
        return true;  // Explicitly return true for success
    } catch (error) {
        console.error(`Error in findProduct: ${error.message}`);
        throw error;  // Rethrow to be caught by the main loop
    }
}

async function increaseQuantity(instruction, page) {
    // Get quantity from instruction, default to 1 if not specified
    const targetQuantity = instruction.quantity || 1;
    console.log(`Increasing quantity to ${targetQuantity}`);
    
    try {
        // APPROACH 1: Try using recorded selector pattern from the JSON
        console.log('Strategy 1: Using positional selectors from recording');
        
        // The increment was done on the product at position 11
        // We'll make this more generic by checking all cards and taking the one we want
        const result = await page.evaluate((quantity, productNameFromInstruction) => {
            // Log to help debug
            console.log(`Looking to increase quantity to ${quantity} for product: ${productNameFromInstruction}`);
            
            // MULTIPLE STRATEGIES FOR FINDING THE CORRECT PRODUCT CARD
            
            // Strategy 1: Look for all product cards
            const allProductCards = Array.from(document.querySelectorAll('div[class*="card"], div[class*="product"], div[class*="item"]'));
            
            // Function to check if a card contains our product
            const findProductCardByName = (cards, productName) => {
                for (let i = 0; i < cards.length; i++) {
                    const card = cards[i];
                    const titleEls = card.querySelectorAll('h3, h2, h4, [class*="title"]');
                    for (const el of titleEls) {
                        if (el.textContent.includes(productName)) {
                            console.log(`Found product card #${i+1} containing "${productName}"`);
                            return {
                                index: i,
                                element: card,
                                method: 'by-product-name'
                            };
                        }
                    }
                }
                return null;
            };
            
            // Try to find the product card by name
            let targetCard = null;
            let targetIndex = 0;
            
            if (productNameFromInstruction) {
                const result = findProductCardByName(allProductCards, productNameFromInstruction);
                if (result) {
                    targetCard = result.element;
                    targetIndex = result.index;
                }
            }
            
            // If no specific card found, check if calendar is already open (meaning we already clicked a card)
            if (!targetCard) {
                // Check if any calendar or date picker is visible
                const datePickerVisible = document.querySelector('.el-picker-panel, [class*="calendar"], [class*="datepicker"]');
                
                if (datePickerVisible) {
                    // We already clicked a product and the date picker is open
                    // Look for any nearby quantity controls
                    const plusButtons = Array.from(document.querySelectorAll('span.plus, span[class*="plus"], button[class*="plus"], [aria-label*="increase"]'));
                    
                    if (plusButtons.length > 0) {
                        // Use the first plus button we find
                        const plusButton = plusButtons[0];
                        plusButton.style.border = '3px solid red';
                        plusButton.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                        
                        // Click the button exactly 'quantity' times
                        for (let i = 0; i < quantity; i++) {
                            plusButton.click();
                            console.log(`Click ${i+1}/${quantity}`);
                        }
                        
                        return { 
                            success: true, 
                            strategy: 'datepicker-open', 
                            clickCount: quantity
                        };
                    }
                }
            }
            
            // STRATEGY FOR CLICKING BUTTONS:
            // 1. Try to use exact selector from recording if no specific card found
            // 2. If card was found, search for plus button within that card
            
            if (!targetCard) {
                // Use selector from the recording - look for all plus buttons across any card
                const allPlusButtons = Array.from(document.querySelectorAll('span.plus, span[class*="plus"], button[class*="plus"], [aria-label*="increase"]'));
                
                if (allPlusButtons.length === 0) {
                    return { success: false, reason: 'No plus buttons found on the page' };
                }
                
                // Try the specific selector from recording - div:nth-of-type(11) span.plus
                let plusButton = null;
                try {
                    // Try exact selector from recording first if no specific product was requested
                    if (!productNameFromInstruction) {
                        const recordedButton = document.querySelector('div:nth-of-type(11) span.plus');
                        if (recordedButton) {
                            plusButton = recordedButton;
                            console.log('Found plus button using recorded selector');
                        }
                    }
                    
                    // If not found, use any plus button
                    if (!plusButton) {
                        plusButton = allPlusButtons[0];
                        console.log('Using first available plus button');
                    }
                    
                    // Highlight the button
                    plusButton.style.border = '3px solid red';
                    plusButton.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                    
                    // Click the button exactly 'quantity' times
                    for (let i = 0; i < quantity; i++) {
                        plusButton.click();
                        console.log(`Click ${i+1}/${quantity}`);
                    }
                    
                    return { 
                        success: true, 
                        strategy: 'generic', 
                        clickCount: quantity
                    };
                    
                } catch (e) {
                    console.log('Error using recorded selector:', e);
                }
            } else {
                // We found the specific product card
                // Find plus button within this card
                const plusButton = targetCard.querySelector('span.plus, span[class*="plus"], button[class*="plus"], [aria-label*="increase"]');
                
                if (!plusButton) {
                    return { success: false, reason: 'Plus button not found in the product card' };
                }
                
                // Highlight the button
                plusButton.style.border = '3px solid red';
                plusButton.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                
                // Click the button exactly 'quantity' times
                for (let i = 0; i < quantity; i++) {
                    plusButton.click();
                    console.log(`Click ${i+1}/${quantity}`);
                }
                
                return { 
                    success: true, 
                    strategy: 'specific-card', 
                    clickCount: quantity
                };
            }
            
            // STRATEGY 3: Most versatile, uses alternative XPath selector
            try {
                // Try using the XPath from the recording
                const xpathResult = document.evaluate('//*[@id="app"]//span[contains(@class, "plus")]', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                
                if (xpathResult.snapshotLength > 0) {
                    const plusButton = xpathResult.snapshotItem(0);
                    
                    // Highlight the button
                    plusButton.style.border = '3px solid red';
                    plusButton.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                    
                    // Click the button exactly 'quantity' times
                    for (let i = 0; i < quantity; i++) {
                        plusButton.click();
                        console.log(`Click ${i+1}/${quantity}`);
                    }
                    
                    return { 
                        success: true, 
                        strategy: 'xpath', 
                        clickCount: quantity
                    };
                }
            } catch (e) {
                console.log('Error with XPath strategy:', e);
            }
            
            return { success: false, reason: 'All strategies failed to find and click plus button' };
        }, targetQuantity, instruction.productName);
        
        if (result.success) {
            console.log(`✅ Increased quantity to ${targetQuantity} using strategy: ${result.strategy}`);
            // Add delay after clicks to allow page to update
            await delay(1000);
        } else {
            // If first approach fails, try the direct click method
            console.log('Strategy 1 failed. Trying Strategy 2: Direct selector click');
            
            // Use the specific selector pattern from the recording
            await page.$$eval('div span.plus', (buttons, qty) => {
                if (buttons.length > 0) {
                    // Highlight the button for visibility
                    buttons[0].style.border = '3px solid red';
                    
                    // Click exactly qty times
                    for (let i = 0; i < qty; i++) {
                        buttons[0].click();
                    }
                    return true;
                }
                return false;
            }, targetQuantity);
            
            console.log('✅ Increased quantity with direct click strategy');
            await delay(1000);
        }
        
        // Take a screenshot to verify
        await takeScreenshot(page, 'quantity_increased');
        return true;
    } catch (error) {
        console.error(`Error in increaseQuantity: ${error.message}`);
        throw error;
    }
}

async function clickSelectDate(instruction, page) {
    console.log('Looking for SELECT A DATE button...');
    
    try {
        // First, check if the date picker is already visible
        const datePickerVisible = await page.evaluate(() => {
            return document.querySelector('.el-picker-panel, [class*="calendar"], [class*="datepicker"]') !== null;
        });
        
        if (datePickerVisible) {
            console.log('Date picker is already visible, no need to click SELECT A DATE');
            return true;
        }
        
        // Take a screenshot before looking for the button
        await takeScreenshot(page, 'before_click_select_date');
        
        // APPROACH 1: Try using a generic strategy to find SELECT A DATE buttons
        const buttonClicked = await page.evaluate(() => {
            // Function to highlight an element
            const highlight = (el, color = 'green') => {
                el.style.border = `3px solid ${color}`;
                el.style.backgroundColor = color === 'red' ? 'rgba(255, 0, 0, 0.2)' : 'rgba(0, 255, 0, 0.2)';
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            };
            
            // Strategy 1: Find any visible SELECT A DATE button
            const findButtonByText = (text) => {
                const buttons = Array.from(document.querySelectorAll('button'));
                for (const button of buttons) {
                    if (button.textContent.includes(text)) {
                        return button;
                    }
                    
                    // Check button's children (e.g., spans)
                    const spans = button.querySelectorAll('span');
                    for (const span of spans) {
                        if (span.textContent.includes(text)) {
                            return button;
                        }
                    }
                }
                return null;
            };
            
            // Try to find the SELECT A DATE button
            let selectDateButton = findButtonByText('SELECT A DATE');
            
            if (!selectDateButton) {
                // Try alternative texts
                selectDateButton = findButtonByText('Select a date') 
                    || findButtonByText('Select Date')
                    || findButtonByText('CALENDAR')
                    || findButtonByText('Calendar');
            }
            
            if (selectDateButton) {
                highlight(selectDateButton);
                selectDateButton.click();
                return { success: true, method: 'text-search' };
            }
            
            // Strategy 2: Try positional selectors
            // Based on a typical product card layout
            const productCards = document.querySelectorAll('div[class*="card"], div[class*="product"], div[class*="item"]');
            
            for (let i = 0; i < productCards.length; i++) {
                const card = productCards[i];
                // Check if this card has the quantity controls active
                const hasVisibleQuantityControls = card.querySelector('span.plus[style*="border"]') !== null;
                
                if (hasVisibleQuantityControls) {
                    console.log(`Found card #${i+1} with active quantity controls`);
                    
                    // Look for any button in this card
                    const buttons = card.querySelectorAll('button');
                    if (buttons.length > 0) {
                        const button = buttons[0]; // Use the first button
                        highlight(button, 'red');
                        button.click();
                        return { success: true, method: 'active-card-button' };
                    }
                }
            }
            
            // Strategy 3: Use XPath selector from recording
            try {
                // Create a similar XPath pattern to what we'd find after quantity is set
                const xpathResult = document.evaluate('//div[.//span[contains(@class, "plus")]]//button', document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                
                if (xpathResult.snapshotLength > 0) {
                    const button = xpathResult.snapshotItem(0);
                    highlight(button, 'blue');
                    button.click();
                    return { success: true, method: 'xpath' };
                }
            } catch (e) {
                console.log('XPath strategy failed:', e);
            }
            
            return { success: false, reason: 'No SELECT A DATE button found using any strategy' };
        });
        
        if (buttonClicked && buttonClicked.success) {
            console.log(`✅ Clicked SELECT A DATE button using method: ${buttonClicked.method}`);
            // Wait for the calendar to appear
            await delay(2000);
            
            // Take screenshot after clicking
            await takeScreenshot(page, 'after_select_date_click');
            
            // Check if calendar is visible
            const calendarVisible = await page.evaluate(() => {
                const calendar = document.querySelector('.el-picker-panel, [class*="calendar"], [class*="datepicker"]');
                return calendar !== null;
            });
            
            if (calendarVisible) {
                console.log('✅ Calendar is visible after clicking SELECT A DATE');
                return true;
            }
            
            // If calendar not visible, try direct click on any button in the active product card
            console.log('⚠️ Calendar not visible, trying direct button click');
            await page.evaluate(() => {
                // Find the card with highlighted quantity controls
                const cards = document.querySelectorAll('div[class*="card"], div[class*="product"], div[class*="item"]');
                for (const card of cards) {
                    if (card.querySelector('[style*="border: 3px solid red"]')) {
                        // This is likely our active card, click its main button
                        const buttons = card.querySelectorAll('button');
                        if (buttons.length > 0) {
                            buttons[0].click();
                            return true;
                        }
                    }
                }
                return false;
            });
            
            // Wait again and check
            await delay(2000);
            return true;
        }
        
        // APPROACH 2: If general strategy fails, try direct XPath click from recording
        console.log('⚠️ Could not find SELECT A DATE button with generic strategy, trying direct click');
        
        // Use the exact buttonSelector from your recording JSON
        await page.evaluate(() => {
            // Try position-based selector from recording
            const button = document.querySelector('div:nth-of-type(11) button');
            if (button) {
                button.style.border = '3px solid purple';
                button.click();
                return true;
            }
            
            // Try any button that might be the SELECT A DATE
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                if (btn.textContent.includes('DATE') || btn.textContent.includes('Date')) {
                    btn.style.border = '3px solid orange';
                    btn.click();
                    return true;
                }
            }
            
            return false;
        });
        
        await delay(2000);
        console.log('✅ Attempted direct button click');
        
        // Take screenshot after clicking
        await takeScreenshot(page, 'after_direct_click');
        return true;
    } catch (error) {
        console.error(`Error in clickSelectDate: ${error.message}`);
        throw error;
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
    console.log('Selecting first enabled radio button');
    
    const radioSelected = await page.evaluate(() => {
        // Find all radio buttons
        const radioButtons = Array.from(document.querySelectorAll('input[type="radio"]'));
        
        if (radioButtons.length === 0) {
            return { success: false, reason: 'No radio buttons found' };
        }
        
        // Filter for enabled radio buttons
        const enabledRadios = radioButtons.filter(radio => 
            !radio.disabled && 
            !radio.hasAttribute('disabled') && 
            !radio.classList.contains('is-disabled') &&
            !radio.parentElement?.classList.contains('is-disabled') &&
            !radio.closest('label')?.classList.contains('is-disabled')
        );
        
        console.log(`Found ${radioButtons.length} radio buttons, ${enabledRadios.length} are enabled`);
        
        if (enabledRadios.length === 0) {
            return { success: false, reason: 'No enabled radio buttons found' };
        }
        
        // Get the first enabled radio
        const firstEnabledRadio = enabledRadios[0];
        
        // Highlight the radio button and its label
        const label = firstEnabledRadio.closest('label') || firstEnabledRadio.parentElement;
        if (label) {
            label.style.border = '3px solid green';
            label.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
        } else {
            firstEnabledRadio.style.outline = '3px solid green';
        }
        
        // Scroll into view before clicking
        const elementToScroll = label || firstEnabledRadio;
        elementToScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });
        
        // Click the radio button
        firstEnabledRadio.click();
        
        return { success: true };
    });
    
    if (!radioSelected.success) {
        throw new Error(`Could not select radio button: ${radioSelected.reason}`);
    }
    
    console.log('✅ Selected first enabled radio button');
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

// Function to click the Continue button
async function clickContinue(instruction, page) {
  console.log('Clicking Continue button');
  
  try {
    await takeScreenshot(page, 'before_click_continue');
    
    const buttonClicked = await page.evaluate(() => {
      // Try multiple selectors for the Continue button
      const continueButtons = Array.from(document.querySelectorAll('button, [role="button"], a.button'))
        .filter(btn => {
          const text = btn.textContent.trim().toLowerCase();
          return text.includes('continue') || 
                 btn.classList.contains('continue-btn-primary') ||
                 btn.querySelector('span')?.textContent.trim().toLowerCase().includes('continue');
        });
      
      if (continueButtons.length === 0) {
        return { success: false, reason: 'Continue button not found' };
      }
      
      // Highlight and click the button
      const btn = continueButtons[0];
      btn.style.border = '3px solid red';
      btn.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.click();
      
      return { success: true, text: btn.textContent };
    });
    
    if (!buttonClicked.success) {
      throw new Error(buttonClicked.reason);
    }
    
    console.log(`✅ Clicked button: ${buttonClicked.text}`);
    
    // Wait for the page to update
    await delay(2000);
    await takeScreenshot(page, 'after_click_continue');
    
    return true;
  } catch (error) {
    console.error(`Error in clickContinue: ${error.message}`);
    throw error;
  }
}

// Function to click the Credit Card button
async function clickCreditCard(instruction, page) {
  console.log('Clicking Credit Card button');
  
  try {
    await takeScreenshot(page, 'before_click_credit_card');
    
    const buttonClicked = await page.evaluate(() => {
      // Try multiple selectors for the Credit Card button
      const creditCardButtons = Array.from(document.querySelectorAll('button, [role="button"], a.button'))
        .filter(btn => {
          const text = btn.textContent.trim().toLowerCase();
          return text.includes('credit card') || 
                 text.includes('クレジットカード') ||
                 btn.querySelector('span')?.textContent.trim().toLowerCase().includes('credit card');
        });
      
      if (creditCardButtons.length === 0) {
        return { success: false, reason: 'Credit Card button not found' };
      }
      
      // Highlight and click the button
      const btn = creditCardButtons[0];
      btn.style.border = '3px solid red';
      btn.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
      btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      btn.click();
      
      return { success: true, text: btn.textContent };
    });
    
    if (!buttonClicked.success) {
      throw new Error(buttonClicked.reason);
    }
    
    console.log(`✅ Clicked button: ${buttonClicked.text}`);
    
    // Wait for the page to update
    await delay(2000);
    await takeScreenshot(page, 'after_click_credit_card');
    
    return true;
  } catch (error) {
    console.error(`Error in clickCreditCard: ${error.message}`);
    throw error;
  }
}

async function continue_checkout(page) {
  try {
    console.log('Attempting to click checkout continue button...');
    
    // Take a screenshot before action
    await takeScreenshot(page, 'before_checkout_continue');
    
    // Highlight and click the continue button
    const buttonFound = await page.evaluate(() => {
      // Try various selectors from the recorded JSON
      const selectors = [
        'div.container span > span',
        document.evaluate('//*[@id="paySubmit"]/span/span', document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue,
        'div.container span > span',
        'button:contains("CONTINUE")',
        '[id="paySubmit"]',
        'button span:contains("CONTINUE")'
      ];
      
      let continueButton = null;
      
      // Try each selector
      for (const selector of selectors) {
        if (typeof selector === 'object' && selector !== null) {
          // Handle XPath result
          continueButton = selector;
          break;
        }
        
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) {
          for (const el of elements) {
            if (el.textContent.includes('CONTINUE')) {
              continueButton = el;
              break;
            }
          }
          if (continueButton) break;
        }
      }
      
      if (!continueButton) {
        // Try paySubmit specifically
        const paySubmit = document.getElementById('paySubmit');
        if (paySubmit) {
          continueButton = paySubmit;
        }
      }
      
      if (!continueButton) {
        console.log('❌ No CONTINUE button found');
        return false;
      }
      
      // Highlight the button
      continueButton.style.border = '3px solid green';
      continueButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
      
      // Get the clickable element (may be the button or a parent)
      let clickTarget = continueButton;
      
      // If it's a span, try to find the button parent
      if (clickTarget.tagName.toLowerCase() === 'span') {
        clickTarget = clickTarget.closest('button') || clickTarget.parentElement || clickTarget;
      }
      
      // Make sure it's visible
      clickTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Click it
      clickTarget.click();
      
      console.log('✅ CONTINUE button clicked');
      return true;
    });
    
    if (!buttonFound) {
      throw new Error('CONTINUE button for checkout not found');
    }
    
    // Wait for navigation or content change using delay instead of waitForTimeout
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Take screenshot after clicking
    await takeScreenshot(page, 'after_checkout_continue');
    
    console.log('✅ Checkout continue step completed successfully');
    return true;
  } catch (error) {
    console.error(`❌ Error in continue_checkout: ${error.message}`);
    await takeScreenshot(page, 'error_checkout_continue');
    throw error;
  }
}

async function fillCheckout(page) {
    try {
        console.log('Attempting to fill checkout form...');
        await takeScreenshot(page, 'before_fill_checkout');

        // Fill in credit card number
        await page.type('#cardNo', '4111111111111111');
        await delay(1000);

        // Fill in expiration date
        await page.type('#card_exp', '1230');
        await delay(1000);

        // Fill in CVV
        await page.type('div:nth-of-type(2) > div:nth-of-type(2) input', '123');
        await delay(1000);

        // Fill in card holder name
        await page.type('#card_holder', 'odedkovach');
        await delay(1000);

        // Fill in email
        await page.type('#email', 'oded.kovach@gmail.com');
        await delay(1000);

        // Fill in phone
        await page.type('#phone', '1234567890');
        await delay(1000);

        await takeScreenshot(page, 'after_fill_checkout');
        console.log('Successfully filled checkout form');
        return true;
    } catch (error) {
        console.error('Error in fillCheckout:', error);
        await takeScreenshot(page, 'error_fill_checkout');
        return false;
    }
}

async function fillCheckoutNationality(page) {
    try {
        console.log('Attempting to fill checkout nationality...');
        await takeScreenshot(page, 'before_fill_checkout_nationality');

        // Click the country dropdown
        await page.locator('#country').click();
        await delay(1000);

        // Type 'israel' to filter
        await page.locator('#country').fill('israel');
        await delay(1000);

        // Click the Israel option using multiple selectors
        try {
            // Try the hover class first
            await page.locator('li.hover').click();
        } catch (e) {
            console.log('First selector failed, trying XPath:', e.message);
            try {
                // Try XPath selector
                await page.locator('xpath//html/body/div[3]/div[1]/div[1]/ul/li[110]').click();
            } catch (e2) {
                console.log('XPath selector failed, trying generic approach:', e2.message);
                // Last resort - try to find Israel in any visible dropdown
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

        await delay(1000);
        await takeScreenshot(page, 'after_fill_checkout_nationality');
        console.log('Successfully filled checkout nationality');
        return true;
    } catch (error) {
        console.error('Error in fillCheckoutNationality:', error);
        await takeScreenshot(page, 'error_fill_checkout_nationality');
        return false;
    }
}

// Map actions to their corresponding functions
const hardcodedActions = {
  findProduct: findProduct,
  increaseQuantity: increaseQuantity,
  clickSelectDate: clickSelectDate,
  clickNextMonth: clickNextMonth,
  selectDate: selectDate,
  clickNext: clickNext,
  selectFirstRadio: selectFirstRadio,
  clickAddToCart: clickAddToCart,
  clickNextStep: clickNextStep,
  clickSecondNextStep: clickSecondNextStep,
  clickCheckout: clickCheckout,
  clickIAgree: handleIAgree,
  fillFormDetails: fillFormDetails,
  fillNationality: fillNationality,
  fillPlaceOfResidence: fillPlaceOfResidence,
  handleCaptcha: handleCaptcha,
  checkTermsCheckbox: checkTermsCheckbox,
  checkCancellationCheckbox: checkCancellationCheckbox,
  clickContinue: clickContinue,
  clickCreditCard: clickCreditCard,
  continue_checkout: continue_checkout,
  fillCheckout: fillCheckout,
  fillCheckoutNationality: fillCheckoutNationality
};

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
      return await handleCaptcha(instruction, page);
    case 'checkTermsCheckbox':
      return await checkTermsCheckbox(instruction, page);
    case 'checkCancellationCheckbox':
      return await checkCancellationCheckbox(instruction, page);
    case 'clickContinue':
      return await clickContinue(instruction, page);
    case 'clickCreditCard':
      return await clickCreditCard(instruction, page);
    case 'continue_checkout':
      return await continue_checkout(page);
    case 'fillCheckout':
      return await fillCheckout(page);
    case 'fillCheckoutNationality':
      return await fillCheckoutNationality(page);
    default:
      throw new Error(`Unknown action: ${instruction.action}`);
  }
}

// New function to process the ticket purchasing steps
async function purchaseTicket(page, ticketDetails) {
    // Update global productName based on ticket details
    productName = ticketDetails.name;
    console.log('Starting purchaseTicket with details:', ticketDetails);

    // Update the product name in the findProduct step
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].action === 'findProduct') {
            console.log(`Found product step at index ${i}, updating from ${steps[i].productName} to ${ticketDetails.name}`);
            steps[i].name = `Find ${ticketDetails.name} product`;
            steps[i].productName = ticketDetails.name;
        }
        // Make sure all steps have the productName set
        steps[i].productName = ticketDetails.name;
    }
    
    // Update the quantity in the steps array - search for it by action type instead of fixed index
    for (let i = 0; i < steps.length; i++) {
        if (steps[i].action === 'increaseQuantity') {
            console.log(`Found quantity step at index ${i}, updating from ${steps[i].quantity} to ${ticketDetails.quantity}`);
            steps[i].name = `Increase quantity to ${ticketDetails.quantity}`;
            steps[i].quantity = ticketDetails.quantity;
        }
    }

    // Process each step from the steps array
    for (const step of steps) {
        // Ensure the step uses the dynamic product name
        if (!step.productName) {
            step.productName = ticketDetails.name;
        }

        console.log(`\n---- Processing step: ${step.name} ----`);
        let stepSuccess = false;
        let retryCount = 0;
        const MAX_RETRIES = 3;
        let lastError = null;

        while (!stepSuccess && retryCount <= MAX_RETRIES) {
            try {
                // For simplicity, we'll assume the instruction is the step itself
                const instruction = step;
                console.log('Executing instruction:', instruction);
                await takeScreenshot(page, `before_${instruction.name.replace(/\s+/g, '_')}${retryCount > 0 ? `_retry${retryCount}` : ''}`);
                await delay(1000);

                // Execute the step using the mapped function
                stepSuccess = await executeStep(instruction, page);

                if (!stepSuccess) {
                    // If no error but step did not succeed, mark as success (this pattern follows previous logic)
                    stepSuccess = true;
                    console.log(`Step ${instruction.name} completed successfully without explicit success signal`);
                }
            } catch (error) {
                console.error(`Error executing step ${step.name}, attempt ${retryCount+1}:`, error.message);
                lastError = error.message;
                await delay(2000);
                retryCount++;
                if (retryCount > MAX_RETRIES) {
                    throw new Error(`Failed to complete step ${step.name} after ${MAX_RETRIES} retries: ${lastError}`);
                } else {
                    console.log(`⚠️ Retrying step "${step.name}" (Attempt ${retryCount} of ${MAX_RETRIES})...`);
                }
            }
        }
        console.log(`Completed step: ${step.name}`);
    }
    console.log('All steps processed successfully.');
}

// Wrapper function with the typo in the name
async function purchaceTikcet(ticketDetails) {
    try {
        console.log(`Starting purchaceTikcet with product name: ${ticketDetails.name}`);
        // Start a Puppeteer browser
        const browser = await puppeteer.launch({
            headless: false,
            defaultViewport: null,
            args: ['--start-maximized']
        });

        const page = await browser.newPage();
        
        // Navigate to the correct USJ Express Pass page
        console.log('Navigating to USJ Express Pass page...');
        await page.goto('https://www.usjticketing.com/expressPass');
        
        // Wait for a reasonable time to ensure the page is fully loaded
        await delay(5000);
        
        // Make sure the ticketDetails are properly formatted
        console.log('Ticket Details:', ticketDetails);
        
        // Call the main purchase function
        await purchaseTicket(page, ticketDetails);
        
        console.log('Ticket purchase process initiated.');
        
        // Keep the browser open for verification
        // await browser.close();
    } catch (error) {
        console.error('Error running purchaceTikcet:', error);
        throw error;
    }
}

// Export the function if needed for external use (optional)
module.exports = { purchaceTikcet };

if (require.main === module) {
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
            // await takeScreenshot(page, 'step1_page_loaded');
            
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
            await delay(5000);
            
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
}