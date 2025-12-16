const OPENAI_API_KEY = process.env.OPENAI_API_KEY; // or your key string

async function callOpenAI(messages) {

    
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-5-chat-latest', // or gpt-5.1, gpt-5.1-pro, etc.
      messages
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
module.exports = {
  callOpenAI
};