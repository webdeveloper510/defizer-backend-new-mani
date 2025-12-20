const { OpenAI } = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

(async () => {
  try {
    const models = await openai.models.list();
    const ids = models.data.map(m => m.id);
    console.log('Models available to your account:');
    console.log(ids);
  } catch (err) {
    console.error('Error fetching models:', err?.message || err);
  }
})();
