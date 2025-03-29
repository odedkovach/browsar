const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

// Configure the OpenAI client using your API key from environment variables
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Create screenshots directory if it doesn't exist
const screenshotsDir = path.join(__dirname, 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

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
    
    // Add a highlight by setting a red border and a slight background tint
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

async function handleCaptchaVerification(page) {
  console.log('Starting captcha verification process...');
  
  try {
    // Wait for the verification image to be visible
    console.log('Waiting for verification image to be visible...');
    await page.waitForSelector('img[src*="captcha"], img[src*="verification"]', { timeout: 10000 });
    
    // Take screenshot of the verification image
    // await takeScreenshot(page, 'verification_image');
    
    // Get the verification text using OpenAI
    const verificationText = await getVerificationText(page);
    console.log('Verification text:', verificationText);
    
    // Enter the verification code
    const codeEntered = await page.evaluate((code) => {
      const input = document.querySelector('input[type="text"].el-input__inner[maxlength="6"]');
      if (!input) return { success: false, reason: 'Verification code input not found' };
      
      input.value = '';
      input.value = code;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      
      input.style.border = '3px solid green';
      input.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
      
      return { success: true };
    }, verificationText);
    
    if (!codeEntered.success) {
      throw new Error(`Failed to enter verification code: ${codeEntered.reason}`);
    }
    
    console.log(`✅ Entered verification code: ${verificationText}`);
    await delay(500);
    
    // await takeScreenshot(page, 'verification_code_entered');
    return true;
  } catch (error) {
    console.error(`Error in handleCaptchaVerification: ${error.message}`);
    // await takeScreenshot(page, 'error_verification');
    throw error;
  }
}

async function getVerificationText(page) {
  try {
    // Instead of taking a full page screenshot, capture only the highlighted verification image.
    // Use the same selectors to find the verification image element.
    const imgSelectors = [
      'img[data-v-6aff2c22]', 
      'img.captcha-image', 
      'div.captcha-container img', 
      'div[class*="captcha"] img'
    ];
    
    let verificationImg = null;
    for (const imgSel of imgSelectors) {
      verificationImg = await page.$(imgSel);
      if (verificationImg) {
        break;
      }
    }
    
    if (!verificationImg) {
      console.error('❌ Could not find verification image for screenshot');
      return null;
    }
    
    // Capture a screenshot of only the verification image element
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const filename = `text_verification_${timestamp}.png`;
    const filepath = path.join(screenshotsDir, filename);
    await verificationImg.screenshot({ path: filepath });
    console.log(`Screenshot of highlighted image saved: ${filename}`);
    
    // Read the image file and convert to base64
    const imageBuffer = fs.readFileSync(filepath);
    const base64Image = imageBuffer.toString('base64');
    
    // Create a prompt that explicitly asks for just the text within the red rectangle
    const prompt = "Return ONLY the letters and numbers you see in the red rectangle. Do not add any other text or phrases like 'The text is'";
    
    console.log(`Sending request to OpenAI with prompt: "${prompt}"`);
    
    // Send the highlighted image to GPT-4o for analysis
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

module.exports = {
  handleCaptchaVerification,
  getVerificationText,
  takeScreenshot,
  highlightElement,
  delay
};
