import { Queue, Worker, Job, QueueEvents } from 'bullmq';

export interface JobData {
  type: string;
  payload: any;
  priority?: number;
  delay?: number;
}

export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class QueueService {
  private queues: Map<string, Queue> = new Map();
  private workers: Map<string, Worker> = new Map();
  private queueEvents: Map<string, QueueEvents> = new Map();
  private connected: boolean = false;
  private redisUrl: string = '';

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      console.warn('[Queue] No REDIS_URL configured, running without job queue...');
      return;
    }

    this.redisUrl = redisUrl;
    this.connected = true;
    console.log('[Queue] Redis URL configured');
  }

  private getQueue(name: string): Queue {
    if (!this.queues.has(name)) {
      const queue = new Queue(name, {
        connection: {
          url: this.redisUrl,
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: {
          removeOnComplete: 100,
          removeOnFail: 50,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
        },
      });
      this.queues.set(name, queue);
    }
    return this.queues.get(name)!;
  }

  async addJob(queueName: string, jobData: JobData): Promise<Job | null> {
    if (!this.connected || !this.redisUrl) {
      console.warn('[Queue] Not connected, job skipped');
      return null;
    }

    try {
      const queue = this.getQueue(queueName);
      const job = await queue.add(jobData.type, jobData.payload, {
        priority: jobData.priority,
        delay: jobData.delay,
      });
      console.log(`[Queue] Job ${job.id} added to ${queueName}`);
      return job;
    } catch (err: any) {
      console.error(`[Queue] Failed to add job:`, err.message);
      return null;
    }
  }

  registerWorker(
    queueName: string,
    processor: (job: Job) => Promise<JobResult>
  ): void {
    if (!this.connected || !this.redisUrl) {
      console.warn('[Queue] Not connected, worker not registered');
      return;
    }

    const worker = new Worker(
      queueName,
      async (job: Job) => {
        try {
          console.log(`[Queue] Processing job ${job.id} in ${queueName}`);
          const result = await processor(job);
          console.log(`[Queue] Job ${job.id} completed`);
          return result;
        } catch (err: any) {
          console.error(`[Queue] Job ${job.id} failed:`, err.message);
          throw err;
        }
      },
      {
        connection: {
          url: this.redisUrl,
          maxRetriesPerRequest: null,
        },
        concurrency: 5,
      }
    );

    worker.on('failed', (job, err) => {
      console.error(`[Queue] Job ${job?.id} failed:`, err.message);
    });

    worker.on('completed', (job, result) => {
      console.log(`[Queue] Job ${job.id} completed with result:`, result);
    });

    this.workers.set(queueName, worker);

    // Setup queue events
    const queueEvents = new QueueEvents(queueName, {
      connection: {
        url: this.redisUrl,
        maxRetriesPerRequest: null,
      },
    });
    this.queueEvents.set(queueName, queueEvents);

    console.log(`[Queue] Worker registered for ${queueName}`);
  }

  async getJobCounts(queueName: string): Promise<{ waiting: number; active: number; completed: number; failed: number } | null> {
    if (!this.connected) return null;

    try {
      const queue = this.getQueue(queueName);
      const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
      return {
        waiting: counts.waiting || 0,
        active: counts.active || 0,
        completed: counts.completed || 0,
        failed: counts.failed || 0,
      };
    } catch {
      return null;
    }
  }

  async getQueueStats(): Promise<Map<string, { waiting: number; active: number; completed: number; failed: number }>> {
    const stats = new Map<string, { waiting: number; active: number; completed: number; failed: number }>();

    for (const [name, queue] of this.queues) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
        stats.set(name, {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
        });
      } catch {
        // Ignore errors
      }
    }

    return stats;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    for (const worker of this.workers.values()) {
      await worker.close();
    }
    this.workers.clear();

    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();

    for (const queueEvents of this.queueEvents.values()) {
      await queueEvents.close();
    }
    this.queueEvents.clear();

    console.log('[Queue] Disconnected');
  }
}
