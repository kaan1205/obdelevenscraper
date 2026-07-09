const state = { vehicles: null };

const makeSelect = document.getElementById('make-select');
const modelSelect = document.getElementById('model-select');
const yearSelect = document.getElementById('year-select');
const generationField = document.getElementById('generation-field');
const generationSelect = document.getElementById('generation-select');
const submitButton = document.getElementById('submit-button');
const form = document.getElementById('vehicle-form');
const statusEl = document.getElementById('status');
const resultsSection = document.getElementById('results');
const resultsList = document.getElementById('results-list');

function setStatus(message, isError = false) {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle('status--error', isError);
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

// <option value> is always the raw value discovered from obdeleven.com's own
// dropdowns (vehicles.json) — the backend resolves those into a real URL, so
// the frontend never has to compute a slug itself.
function fillSelect(select, options, placeholder) {
  select.innerHTML = '';

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  placeholderOption.disabled = true;
  placeholderOption.selected = true;
  select.appendChild(placeholderOption);

  options.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.appendChild(opt);
  });

  select.disabled = options.length === 0;
}

function resetSelect(select, placeholder) {
  select.innerHTML = '';
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = placeholder;
  opt.disabled = true;
  opt.selected = true;
  select.appendChild(opt);
  select.disabled = true;
}

function hideGenerationField() {
  generationField.hidden = true;
  resetSelect(generationSelect, 'Önce yıl seçin');
}

async function loadVehicles() {
  setStatus('Araç listesi yükleniyor...');
  try {
    const res = await fetch('/api/vehicles');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Araç listesi yüklenemedi');

    state.vehicles = data;
    fillSelect(makeSelect, data.makes, 'Marka seçin');
    clearStatus();
  } catch (err) {
    setStatus(`Hata: ${err.message}`, true);
  }
}

makeSelect.addEventListener('change', () => {
  const make = makeSelect.value;
  const models = (state.vehicles.models && state.vehicles.models[make]) || [];
  fillSelect(modelSelect, models, models.length ? 'Model seçin' : 'Model bulunamadı');
  resetSelect(yearSelect, 'Önce model seçin');
  hideGenerationField();
  submitButton.disabled = true;
});

modelSelect.addEventListener('change', () => {
  const make = makeSelect.value;
  const model = modelSelect.value;
  const years = (state.vehicles.years[make] && state.vehicles.years[make][model]) || [];
  fillSelect(yearSelect, years, years.length ? 'Yıl seçin' : 'Yıl bulunamadı');
  hideGenerationField();
  submitButton.disabled = true;
});

yearSelect.addEventListener('change', () => {
  const make = makeSelect.value;
  const model = modelSelect.value;
  const year = yearSelect.value;

  const generations =
    (state.vehicles.generations &&
      state.vehicles.generations[make] &&
      state.vehicles.generations[make][model] &&
      state.vehicles.generations[make][model][year]) ||
    [];

  if (generations.length > 0) {
    generationField.hidden = false;
    fillSelect(generationSelect, generations, 'Nesil seçin');
    submitButton.disabled = true;
  } else {
    hideGenerationField();
    submitButton.disabled = false;
  }
});

generationSelect.addEventListener('change', () => {
  submitButton.disabled = !generationSelect.value;
});

function renderResults(items) {
  resultsList.innerHTML = '';

  items.forEach(({ original, translated }) => {
    const li = document.createElement('li');
    li.className = 'result-card';

    const translatedEl = document.createElement('p');
    translatedEl.className = 'result-title';
    translatedEl.textContent = translated;
    li.appendChild(translatedEl);

    if (translated !== original) {
      const originalEl = document.createElement('p');
      originalEl.className = 'result-original';
      originalEl.textContent = original;
      li.appendChild(originalEl);
    }

    resultsList.appendChild(li);
  });

  resultsSection.hidden = items.length === 0;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const make = makeSelect.value;
  const model = modelSelect.value;
  const year = yearSelect.value;
  const generation = generationField.hidden ? '' : generationSelect.value;

  submitButton.disabled = true;
  resultsSection.hidden = true;
  setStatus('Özelleştirmeler getiriliyor, ilk seferde biraz sürebilir...');

  try {
    const params = new URLSearchParams({ make, model, year });
    if (generation) params.set('generation', generation);

    const res = await fetch(`/api/customizations?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');

    renderResults(data.items);
    setStatus(
      data.cached
        ? `Önbellekten yüklendi (${data.items.length} özelleştirme).`
        : `${data.items.length} özelleştirme bulundu (${data.totalPages} sayfa tarandı).`
    );
  } catch (err) {
    setStatus(`Hata: ${err.message}`, true);
  } finally {
    submitButton.disabled = false;
  }
});

loadVehicles();
