# USJ Ticket Purchase API

A REST API wrapper for automating ticket purchases on the Universal Studios Japan website using Puppeteer.

## Installation

1. Clone the repository
2. Install dependencies:

```bash
npm install
```

3. Create a `.env` file with your OpenAI API key:

```
OPENAI_API_KEY=your_api_key_here
```

## Usage

Start the API server:

```bash
node api.js
```

The server runs on port 3000 by default. You can change this by setting the `PORT` environment variable.

## API Endpoints

### Purchase Tickets

**Endpoint:** `POST /api/purchase`

**Request Body:**

```json
{
  "name": "Universal Express Pass 4: Fun Variety",
  "quantity": 2,
  "date": "2025-5-31"
}
```

| Parameter | Type   | Description                     |
|-----------|--------|---------------------------------|
| name      | string | The name of the ticket product  |
| quantity  | number | The number of tickets to purchase |
| date      | string | The date in YYYY-MM-DD format   |

**Response:**

```json
{
  "success": true,
  "message": "Purchase job initiated",
  "jobId": "job_1"
}
```

The API immediately returns a job ID and processes the purchase asynchronously.

### Check Job Status

**Endpoint:** `GET /api/purchase/:jobId`

**Response:**

```json
{
  "success": true,
  "job": {
    "id": "job_1",
    "status": "running",
    "startTime": "2023-04-04T21:37:55.827Z",
    "params": {
      "name": "Universal Express Pass 4: Fun Variety",
      "quantity": 2,
      "date": "2025-5-31"
    },
    "logs": [
      "Purchase job created",
      "Starting ticket purchase process"
    ],
    "error": null
  }
}
```

### List All Jobs

**Endpoint:** `GET /api/purchases`

**Response:**

```json
{
  "success": true,
  "count": 1,
  "jobs": [
    {
      "id": "job_1",
      "status": "completed",
      "startTime": "2023-04-04T21:37:55.827Z",
      "completionTime": "2023-04-04T21:45:10.414Z",
      "params": {
        "name": "Universal Express Pass 4: Fun Variety",
        "quantity": 2,
        "date": "2025-5-31"
      },
      "hasError": false
    }
  ]
}
```

## Job Status Values

- `initializing`: Job is being created
- `running`: The purchase process is currently running
- `completed`: The purchase process completed successfully
- `failed`: The purchase process failed (check the `error` field for details)

## Error Handling

The API returns appropriate HTTP status codes and error messages:

- `400 Bad Request`: Missing or invalid parameters
- `404 Not Found`: Job ID not found
- `500 Internal Server Error`: Server-side errors

## Examples

### Using cURL

```bash
# Purchase tickets
curl -X POST http://localhost:3000/api/purchase \
  -H "Content-Type: application/json" \
  -d '{"name":"Universal Express Pass 4: Fun Variety","quantity":2,"date":"2025-5-31"}'

# Check status
curl http://localhost:3000/api/purchase/job_1

# List all jobs
curl http://localhost:3000/api/purchases
```

### Using JavaScript (Fetch API)

```javascript
// Purchase tickets
fetch('http://localhost:3000/api/purchase', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'Universal Express Pass 4: Fun Variety',
    quantity: 2,
    date: '2025-5-31'
  })
})
.then(response => response.json())
.then(data => console.log(data));
``` 