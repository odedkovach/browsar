const axios = require('axios');

async function testApiQuantity() {
  console.log('Starting API quantity test...');
  
  try {
    // Make direct API call to test quantity
    console.log('Sending request to API with quantity=3...');
    const response = await axios.post('http://localhost:3001/api/purchase', {
      name: 'Universal Express Pass 4: Fun Variety',
      quantity: 3,
      date: '2025-5-31'
    });
    
    console.log('API Response:', response.data);
    console.log('Job ID:', response.data.jobId);
    
    // Wait 5 seconds and then check the status
    console.log('Waiting 5 seconds before checking status...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check job status
    const statusResponse = await axios.get(`http://localhost:3001/api/purchase/${response.data.jobId}`);
    console.log('Job Status:', statusResponse.data.job.status);
    console.log('Job Logs:', statusResponse.data.job.logs);
    
  } catch (error) {
    console.error('Error testing API:', error.response ? error.response.data : error.message);
  }
}

// Run the test
testApiQuantity().then(() => {
  console.log('Test completed');
}); 