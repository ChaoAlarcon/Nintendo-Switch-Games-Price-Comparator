async function resolveUsNsuid(applicationId) {
  try {
    const url = `https://ec.nintendo.com/apps/${applicationId}/US`;
    console.log(`Resolving US NSUID for Title ID ${applicationId} via: ${url}`);
    const res = await fetch(url, { redirect: 'manual' });
    const location = res.headers.get('location');
    console.log('Location:', location);
    if (location) {
      const nsuidMatch = location.match(/(700\d{11})/);
      if (nsuidMatch) {
        return nsuidMatch[1];
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
  return null;
}

async function test() {
  // Zelda BotW Title ID: 01007ef00011e000
  // Mario Odyssey Title ID: 0100000000010000
  const botwUs = await resolveUsNsuid('01007ef00011e000');
  console.log('Zelda BotW US NSUID:', botwUs);
  
  const odysseyUs = await resolveUsNsuid('0100000000010000');
  console.log('Mario Odyssey US NSUID:', odysseyUs);
}

test();
