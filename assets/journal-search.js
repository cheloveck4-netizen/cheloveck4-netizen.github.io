(async () => {
  const query = new URLSearchParams(location.search).get('q') || '';
  document.getElementById('q').value = query;
  if (!query.trim()) return;
  const status = document.getElementById('status');
  const out = document.getElementById('results');
  const normalize = value => value.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  const words = normalize(query).trim().split(/\s+/);
  try {
    const response = await fetch('/assets/journal-index.json');
    if (!response.ok) throw Error();
    const rows = (await response.json()).filter(row => {
      const searchable = normalize([row.title, row.summary, row.category, ...(row.tags || [])].join(' '));
      return words.every(word => searchable.includes(word));
    });
    status.textContent = 'Найдено: ' + rows.length;
    for (const row of rows) {
      const link = document.createElement('a');
      link.className = 'card card-type';
      link.href = row.path;
      const content = document.createElement('div');
      content.className = 'cardtext';
      const category = document.createElement('p');
      category.className = 'story-meta';
      category.textContent = row.category;
      const title = document.createElement('h2');
      title.textContent = row.title;
      const summary = document.createElement('p');
      summary.className = 'card-summary';
      summary.textContent = row.summary;
      content.append(category, title, summary);
      link.append(content);
      out.append(link);
    }
  } catch {
    status.textContent = 'Поиск недоступен. Откройте все статьи.';
  }
})();
