POST /api/scenario/start
{
name: string,
seed: string,
startDate: string (ISO),
batchSize: number,
intervalMs: number,
regions?: string[],
durationMinutes?: number
}
-> { scenarioId, status }

POST /api/scenario/stop
{
scenarioId: string
}
-> { scenarioId, status, stats }

GET /api/scenario/:id/status
-> scenario object

GET /api/scenario/:id/events?limit=100
-> [event, ...]
