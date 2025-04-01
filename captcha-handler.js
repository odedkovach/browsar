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

// Helper function to take screenshots with timestamp (used for full page shots)
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
    
    // Get verification text from the highlighted image using GPT-4o
    const verificationText = await getVerificationText(page);
    if (!verificationText) {
      console.error('❌ Could not get verification text');
      return false;
    }
    
    console.log(`Text detected: ${verificationText}`);
    
    // Fill in the verification text (using an example selector based on form HTML)
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
  console.log('Getting verification text from image...');
  
  try {
    // Get the verification image details
    const verificationImg = await page.evaluate(() => {
      // Try multiple selectors for the verification image
      const imgSelectors = [
        'img[data-v-6aff2c22]', 
        'img.captcha-image', 
        'div.captcha-container img', 
        'div[class*="captcha"] img'
      ];
      
      // Try each selector until we find the image
      for (const imgSel of imgSelectors) {
        const img = document.querySelector(imgSel);
        if (img) {
          return {
            src: img.src,
            width: img.width,
            height: img.height,
            alt: img.alt,
            className: img.className,
            selector: imgSel
          };
        }
      }
      return null;
    });

    if (!verificationImg) {
      throw new Error('Could not find verification image');
    }

    console.log('Found verification image:', verificationImg);

    // Save the image to a file
    const verificationDir = path.join(__dirname, 'verification_images');
    if (!fs.existsSync(verificationDir)) {
      fs.mkdirSync(verificationDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const imagePath = path.join(verificationDir, `verification_${timestamp}.png`);
    
    // Take screenshot of just the verification image
    const imageElement = await page.$(verificationImg.selector);
    if (!imageElement) {
      throw new Error('Could not find image element for screenshot');
    }

    // Get the bounding box of the image
    const box = await imageElement.boundingBox();
    if (!box) {
      throw new Error('Could not get image bounding box');
    }

    console.log('Image bounding box:', box);

    // Take a screenshot of just the image area
    await page.screenshot({
      path: imagePath,
      clip: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      }
    });

    console.log(`Saved verification image to: ${imagePath}`);
    console.log('Image dimensions:', {
      width: box.width,
      height: box.height,
      x: box.x,
      y: box.y
    });

    // Send the image to GPT-4o for text extraction
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract the text from this verification image. Return ONLY the text - 6 digits or letters, nothing else. Be precise and include all characters. The text should be exactly 6 characters long."
            },
            reasoning={
              "effort": "high"
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${fs.readFileSync(imagePath, 'base64')}`
              }
            }
          ]
        }
      ],
      max_tokens: 10
    });

    const extractedText = response.choices[0].message.content.trim();
    console.log('Extracted text:', extractedText);
    console.log('Text length:', extractedText.length);
    
    return extractedText;
  } catch (error) {
    console.error('Error in getVerificationText:', error);
    throw error;
  }
}

module.exports = {
  handleCaptchaVerification,
  getVerificationText,
  takeScreenshot,
  highlightElement,
  delay
};
