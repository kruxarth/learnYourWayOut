/** CLI: `npm run gen-pack -- "Roman Empire" normal` writes the pack JSON to stdout. Needs a real key in server/.env. */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDomainPack } from '../../src/content/validate';
import type { Difficulty } from '../../src/game/types';
import { loadEnvFile, readEnv } from '../env';
import { buildLlm } from '../llm/client';
import { generatePack } from '../llm/pipeline';

loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '.env'));
loadEnvFile(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env')); // root .env: GROQ_API, OPENROUTER_KEY
const env = readEnv();
const [topic, levelArg = 'normal'] = process.argv.slice(2);
if (!topic || !['easy', 'normal', 'hard'].includes(levelArg)) {
  console.error('Usage: npm run gen-pack -- "<topic>" [easy|normal|hard]');
  process.exit(2);
}
if (!env.llmEnabled) {
  console.error('No key. Set GROQ_API or OPENROUTER_KEY in .env (see .env.example) or LLM_API_KEY in server/.env.');
  process.exit(2);
}

const llm = buildLlm(env, (model, e) => console.error(`[${model} failed: ${e.message}]`));
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
