const express = require('express');
const { purchaceTikcet } = require('./index3');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware for parsing JSON bodies
app.use(express.json());

// Create a store for tracking active purchases
const purchaseJobs = new Map();
let nextJobId = 1;

// Helper function to generate unique job IDs
function generateJobId() {
  return `job_${nextJobId++}`;
}

/**
 * API endpoint to initiate ticket purchase
 * 
 * Expected request body:
 * {
 *   "name": "Universal Express Pass 4: Fun Variety",
 *   "quantity": 2,
 *   "date": "2025-5-31"
 * }
 */
app.post('/api/purchase', async (req, res) => {
  try {
    // Validate request body
    const { name, quantity, date } = req.body;
    
    if (!name || !quantity || !date) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters. Please provide name, quantity and date.'
      });
    }
    
    // Validate quantity is a number
    if (typeof quantity !== 'number' || quantity < 1) {
      return res.status(400).json({
        success: false,
        error: 'Quantity must be a positive number.'
      });
    }
    
    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Date must be in format YYYY-MM-DD.'
      });
    }
    
    // Create job to track this purchase
    const jobId = generateJobId();
    const jobDetails = {
      id: jobId,
      status: 'initializing',
      startTime: new Date(),
      params: { name, quantity, date },
      logs: ['Purchase job created'],
      error: null
    };
    
    // Store job in the tracking map
    purchaseJobs.set(jobId, jobDetails);
    
    // Send immediate response with job ID
    res.status(202).json({
      success: true,
      message: 'Purchase job initiated',
      jobId: jobId
    });
    
    // Start the purchase process asynchronously
    process.nextTick(async () => {
      try {
        // Update job status
        jobDetails.status = 'running';
        jobDetails.logs.push('Starting ticket purchase process');
        
        // Call the purchase function
        await purchaceTikcet({
          name,
          quantity,
          date
        });
        
        // Update job status on success
        jobDetails.status = 'completed';
        jobDetails.completionTime = new Date();
        jobDetails.logs.push('Purchase process completed successfully');
      } catch (error) {
        // Update job status on error
        jobDetails.status = 'failed';
        jobDetails.error = error.message;
        jobDetails.logs.push(`Error: ${error.message}`);
        console.error(`Purchase job ${jobId} failed:`, error);
      }
    });
    
  } catch (error) {
    console.error('Error processing purchase request:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

/**
 * API endpoint to get purchase job status
 */
app.get('/api/purchase/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  if (!purchaseJobs.has(jobId)) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  const job = purchaseJobs.get(jobId);
  
  // Return job status but limit log size
  return res.json({
    success: true,
    job: {
      id: job.id,
      status: job.status,
      startTime: job.startTime,
      completionTime: job.completionTime,
      params: job.params,
      // Return only the latest 10 log entries to keep the response size manageable
      logs: job.logs.slice(-10),
      error: job.error
    }
  });
});

/**
 * API endpoint to list all purchase jobs
 */
app.get('/api/purchases', (req, res) => {
  // Convert the map to an array of jobs with limited information
  const jobs = Array.from(purchaseJobs.values()).map(job => ({
    id: job.id,
    status: job.status,
    startTime: job.startTime,
    completionTime: job.completionTime,
    params: job.params,
    hasError: !!job.error
  }));
  
  return res.json({
    success: true,
    count: jobs.length,
    jobs
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`USJ Ticket Purchase API running on port ${PORT}`);
  console.log(`Purchase endpoint: http://localhost:${PORT}/api/purchase`);
  console.log(`Job status endpoint: http://localhost:${PORT}/api/purchase/:jobId`);
  console.log(`List all jobs: http://localhost:${PORT}/api/purchases`);
});

module.exports = app; // Export for testing 