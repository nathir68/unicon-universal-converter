import { convertFile } from './src/lib/converter.js';
import fs from 'fs';
import path from 'path';

// Note: Because we are testing ES modules with TS, we need to use ts-node or just test via curl to the API
// Let's actually test via curl to the running API, it's safer.
