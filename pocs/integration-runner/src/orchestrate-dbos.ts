import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { DBOS, Error as DBOSErrors } from "@dbos-inc/dbos-sdk";
import pg from "pg";
import { createWindowLimiter, RunAlreadyActiveError, type Backend, type CoordinationStore, type RetryPolicy, type StepContext } from "./orchestrator.js";
import { runSync, budgetScope, type SyncInput } from "./sync-workflow.js";
import type { SourceResult } from "./result.js";

const QUEUE_NAME = "integration-runs";
const WORKFLOW_NAME = "integration-sync";

// The workflow takes a serializable input and rebuilds every resource inside,
// so ANY runner process sharing the system database can execute it (DBOS
// dequeues have no enqueuer affinity). Nothing is closed over.
let sharedCoordination: CoordinationStore | undefined;

async function integrationSync(input: SyncInput): Promise<SourceResult[]> {
  const scope = budgetScope(input);
  const limiter = scope && sharedCoordination
    ? createWindowLimiter(sharedCoordination, scope.scope, scope.opsPerSec)
    : undefined;
  return runSync(input, dbosCtx(input.retry), { limiter });
}

function dbosCtx(retry: RetryPolicy): StepContext {
  return {
    run(name, fn) {
      return DBOS.runStep(fn, {
        name,
        retriesAllowed: true,
        maxAttempts: retry.maxAttempts,
        intervalSeconds: retry.intervalSeconds,
        backoffRate: retry.backoffRate,
      });
    },
  };
}

export async function createDbosBackend(databaseUrl: string, maxConcurrentRuns?: number): Promise<Backend> {
  const workflow = DBOS.registerWorkflow(integrationSync, { name: WORKFLOW_NAME });

  DBOS.setConfig({
    name: "integration-runner",
    systemDatabaseUrl: databaseUrl,
    runAdminServer: false,
    // Every CLI process must have a distinct executor id: DBOS.launch() recovers
    // PENDING workflows by executor id, and the shared default ('local') makes a
    // second process steal a live first process's workflow at startup.
    executorID: `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`,
  });

  // Before launch: a dequeued/recovered workflow may execute immediately and
  // must find the shared budget in place, not run unthrottled.
  const coordination = await createPgCoordination(databaseUrl);
  sharedCoordination = coordination;

  await DBOS.launch();

  // DB-backed queues register post-launch (the SDK requires it); other worker
  // processes discover them dynamically from the system database.
  if (maxConcurrentRuns) {
    DBOS.registerQueue(QUEUE_NAME, { concurrency: maxConcurrentRuns });
  }

  return {
    coordination,

    async invoke(workflowId, input, admission) {
      try {
        const handle = await DBOS.startWorkflow(workflow, {
          workflowID: workflowId,
          ...(maxConcurrentRuns
            ? {
                queueName: QUEUE_NAME,
                enqueueOptions: admission ? { deduplicationID: admission.dedupKey } : {},
              }
            : {}),
        })(input);
        return await handle.getResult();
      } catch (err) {
        if (admission && err instanceof DBOSErrors.DBOSQueueDuplicatedError) {
          throw new RunAlreadyActiveError(admission.dedupKey);
        }
        throw err;
      }
    },

    async shutdown() {
      sharedCoordination = undefined;
      await coordination.close();
      await DBOS.shutdown();
    },
  };
}

/**
 * The DBOS backend's CoordinationStore: one row per scope in a namespaced table
 * in the DBOS system database, created idempotently at init (the same
 * ensure-on-boot pattern DBOS itself uses; no migration framework). The window
 * rolls and increments in ONE atomic UPDATE, so concurrent processes serialize
 * on the row lock. Exported for the cross-backend contract tests.
 */
export async function createPgCoordination(databaseUrl: string): Promise<CoordinationStore & { close(): Promise<void> }> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

  await pool.query(`CREATE SCHEMA IF NOT EXISTS integrations_coordination`);
  await pool.query(`CREATE TABLE IF NOT EXISTS integrations_coordination.write_budget (
    scope text PRIMARY KEY,
    window_start bigint NOT NULL,
    used bigint NOT NULL
  )`);

  return {
    async addToWindow(scope, windowStartMs, ops) {
      await pool.query(
        `INSERT INTO integrations_coordination.write_budget (scope, window_start, used)
         VALUES ($1, $2, 0) ON CONFLICT (scope) DO NOTHING`,
        [scope, windowStartMs],
      );

      const { rows } = await pool.query(
        `UPDATE integrations_coordination.write_budget
         SET used = CASE WHEN window_start = $2 THEN used + $3 ELSE $3 END,
             window_start = $2
         WHERE scope = $1
         RETURNING used`,
        [scope, windowStartMs, ops],
      );
      return Number(rows[0].used);
    },

    async close() {
      await pool.end();
    },
  };
}
