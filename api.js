const express = require('express');
const { purchaceTikcet } = require('./index3');
const cors = require('cors');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3001;

// Setup middleware
app.use(express.json());
app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  if (req.method === 'POST') {
    console.log('Request body:', JSON.stringify(req.body));
  }
  next();
});

// Job tracking system
const jobs = new Map();
let nextJobId = 1;

// Generate unique job ID
function generateJobId() {
  return `job_${nextJobId++}`;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Start a ticket purchase job
app.post('/api/purchase', async (req, res) => {
  try {
    // Extract and validate request parameters
    let { name, quantity, date } = req.body;

    // Validate parameters
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Missing product name. Please provide a product name.'
      });
    }

    // Ensure quantity is a number
    quantity = Number(quantity) || 1;
    
    // Validate date format (YYYY-MM-DD)
    if (!date || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Please provide date in YYYY-MM-DD format.'
      });
    }

    // Create a new job
    const jobId = generateJobId();
    const job = {
      id: jobId,
      status: 'queued',
      createdAt: new Date(),
      updatedAt: new Date(),
      params: { 
        name: String(name),
        quantity: Number(quantity),
        date: String(date)
      },
      logs: ['Job created and queued'],
      error: null
    };

    // Save the job
    jobs.set(jobId, job);

    // Return the job ID immediately
    res.status(202).json({
      success: true,
      message: 'Purchase job queued successfully',
      jobId: jobId
    });

    // Start the ticket purchase process asynchronously
    setTimeout(async () => {
      try {
        // Update job status
        job.status = 'running';
        job.updatedAt = new Date();
        job.logs.push('Starting ticket purchase process');

        // Log the parameters
        console.log(`Starting job ${jobId} with parameters:`, job.params);

        // Execute the purchase function with typed parameters
        const result = await purchaceTikcet({
          name: String(name),
          quantity: Number(quantity),
          date: String(date)
        });

        // Update job status on completion
        job.status = 'completed';
        job.updatedAt = new Date();
        job.completedAt = new Date();
        job.logs.push('Purchase process completed successfully');
        job.result = result;

        console.log(`Job ${jobId} completed successfully`);
      } catch (error) {
        // Update job status on failure
        job.status = 'failed';
        job.updatedAt = new Date();
        job.error = error.message;
        job.logs.push(`Error: ${error.message}`);

        console.error(`Job ${jobId} failed:`, error);
      }
    }, 0);

  } catch (error) {
    console.error('Error processing purchase request:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// Get job status
app.get('/api/purchase/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  if (!jobs.has(jobId)) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  const job = jobs.get(jobId);
  
  return res.json({
    success: true,
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      params: job.params,
      logs: job.logs.slice(-20), // Return the last 20 log entries
      error: job.error,
      result: job.result
    }
  });
});

// List all jobs
app.get('/api/purchases', (req, res) => {
  // Convert jobs map to array with summarized data
  const jobList = Array.from(jobs.values()).map(job => ({
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    params: job.params,
    hasError: !!job.error
  }));
  
  return res.json({
    success: true,
    count: jobList.length,
    jobs: jobList
  });
});

// Delete a job
app.delete('/api/purchase/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  if (!jobs.has(jobId)) {
    return res.status(404).json({
      success: false,
      error: 'Job not found'
    });
  }
  
  jobs.delete(jobId);
  
  return res.json({
    success: true,
    message: `Job ${jobId} deleted successfully`
  });
});

// Clear completed and failed jobs
app.delete('/api/purchases/cleanup', (req, res) => {
  let deletedCount = 0;
  
  for (const [jobId, job] of jobs.entries()) {
    if (job.status === 'completed' || job.status === 'failed') {
      jobs.delete(jobId);
      deletedCount++;
    }
  }
  
  return res.json({
    success: true,
    message: `Cleaned up ${deletedCount} completed/failed jobs`
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`USJ Ticket Purchase API running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`- Health check: http://localhost:${PORT}/api/health`);
  console.log(`- Purchase endpoint: http://localhost:${PORT}/api/purchase`);
  console.log(`- Job status: http://localhost:${PORT}/api/purchase/:jobId`);
  console.log(`- List all jobs: http://localhost:${PORT}/api/purchases`);
  console.log(`- Delete job: DELETE http://localhost:${PORT}/api/purchase/:jobId`);
  console.log(`- Cleanup: DELETE http://localhost:${PORT}/api/purchases/cleanup`);
});

module.exports = app; 