// Fixtures for `semgrep test .semgrep` (CI): every annotated line below must (ruleid) or must not (ok) match.
// This folder is excluded from normal scans.
/* eslint-disable */

// ruleid: mc-no-dangerously-set-inner-html
const a = <div dangerouslySetInnerHTML={{ __html: input }} />;
// ok: mc-no-dangerously-set-inner-html
const b = <div>{input}</div>;

// ruleid: mc-no-server-side-js-operators
const c = { "$where": "this.a > 1" };
// ruleid: mc-no-server-side-js-operators
const e = { $function: { body: 'x' } };
// ok: mc-no-server-side-js-operators
const d = { "$eq": 1 };

// ruleid: mc-mongodb-only-in-db
import { MongoClient } from 'mongodb';

// ruleid: mc-system-scope-only-in-jobs
systemScope();

// ruleid: mc-hook-scope-only-in-hooks
hookScope('x');

import * as dbModule from '@mc/db';
// ruleid: mc-system-scope-only-in-jobs
const viaNamespace = dbModule.systemScope;
// ruleid: mc-hook-scope-only-in-hooks
const viaDynamic = (await import('@mc/db')).hookScope;
// ruleid: mc-system-scope-only-in-jobs
const { systemScope: renamed } = await import('@mc/db');
// ruleid: mc-hook-scope-only-in-hooks
const viaRequire = require('@mc/db').hookScope;
// ok: mc-system-scope-only-in-jobs
const options = { systemScope: true };

// ruleid: mc-routes-only-via-define-route
router.get('/masjids', handler);
// ok: mc-routes-only-via-define-route
map.get('key');

// ruleid: mc-express-created-only-by-the-app-factory
const server = express();
// ruleid: mc-express-created-only-by-the-app-factory
const routes = express.Router();
// ok: mc-express-created-only-by-the-app-factory
const cache = new Map();

// ruleid: mc-no-console-log
console.log('debug');
// ok: mc-no-console-log
logger.info('fine');
