async function test() {
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
    
    parsedGames.push({
      initialCode: initialCode.trim(),
      titleName: titleName.trim()
    });
  }

  // Count by length
  const lengths = {};
  parsedGames.forEach(g => {
    const len = g.initialCode.length;
    lengths[len] = (lengths[len] || 0) + 1;
  });
  console.log('Lengths distribution:', lengths);

  // Show some examples of length 8 starting with HAC
  console.log('\nExamples of length 8 starting with HAC:');
  console.log(parsedGames.filter(g => g.initialCode.length === 8 && g.initialCode.startsWith('HAC')).slice(0, 10));

  // Show some examples of length 9
  console.log('\nExamples of length 9:');
  console.log(parsedGames.filter(g => g.initialCode.length === 9).slice(0, 10));

  // Show some examples of other lengths
  console.log('\nExamples of other lengths:');
  console.log(parsedGames.filter(g => g.initialCode.length !== 8 && g.initialCode.length !== 9).slice(0, 10));
}

test();
