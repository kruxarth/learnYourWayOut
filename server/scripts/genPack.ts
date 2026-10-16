/** CLI: `npm run gen-pack -- "Roman Empire" normal` writes the pack JSON to stdout. Needs a real key in server/.env. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDomainPack } from '../../src/content/validate';
import type { Difficulty } from '../../src/game/types';
import { loadEnvFile, readEnv } from '../env';
import { OpenAiCompatClient } from '../llm/client';
import { generatePack } from '../llm/pipeline';

loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));
const env = readEnv();
const [topic, levelArg = 'normal'] = process.argv.slice(2);
if (!topic || !['easy', 'normal', 'hard'].includes(levelArg)) {
  console.error('Usage: npm run gen-pack -- "<topic>" [easy|normal|hard]');
  process.exit(2);
}
if (!env.llmEnabled) {
  console.error('No LLM_API_KEY. Copy server/.env.example to server/.env and fill it in.');
  process.exit(2);
}

const llm = new OpenAiCompatClient({ baseUrl: env.llmBaseUrl, apiKey: env.llmApiKey, model: env.llmModel });
try {
  const pack = await generatePack(topic, levelArg as Difficulty, llm, (stage, p) => console.error(`[${stage}] ${Math.round(p * 100)}%`), {
    model: env.llmModel, reviewModel: env.reviewModel,
  });
  const errs = validateDomainPack(pack);
  if (errs.length) { console.error('Pack failed validation:\n' + errs.join('\n')); process.exit(1); }
  console.log(JSON.stringify(pack, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
