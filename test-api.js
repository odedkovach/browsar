// Simple script to test the USJ Ticket Purchase API
const axios = require('axios');

// API configuration
const API_URL = 'http://localhost:3001';

// Test data
const testTicket = {
  name: 'Universal Express Pass 4: Fun Variety',
  quantity: 2,
  date: '2025-5-31'
};

// Function to purchase a ticket
async function purchaseTicket() {
  try {
    console.log('Sending purchase request...');
    console.log('Ticket details:', testTicket);
    
    const response = await axios.post(`${API_URL}/api/purchase`, testTicket);
    
    console.log('Response:', response.data);
    
    if (response.data.success && response.data.jobId) {
      // Poll for status updates
      await pollJobStatus(response.data.jobId);
    }
  } catch (error) {
    console.error('Error purchasing ticket:', error.response?.data || error.message);
  }
}

// Function to poll job status
async function pollJobStatus(jobId) {
  console.log(`\nStarting to poll status for job ${jobId}`);
  
  let isCompleted = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 60; // Poll for up to 5 minutes (5 seconds intervals)
  
  while (!isCompleted && attempts < MAX_ATTEMPTS) {
    attempts++;
    
    try {
      const response = await axios.get(`${API_URL}/api/purchase/${jobId}`);
      
      if (response.data.success) {
        const job = response.data.job;
        console.log(`\nJob Status (Poll #${attempts}):`);
        console.log(`- Status: ${job.status}`);
        console.log(`- Started: ${new Date(job.startTime).toLocaleTimeString()}`);
        
        if (job.completionTime) {
          console.log(`- Completed: ${new Date(job.completionTime).toLocaleTimeString()}`);
        }
        
        // Print the most recent log entry
        if (job.logs && job.logs.length > 0) {
          console.log(`- Latest log: ${job.logs[job.logs.length - 1]}`);
        }
        
        // Check if job is completed or failed
        if (job.status === 'completed' || job.status === 'failed') {
          isCompleted = true;
          
          if (job.status === 'completed') {
            console.log('\n✅ Purchase job completed successfully!');
          } else {
            console.log('\n❌ Purchase job failed:');
            console.log(job.error);
          }
        }
      }
    } catch (error) {
      console.error(`Error polling job status: ${error.message}`);
    }
    
    if (!isCompleted) {
      // Wait 5 seconds before next poll
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  
  if (!isCompleted) {
    console.log(`\nStopped polling after ${MAX_ATTEMPTS} attempts.`);
    console.log('Job is still running. You can check its status later using:');
    console.log(`curl http://localhost:3000/api/purchase/${jobId}`);
  }
}

// Run the test
purchaseTicket(); 