import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { checkLoginPage } from './lib/scraper';

(async () => {
  console.log('Starting login-page debug...');
  try {
    const result = await checkLoginPage({ prefillCredentials: true });
    console.log('\n--- Login Page Check Result ---');
    console.log(JSON.stringify(result, null, 2));
    console.log('--------------------------------\n');
  } catch (error) {
    console.error('\n--- An error occurred ---');
    console.error(error);
    console.log('--------------------------\n');
  } finally {
    console.log('Login-page debug finished.');
  }
})();


