import { getDynamicModelList, getAvailableModels } from './src/services/ModelService.js';

async function test() {
  console.log('Testing getDynamicModelList...');
  const models = await getDynamicModelList();
  console.log('Model count:', models.length);
  console.log('First 5 models:', models.slice(0, 5));

  console.log('\nTesting getAvailableModels with fallback (for testing)...');
  const available = await getAvailableModels(undefined, true, true);
  console.log('Available models count:', available.length);
  console.log('First 5:', available.slice(0, 5).map(m => m.id));
}

test();