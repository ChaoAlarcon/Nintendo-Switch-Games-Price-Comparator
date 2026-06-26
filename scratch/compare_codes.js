async function searchEu(query) {
  const url = `https://search.nintendo-europe.com/en/select?q=${encodeURIComponent(query)}&fq=type:GAME%20AND%20system_type:nintendoswitch*&wt=json&rows=5`;
  const res = await fetch(url);
  const json = await res.json();
  return (json.response && json.response.docs) || [];
}

async function loadJpGames() {
  const url = 'https://www.nintendo.co.jp/data/software/xml/switch.xml';
  const res = await fetch(url);
  const xml = await res.text();
  
  const parsedGames = [];
  const regex = /<TitleInfo>([\s\S]*?)<\/TitleInfo>/g;
  let match;
  
  while ((match = regex.exec(xml)) !== null) {
    const content = match[1];
    const initialCode = (content.match(/<InitialCode>(.*?)<\/InitialCode>/) || [])[1] || '';
    const titleName = (content.match(/<TitleName>(.*?)<\/TitleName>/) || [])[1] || '';
    const linkURL = (content.match(/<LinkURL>(.*?)<\/LinkURL>/) || [])[1] || '';
    parsedGames.push({
      initialCode: initialCode.trim(),
      titleName: titleName.trim(),
      linkURL: linkURL.trim()
    });
  }
  return parsedGames;
}

async function test() {
  const jpGames = await loadJpGames();
  console.log('Loaded', jpGames.length, 'JP games.');

  const testQueries = ['Zelda Breath of the Wild', 'Xenoblade Chronicles', 'Mario Odyssey', 'Hyrule Warriors', 'Everhood', 'Animal Crossing'];
  
  for (const q of testQueries) {
    console.log(`\n--- Query: "${q}" ---`);
    const euDocs = await searchEu(q);
    for (const doc of euDocs) {
      const euCode = doc.product_code_txt ? doc.product_code_txt[0] : null;
      console.log(`  EU Title: "${doc.title}"`);
      console.log(`  EU Code:  ${euCode}`);
      console.log(`  EU AppID: ${doc.application_id_s}`);
      
      // Let's try to find it in JP by title or code
      // We'll search JP by looking for similar words in title
      const cleanTitle = doc.title.toLowerCase().replace(/[^a-z0-9]/g, ' ');
      const words = cleanTitle.split(' ').filter(w => w.length > 4);
      
      let jpMatch = null;
      if (words.length > 0) {
        jpMatch = jpGames.find(jg => {
          const jgTitle = jg.titleName.toLowerCase();
          return words.every(w => jgTitle.includes(w)) || jg.titleName.includes(doc.title);
        });
      }
      if (jpMatch) {
        console.log(`  JP Match: "${jpMatch.titleName}"`);
        console.log(`  JP Code:  ${jpMatch.initialCode}`);
      } else {
        console.log(`  JP Match: NOT FOUND BY TITLE`);
      }
    }
  }
}

test();
