// Shop-wide choices are edited by staff, including choices that no listing uses yet.
window.LemrixTaxonomy = (() => {
  const fields = {
    category: ['category', 60, ['Singles', 'Packs', 'Accessories']],
    set: ['set', 120],
    series: ['era / series', 100],
    grader: ['grading company', 24, ['PSA', 'CGC', 'BGS', 'ARK']],
    language: ['language', 40, ['English', 'Japanese', 'Korean', 'Chinese', 'Other']],
    itemCondition: ['item condition', 80, ['Near mint', 'Lightly played', 'Moderately played', 'Heavily played', 'Damaged', 'Sealed']]
  };
  const normalize = value => value.normalize('NFKC').trim().toLowerCase();
  const addOption = '__lemrix_add_choice__';
  let stored = {}, loading, loaded = false, source, previous, dialogVersion = 0;
  const dialog = document.getElementById('add-choice');
  const form = dialog.querySelector('form');
  const input = form.elements.choice;
  const status = form.querySelector('[role="status"]');
  const save = form.querySelector('[type="submit"]');
  function choices(field, current) {
    const directory = window.LemrixSets || [];
    let defaults = fields[field][2] || [];
    if (field === 'set') defaults = directory.map(set => set.name);
    if (field === 'series') defaults = directory.map(set => set.series);
    const fromListings = products.map(item => field === 'category' ? item.category : item.card?.[field]);
    const options = new Map();
    for (const value of [...defaults, ...fromListings, ...(stored[field] || []), current]) {
      if (value && value !== addOption && !options.has(normalize(value))) options.set(normalize(value), value);
    }
    return options;
  }
  function fill(select, field, current) {
    const options = choices(field, current);
    const values = [...options.values()];
    const placeholder = field === 'category' ? [] : [new Option('Choose ' + fields[field][0], '')];
    select.replaceChildren(...placeholder, ...values.map(value => new Option(value, value)), new Option('+ Add ' + fields[field][0], addOption));
    select.value = options.get(normalize(current || '')) || (field === 'category' ? 'Singles' : '');
    select.dataset.choiceValue = select.value;
  }
  function selectValue(select, value) {
    if (!select.dataset.taxonomy) return;
    fill(select, select.dataset.taxonomy, value);
  }
  function refresh() {
    for (const select of document.querySelectorAll('select[data-taxonomy]')) {
      fill(select, select.dataset.taxonomy, select.value);
    }
  }
  function load() {
    if (loaded || loading) return;
    loading = fetch('/api/taxonomy', {credentials:'same-origin', cache:'no-store'})
      .then(async response => {
        if (!response.ok) return;
        const options = await response.json();
        // An add request can finish while this earlier read is in flight.
        if (!loaded) { stored = options; loaded = true; refresh(); }
      }).catch(() => {}).finally(() => { loading = null; });
  }
  function attach(select, field, current) {
    if (!Object.hasOwn(fields, field)) return;
    fill(select, field, current);
    if (!select.dataset.taxonomy) {
      select.dataset.taxonomy = field;
      select.addEventListener('input', event => {
        if (select.value === addOption) event.stopImmediatePropagation();
      }, true);
      select.addEventListener('change', event => {
        if (select.value !== addOption) { select.dataset.choiceValue = select.value; return; }
        event.stopImmediatePropagation();
        dialogVersion++;
        previous = select.dataset.choiceValue;
        select.value = previous;
        source = select;
        const [label, max] = fields[field];
        dialog.querySelector('h2').textContent = 'Add ' + label;
        input.maxLength = max;
        input.value = ''; input.setCustomValidity('');
        status.textContent = ''; save.disabled = false;
        dialog.showModal(); input.focus();
      }, true);
    }
    load();
  }
  // The select restores its previous value before the modal opens, including on Escape.
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { if (!dialog.open) { source?.focus(); source = null; } });
  input.oninput = () => input.setCustomValidity('');
  form.onsubmit = async event => {
    event.preventDefault();
    const select = source, version = dialogVersion;
    if (!select || save.disabled) return;
    const field = select.dataset.taxonomy, value = input.value.trim();
    if (!value) { input.setCustomValidity('Enter a name.'); input.reportValidity(); return; }
    // Reuse existing spelling for a choice that already exists, including seeded choices.
    let canonical = choices(field, previous).get(normalize(value));
    if (!canonical) {
      status.textContent = 'Saving…'; save.disabled = true;
      try {
        const response = await fetch('/api/taxonomy', {
          method:'POST', credentials:'same-origin', headers:{'Content-Type':'application/json'}, body:JSON.stringify({field, value})
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not save this choice.');
        stored = data; loaded = true; refresh();
        canonical = choices(field, previous).get(normalize(value));
      } catch (error) {
        if (version === dialogVersion && source === select) { status.textContent = error.message; save.disabled = false; }
        return;
      }
    }
    if (version !== dialogVersion || source !== select || !dialog.open || !select.isConnected) return;
    selectValue(select, canonical);
    dialog.close();
    select.dispatchEvent(new Event('change', {bubbles:true}));
    select.dispatchEvent(new Event('input', {bubbles:true}));
  };
  return {has:field => Object.hasOwn(fields, field), attach, selectValue};
})();
